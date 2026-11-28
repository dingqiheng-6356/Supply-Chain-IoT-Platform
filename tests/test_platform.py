"""Real HTTP + MQTT integration, persistent identities, credential and company boundaries."""
from functools import partial
import http.client
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from device_registry import DeviceRegistry
from platform_server import LocalBroker, PlatformHandler
import paho.mqtt.client as mqtt

ROOT = Path(__file__).resolve().parents[1]


class PlatformTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        for name in ['users.json', 'platform.json', 'devices.json']:
            (cls.root / name).write_bytes((ROOT / name).read_bytes())
        users = json.loads((cls.root / 'users.json').read_text())
        developer = next(u for u in users['users'] if u['role'] == 'developer')
        users['users'].append({**developer, 'id': 'dev-other', 'username': 'developer_other', 'companyId': 'company-other'})
        (cls.root / 'users.json').write_text(json.dumps(users))
        platform = json.loads((cls.root / 'platform.json').read_text())
        platform['companies'].append({'id': 'company-other', 'name': '隔离养殖公司',
                                      'categoryId': 'breeding', 'template': 'content/companies/company-c.md'})
        (cls.root / 'platform.json').write_text(json.dumps(platform))
        cls.registry = DeviceRegistry(cls.root / 'platform.sqlite3', cls.root)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            cls.mqtt_port = sock.getsockname()[1]
        cls.broker = LocalBroker(cls.registry, '127.0.0.1', cls.mqtt_port)
        cls.broker.start()
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(PlatformHandler, monitors={}, directory=str(ROOT)))
        cls.server.registry = cls.registry
        cls.server.sessions, cls.server.session_lock = {}, threading.Lock()
        cls.server.device_host, cls.server.mqtt_port = '127.0.0.1', cls.mqtt_port
        cls.server.allowed_hosts = {'127.0.0.1', 'localhost'}
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.broker.close()
        cls.temp.cleanup()

    def request(self, method, path, data=None, cookie=None, origin=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        headers = {'Content-Type': 'application/json'}
        if cookie:
            headers['Cookie'] = cookie
        if origin:
            headers['Origin'] = origin
        conn.request(method, path, body=json.dumps(data) if data is not None else None, headers=headers)
        response = conn.getresponse()
        raw = response.read()
        result = response.status, json.loads(raw), response.getheader('Set-Cookie')
        conn.close()
        return result

    def login(self, username):
        status, data, cookie = self.request('POST', '/api/login', {'username': username, 'password': '123456'})
        self.assertEqual(status, 200)
        self.assertNotIn('passwordHash', data['user'])
        return cookie.split(';')[0]

    def create(self, cookie, device_id):
        status, data, _ = self.request('POST', '/api/devices', {
            'id': device_id, 'name': '猪舍环境终端', 'sceneId': 'pig-house', 'location': '3 号猪舍',
            'sampleInterval': 30, 'companyId': 'company-other', 'online': True}, cookie)
        self.assertEqual(status, 201, data)
        self.assertEqual(data['device']['companyId'], 'company-c')
        return data['connection']

    def connect(self, config, password=None, client_id=None):
        connected = threading.Event()
        results = []
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id or config['clientId'])
        client.username_pw_set(config['username'], password or config['password'])
        def on_connect(client, userdata, flags, code, properties):
            results.append(code.is_failure)
            connected.set()
        def on_disconnect(client, userdata, flags, code, properties):
            # amqtt closes rejected connections without sending a CONNACK.
            if not connected.is_set():
                results.append(True)
                connected.set()
        client.on_connect = on_connect
        client.on_disconnect = on_disconnect
        client.connect('127.0.0.1', self.mqtt_port, 10)
        client.loop_start()
        self.addCleanup(client.loop_stop)
        self.addCleanup(client.disconnect)
        self.assertTrue(connected.wait(5), 'MQTT CONNACK not received')
        return client, results[0]

    def readings(self, cookie, device_id):
        status, data, _ = self.request('GET', '/api/devices', cookie=cookie)
        self.assertEqual(status, 200)
        return next(d for d in data['devices'] if d['id'] == device_id)['readings']

    def wait_for(self, condition):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if condition():
                return
            threading.Event().wait(.05)
        self.fail('Timed out waiting for MQTT persistence')

    def test_invitation_registration_company_role_and_single_use(self):
        invite=self.registry.accounts.invite('company-c','customer')
        data={'username':'registered_customer','password':'registration-test-password','name':'注册测试',
              'inviteCode':invite,'role':'admin','companyId':'company-other'}
        status,body,cookie=self.request('POST','/api/register',data)
        self.assertEqual(status,201,body)
        self.assertEqual(body['user']['role'],'customer')
        self.assertEqual(body['user']['companyId'],'company-c')
        self.assertEqual(self.request('GET','/api/session',cookie=cookie.split(';')[0])[0],200)
        self.assertEqual(self.request('POST','/api/register',{**data,'username':'another_customer'})[0],400)
        self.assertEqual(self.request('POST','/api/login',{'username':data['username'],'password':data['password']})[0],200)
        self.assertEqual(self.request('POST','/api/register',{**data,'inviteCode':'invalid-code'})[0],400)
        expired=self.registry.accounts.invite('company-c','developer')
        with self.registry.connect() as db:
            db.execute('UPDATE registration_invites SET expires=0 WHERE digest=?',(self.registry.digest(expired),))
        self.assertEqual(self.request('POST','/api/register',{**data,'username':'expired_customer','inviteCode':expired})[0],400)
        retry=self.registry.accounts.invite('company-c','developer')
        self.assertEqual(self.request('POST','/api/register',{**data,'username':'new_developer','inviteCode':retry,'password':'short'})[0],400)
        status,body,_=self.request('POST','/api/register',{**data,'username':'new_developer','inviteCode':retry})
        self.assertEqual(status,201)
        self.assertEqual(body['user']['role'],'developer')

    def test_registration_authentication_and_delivery(self):
        cookie = self.login('developer')
        config = self.create(cookie, 'registered-001')
        self.assertEqual(self.readings(cookie, config['clientId']), [])
        client, failed = self.connect(config)
        self.assertFalse(failed)
        client.publish(config['topic'], '温度：10 ℃ 湿度：42％', qos=1).wait_for_publish(3)
        self.wait_for(lambda: len(self.readings(cookie, config['clientId'])) == 1)
        client.publish(config['topic'], '温度：11 ℃', qos=1).wait_for_publish(3)
        # 同一整分钟内只保留一条采样记录，后到的上报覆盖本分钟数据。
        self.wait_for(lambda: any('11' in row['payload'] for row in self.readings(cookie, config['clientId'])))
        self.assertEqual(len(self.readings(cookie, config['clientId'])), 1)
        with self.registry.connect() as db:
            stored = db.execute('SELECT secret_hash FROM devices WHERE id = ?', (config['clientId'],)).fetchone()[0]
        self.assertNotEqual(stored, config['password'])
        restarted = DeviceRegistry(self.root / 'platform.sqlite3', self.root)
        self.assertTrue(restarted.authenticate_device(config['clientId'], config['password']))
        self.assertEqual(len(next(d for d in restarted.snapshot(self.registry.account('developer', '123456')) if d['id'] == config['clientId'])['readings']), 1)
        customer = self.login('customer')
        owner = self.registry.accounts.create('grant_owner','private-password-123','公司管理员','company_admin','company-c')
        customer_user = self.registry.account('customer','123456')
        self.registry.organization.assign(owner, {'userId':customer_user['id'],'deviceIds':[config['clientId']]})
        self.assertEqual(len(self.readings(customer, config['clientId'])), 1)
        _, failed = self.connect(config, password='wrong-secret', client_id=config['clientId'])
        self.assertTrue(failed)

    def test_company_and_web_authorization(self):
        self.assertEqual(self.request('GET', '/api/devices')[0], 401)
        self.assertEqual(self.request('POST', '/api/login', {'username': 'developer', 'password': 'wrong'})[0], 401)
        cookie = self.login('developer')
        config = self.create(cookie, 'company-check')
        self.assertEqual(self.request('POST', '/api/devices', {}, self.login('customer'))[0], 403)
        self.assertEqual(self.request('GET', '/api/messages', cookie=self.login('customer'))[0], 403)
        other = self.login('developer_other')
        status, data, _ = self.request('GET', '/api/devices', cookie=other)
        self.assertEqual(status, 200)
        self.assertEqual(data['devices'], [])
        self.assertEqual(self.request('POST', '/api/devices/company-check/delete', {}, other)[0], 403)
        self.assertEqual(self.request('POST', '/api/devices', {}, cookie, 'http://evil.example')[0], 403)
        self.assertEqual(self.request('POST', '/api/devices', {'id': config['clientId'], 'name': 'x', 'sceneId': 'pig-house', 'location': 'x'}, cookie)[0], 409)
        self.assertEqual(self.request('POST', '/api/logout', {}, cookie)[0], 200)
        self.assertEqual(self.request('GET', '/api/devices', cookie=cookie)[0], 401)

    def test_topic_isolation_reset_delete_and_restore(self):
        cookie = self.login('developer')
        first = self.create(cookie, 'topic-first')
        second = self.create(cookie, 'topic-second')
        client, failed = self.connect(first)
        self.assertFalse(failed)
        denied = threading.Event()
        subscription_codes = []
        def on_subscribe(client, userdata, mid, codes, properties):
            subscription_codes.extend(code.is_failure for code in codes)
            denied.set()
        client.on_subscribe = on_subscribe
        client.subscribe('rd/devices/#')
        self.assertTrue(denied.wait(5))
        self.assertEqual(subscription_codes, [True])
        client.publish(second['topic'], '温度：99 ℃', qos=1).wait_for_publish(3)
        client.publish(first['topic'], '温度：21 ℃', qos=1).wait_for_publish(3)
        self.wait_for(lambda: len(self.readings(cookie, first['clientId'])) == 1)
        self.assertEqual(self.readings(cookie, second['clientId']), [])
        client.publish(first['topic'], '温度：22 ℃', qos=1, retain=True).wait_for_publish(3)
        # A subsequent valid message is a processing barrier for earlier publishes.
        client.publish(first['topic'], '温度：23 ℃', qos=1).wait_for_publish(3)
        # 保留消息不记录；同一整分钟只保留一条采样，23 ℃ 覆盖本分钟数据。
        self.wait_for(lambda: any('23' in row['payload'] for row in self.readings(cookie, first['clientId'])))
        self.assertEqual(len(self.readings(cookie, first['clientId'])), 1)
        self.assertEqual(self.request('POST', '/api/devices/topic-first/reset-secret', {}, cookie)[0], 200)
        client.publish(first['topic'], '温度：77 ℃', qos=1).wait_for_publish(3)
        client.disconnect()
        _, failed = self.connect(first)
        self.assertTrue(failed)
        self.assertEqual(len(self.readings(cookie, first['clientId'])), 1)
        self.assertEqual(self.request('POST', '/api/devices/topic-second/delete', {}, cookie)[0], 200)
        _, failed = self.connect(second)
        self.assertTrue(failed)
        self.assertEqual(self.request('POST', '/api/devices/topic-second/restore', {}, cookie)[0], 200)
        self.assertTrue(self.registry.authenticate_device(second['clientId'], second['password']))
        self.assertEqual(self.readings(cookie, second['clientId']), [])

    def test_alert_handling_review_permissions_and_persistence(self):
        cookie = self.login('developer')
        self.create(cookie, 'alert-flow')
        path = '/api/devices/alert-flow/alert-handle'
        payload = {'metric': 'ammonia', 'note': '已开启通风并检查传感器',
                   'triggerValue': 23.6, 'rangeMin': 0, 'rangeMax': 20}
        self.assertEqual(self.request('POST', path, payload, self.login('customer'))[0], 403)
        self.assertEqual(self.request('POST', path, payload, self.login('developer_other'))[0], 403)
        self.assertEqual(self.request('POST', path, {**payload, 'note': 'x'}, cookie)[0], 400)
        self.assertEqual(self.request('POST', path, {**payload, 'triggerValue': None}, cookie)[0], 400)
        self.assertEqual(self.request('POST', path, {**payload, 'rangeMin': 21}, cookie)[0], 400)
        status, data, _ = self.request('POST', path, payload, cookie)
        self.assertEqual(status, 201, data)
        workflow = data['workflow']
        self.assertEqual(workflow['status'], 'processing')
        self.assertEqual(workflow['triggerValue'], 23.6)
        self.assertEqual(workflow['handlingNote'], payload['note'])
        self.assertEqual(self.request('POST', path, payload, cookie)[0], 409)
        status, data, _ = self.request('GET', '/api/devices', cookie=cookie)
        stored = next(d for d in data['devices'] if d['id'] == 'alert-flow')['alertWorkflows']
        self.assertEqual([row['id'] for row in stored], [workflow['id']])
        review_path = '/api/devices/alert-flow/alert-review'
        review = {'id': workflow['id'], 'note': '现场复查正常，氨气读数已恢复'}
        self.assertEqual(self.request('POST', review_path, {**review, 'note': ''}, cookie)[0], 400)
        self.assertEqual(self.request('POST', review_path, review, self.login('developer_other'))[0], 403)
        status, data, _ = self.request('POST', review_path, review, cookie)
        self.assertEqual(status, 200, data)
        self.assertEqual(data['workflow']['status'], 'closed')
        self.assertEqual(data['workflow']['reviewNote'], review['note'])
        self.assertIsNotNone(data['workflow']['reviewedAt'])
        self.assertEqual(self.request('POST', review_path, review, cookie)[0], 409)
        restarted = DeviceRegistry(self.root / 'platform.sqlite3', self.root)
        user = restarted.account('developer', '123456')
        stored = next(d for d in restarted.snapshot(user) if d['id'] == 'alert-flow')['alertWorkflows']
        self.assertEqual(stored[0]['status'], 'closed')
        self.assertEqual(stored[0]['reviewNote'], review['note'])

    def test_validation_auto_id_and_retention(self):
        cookie = self.login('developer')
        base = {'name': '新设备', 'sceneId': 'pig-house', 'location': '3 号猪舍'}
        for bad in [{'sceneId': 'unknown-type'}, {'sampleInterval': 0}, {'sampleInterval': 1.5}, {'id': '<script>'}, {'name': ''}]:
            self.assertEqual(self.request('POST', '/api/devices', {**base, **bad}, cookie)[0], 400)
        status, data, _ = self.request('POST', '/api/devices', base, cookie)
        self.assertEqual(status, 201)
        self.assertTrue(data['device']['id'].startswith('dev-'))
        device_id = data['device']['id']
        now = time.time()
        with self.registry.connect() as db:
            for n in range(40):
                db.execute('INSERT INTO readings(device, received, payload) VALUES (?, ?, ?)',
                           (device_id, now - (40 - n) * 60, f'温度：{n} ℃'))
        # 快照返回最近 60 条整分钟记录
        self.assertEqual(len(self.readings(cookie, device_id)), 40)
        for n in range(3):
            self.registry.ingest(device_id, f'湿度：{n} %'.encode())
        rows = self.readings(cookie, device_id)
        self.assertEqual(len(rows), 41)
        self.assertEqual(rows[-1]['payload'], '湿度：2 %')
        snapshot = json.dumps(self.request('GET', '/api/devices', cookie=cookie)[1])
        self.assertNotIn(data['connection']['password'], snapshot)
        self.assertNotIn('secret_hash', snapshot)
        for private in ['/data/platform.sqlite3', '/device_registry.py', '/platform_mqtt.py', '/firmware/mega_mqtt_bridge/include/secrets.h']:
            conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
            conn.request('GET', private)
            response = conn.getresponse()
            self.assertEqual(response.status, 404)
            response.read()
            conn.close()


if __name__ == '__main__':
    unittest.main()
