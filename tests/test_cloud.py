"""Cloud preparation: real TLS transports, account migration and scoped paginated history."""
from functools import partial
import http.client
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from device_registry import DeviceRegistry, RegistryError
import platform_server
from platform_server import LocalBroker, PlatformHandler, configure_server, parse_args
import paho.mqtt.client as mqtt

ROOT=Path(__file__).resolve().parents[1]


class CloudTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        for name in ['users.json','platform.json','devices.json']:
            (self.root/name).write_bytes((ROOT/name).read_bytes())
        self.registry=DeviceRegistry(self.root/'platform.sqlite3',self.root)
        self.user=self.registry.account('developer','123456')

    def test_account_migration_password_revocation_and_demo_boundary(self):
        with self.registry.connect() as db:
            stored=db.execute("SELECT password_hash FROM accounts WHERE username='developer'").fetchone()[0]
        self.assertTrue(stored.startswith('scrypt$'))
        self.assertNotIn('password_hash',self.user)
        self.registry.accounts.change_password(self.user,'123456','new-private-password')
        changed=self.registry.account('developer','new-private-password')
        self.assertNotEqual(changed['authVersion'],self.user['authVersion'])
        self.assertEqual(self.registry.accounts.authenticate('developer','new-private-password',allow_demo=False)['id'],self.user['id'])
        with self.assertRaises(RegistryError):
            self.registry.accounts.authenticate('customer','123456',allow_demo=False)
        restarted=DeviceRegistry(self.root/'platform.sqlite3',self.root,import_demo=False)
        self.assertEqual(restarted.account('developer','new-private-password')['id'],self.user['id'])
        formal=self.registry.accounts.create('formal','private-password-123','正式用户','customer','company-c')
        with self.registry.connect() as db:
            first=db.execute('SELECT password_hash FROM accounts WHERE id=?',(formal['id'],)).fetchone()[0]
        second=self.registry.accounts.create('formal2','private-password-123','正式用户2','customer','company-c')
        with self.registry.connect() as db:
            other=db.execute('SELECT password_hash FROM accounts WHERE id=?',(second['id'],)).fetchone()[0]
        self.assertNotEqual(first,other)
        with self.assertRaises(RegistryError):
            self.registry.accounts.create('bad','short','名称','admin')

    def test_login_throttling_persists_across_restart(self):
        for _ in range(5):
            with self.assertRaises(RegistryError) as failure:
                self.registry.accounts.authenticate('developer','wrong','test-ip')
            self.assertEqual(failure.exception.status,401)
        restarted=DeviceRegistry(self.root/'platform.sqlite3',self.root)
        with self.assertRaises(RegistryError) as failure:
            restarted.accounts.authenticate('developer','123456','test-ip')
        self.assertEqual(failure.exception.status,429)

    def make_device(self,name='history-test'):
        return self.registry.create(self.user,{'id':name,'name':'历史测试','location':'猪舍实验室','sceneId':'pig-house'})

    def test_history_scope_pagination_retention_and_restart(self):
        config,_=self.make_device()
        now=time.time()
        with self.registry.connect() as db:
            for i in range(45):
                db.execute('INSERT INTO readings(device, received, payload) VALUES (?, ?, ?)',
                           (config['id'], now-200+i, f'Touch_{i}'))
        first=self.registry.history(self.user,config['id'],now-300,now,limit=20)
        second=self.registry.history(self.user,config['id'],now-300,now,before=first['nextBefore'],limit=20)
        third=self.registry.history(self.user,config['id'],now-300,now,before=second['nextBefore'],limit=20)
        all_rows=first['readings']+second['readings']+third['readings']
        self.assertEqual(len({r['sequence'] for r in all_rows}),45)
        self.assertIsNone(third['nextBefore'])
        self.assertEqual(first['readings'][0]['payload'],'Touch_44')
        snapshot=next(d for d in self.registry.snapshot(self.user) if d['id']==config['id'])
        self.assertEqual(len(snapshot['readings']),45)
        self.assertEqual(snapshot['readings'][0]['payload'],'Touch_0')
        self.assertEqual(len(DeviceRegistry(self.root/'platform.sqlite3',self.root).history(self.user,config['id'],now-300,now,limit=100)['readings']),45)
        other={'id':'other','role':'customer','companyId':'company-other'}
        with self.assertRaises(RegistryError) as failure:
            self.registry.history(other,config['id'],now-60,now)
        self.assertEqual(failure.exception.status,403)
        for start,end,limit in [(now,now-1,10),(float('nan'),now,10),(0,now,10),(now-60,now,501)]:
            with self.assertRaises(RegistryError):
                self.registry.history(self.user,config['id'],start,end,limit=limit)
        with self.registry.connect() as db:
            db.execute('UPDATE readings SET received=? WHERE sequence=?',(now-100*86400,all_rows[-1]['sequence']))
        self.registry.last_cleanup=0
        self.registry.ingest(config['id'],b'Touch_45')
        with self.registry.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM readings').fetchone()[0],45)

    def test_explicit_demo_device_import_and_idempotency(self):
        self.assertEqual(self.registry.snapshot(self.user),[])
        self.registry.import_demo_devices()
        devices=self.registry.snapshot(self.user)
        self.assertEqual([device['id'] for device in devices],['ENV-001','ENV-002','ENV-003'])
        self.assertTrue(all(device['companyId']=='company-c' and device['sceneId']=='pig-house' for device in devices))
        self.assertTrue(all(len(device['readings'])==8 for device in devices))
        self.assertEqual([json.loads(device['readings'][-1]['payload']) for device in devices],[
            {'temperature':25.6,'humidity':62.4,'ammonia':8.2},
            {'temperature':28.1,'humidity':68.5,'ammonia':23.6},
            {'temperature':24.3,'humidity':60.1,'ammonia':7.5}])
        with self.registry.connect() as db:
            counts=(db.execute('SELECT count(*) FROM devices').fetchone()[0],db.execute('SELECT count(*) FROM readings').fetchone()[0])
        self.assertEqual(counts,(3,24))
        self.registry.import_demo_devices()
        with self.registry.connect() as db:
            self.assertEqual((db.execute('SELECT count(*) FROM devices').fetchone()[0],db.execute('SELECT count(*) FROM readings').fetchone()[0]),counts)

    def test_main_imports_demo_devices_only_outside_production(self):
        for production in (False,True):
            with self.subTest(production=production):
                args=parse_args([]);args.production=production
                registry=mock.MagicMock()
                registry.connect.return_value.__enter__.return_value.execute.return_value.fetchone.return_value=(1,)
                server=mock.MagicMock()
                with (mock.patch.object(platform_server,'parse_args',return_value=args),
                      mock.patch.object(platform_server,'DeviceRegistry',return_value=registry) as registry_class,
                      mock.patch.object(platform_server,'LocalBroker'),
                      mock.patch.object(platform_server,'SerialMonitor'),
                      mock.patch.object(platform_server,'ThreadingHTTPServer',return_value=server)):
                    platform_server.main()
                registry_class.assert_called_once_with(args.database.resolve(),platform_server.ROOT,import_demo=not production,retention_days=args.retention_days)
                if production:
                    registry.import_demo_devices.assert_not_called()
                else:
                    registry.import_demo_devices.assert_called_once_with()

    def certificate(self):
        cert,key=self.root/'cert.pem',self.root/'key.pem'
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),
                        '-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1',
                        '-addext','basicConstraints=critical,CA:TRUE'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        return cert,key

    def test_https_secure_session_password_change_and_history_api(self):
        cert,key=self.certificate()
        args=parse_args(['--https-cert',str(cert),'--https-key',str(key),'--mqtt-bind','127.0.0.1'])
        server=ThreadingHTTPServer(('127.0.0.1',0),partial(PlatformHandler,monitors={},directory=str(ROOT)))
        configure_server(server,self.registry,args)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        self.addCleanup(server.server_close);self.addCleanup(server.shutdown)
        context=ssl.create_default_context(cafile=str(cert))
        def request(method,path,data=None,cookie=None,origin=None):
            conn=http.client.HTTPSConnection('localhost',server.server_port,context=context,timeout=5)
            headers={'Content-Type':'application/json'}
            if cookie:headers['Cookie']=cookie
            if origin:headers['Origin']=origin
            conn.request(method,path,json.dumps(data) if data is not None else None,headers)
            r=conn.getresponse();raw=r.read();result=(r.status,raw,r.getheader('Set-Cookie'));conn.close();return result
        status,body,cookie=request('POST','/api/login',{'username':'developer','password':'123456'})
        self.assertEqual(status,200)
        self.assertIn('; Secure',cookie)
        token=cookie.split(';')[0]
        config,_=self.make_device('https-history')
        self.registry.ingest(config['id'],b'Touch_1')
        end=time.time()
        status,body,_=request('GET',f'/api/devices/{config["id"]}/history?start={end-60}&end={end}',cookie=token)
        self.assertEqual(status,200)
        self.assertEqual(len(json.loads(body)['readings']),1)
        self.assertEqual(request('GET','/api/devices',cookie=token,origin='https://evil.example')[0],403)
        self.assertEqual(request('GET','/users.json')[0],404)
        self.assertEqual(request('POST','/api/account/password',{'currentPassword':'123456','newPassword':'new-password-123'},token)[0],200)
        self.assertEqual(request('GET','/api/session',cookie=token)[0],401)
        self.assertEqual(request('POST','/api/login',{'username':'developer','password':'new-password-123'})[0],200)

    def test_mqtt_tls_certificate_validation_and_delivery(self):
        cert,key=self.certificate()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        broker=LocalBroker(self.registry,'127.0.0.1',port,cert,key);broker.start();self.addCleanup(broker.close)
        config,secret=self.make_device('tls-board')
        client=mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,client_id=config['id'])
        client.username_pw_set(config['id'],secret)
        client.tls_set(ca_certs=str(cert))
        connected=threading.Event()
        client.on_connect=lambda c,u,f,code,p:connected.set() if not code.is_failure else None
        client.connect('localhost',port,10);client.loop_start()
        self.addCleanup(client.loop_stop);self.addCleanup(client.disconnect)
        self.assertTrue(connected.wait(5))
        client.publish(self.registry.topic(config['id']),b'Touch_7',qos=1).wait_for_publish(3)
        deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            rows=self.registry.history(self.user,config['id'],time.time()-60,time.time())['readings']
            if rows:break
            threading.Event().wait(.05)
        self.assertEqual(rows[0]['payload'],'Touch_7')
        with socket.create_connection(('127.0.0.1',port)) as sock:
            with self.assertRaises(ssl.SSLCertVerificationError):
                ssl.create_default_context().wrap_socket(sock,server_hostname='localhost')

    def test_config_file_and_cloud_connection_export(self):
        cert,key=self.certificate()
        config=self.root/'server.json'
        config.write_text(json.dumps({'device_host':'mqtt.example.com','device_port':8883,'public_origin':'https://iot.example.com',
                                     'mqtt_cert':cert.name,'mqtt_key':key.name,'mqtt_ca':cert.name,'production':True}))
        args=parse_args(['--config',str(config),'--mqtt-port','8884'])
        self.assertEqual(args.mqtt_port,8884)
        self.assertEqual(args.device_port,8883)
        server=ThreadingHTTPServer(('127.0.0.1',0),partial(PlatformHandler,monitors={},directory=str(ROOT)))
        self.addCleanup(server.server_close);configure_server(server,self.registry,args)
        handler=object.__new__(PlatformHandler);handler.server=server
        connection=handler.device_connection({'id':'test-board'},'test-only-secret')
        self.assertEqual(connection['host'],'mqtt.example.com')
        self.assertEqual(connection['port'],8883)
        self.assertTrue(connection['tls'])
        self.assertIn('BEGIN CERTIFICATE',connection['caCert'])
        fresh=DeviceRegistry(self.root/'fresh.sqlite3',self.root,import_demo=False)
        with fresh.connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM accounts').fetchone()[0],0)


if __name__=='__main__':unittest.main()
