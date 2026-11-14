"""Company-scoped whiteboards, public sharing, uploaded assets and JSON safety."""
from functools import partial
import http.client
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from device_registry import DeviceRegistry, RegistryError
from platform_server import PlatformHandler

ROOT = Path(__file__).resolve().parents[1]


class WhiteboardTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ('users.json', 'platform.json', 'devices.json'):
            (self.root / name).write_bytes((ROOT / name).read_bytes())
        self.registry = DeviceRegistry(self.root / 'test.sqlite3', self.root)
        self.store = self.registry.whiteboards
        self.users = {name: self.registry.account(name, '123456')
                      for name in ('customer', 'developer', 'owner', 'admin')}

    @staticmethod
    def element(element_id, element_type, props=None):
        return {'id': element_id, 'type': element_type, 'x': 10, 'y': 20,
                'width': 320, 'height': 180, 'rotation': 0, 'z': 1, 'props': props or {}}

    def document(self, content='猪舍环境展示', device_id=None):
        text_props = {'content': content}
        if device_id:
            text_props.update(deviceId=device_id, metric='temperature')
        return {'canvas': {'width': 1600, 'height': 900, 'background': '#071b18',
                           'backgroundEnd': '#103d32'},
                'elements': [self.element('text-main', 'text', text_props),
                             self.element('shape-main', 'shape', {'color': '#2d8c67'}),
                             self.element('image-main', 'image', {'src': './assets/workspace/city.jpg'}),
                             self.element('video-main', 'video', {'src': 'https://example.com/pig-house.mp4'}),
                             self.element('model-main', 'model', {'src': './assets/models/device.glb'})]}

    def payload(self, title='牧源养殖展示', document=None):
        return {'title': title, 'document': document or self.document()}

    def assert_error(self, status, operation, *args):
        with self.assertRaises(RegistryError) as failure:
            operation(*args)
        self.assertEqual(failure.exception.status, status)

    def other_developer(self):
        with self.registry.connect() as db:
            db.execute('INSERT INTO companies VALUES (?,?)', ('company-other', json.dumps({
                'id': 'company-other', 'name': '隔离养殖公司', 'categoryId': 'breeding'})))
        return self.registry.accounts.create('other_developer', 'private-password-123',
                                             '隔离开发者', 'developer', 'company-other')

    def test_save_list_read_and_write_roles(self):
        for role in ('customer', 'admin'):
            with self.subTest(role=role):
                self.assert_error(403, self.store.save, self.users[role], self.payload())

        developer_board = self.store.save(self.users['developer'], self.payload('开发者白板'))
        owner_board = self.store.save(self.users['owner'], self.payload('公司管理员白板'))
        self.assertEqual(developer_board['company'], 'company-c')
        self.assertIsNone(developer_board['shareToken'])
        self.assertEqual({b['id'] for b in self.store.list(self.users['customer'])},
                         {developer_board['id'], owner_board['id']})
        self.assertEqual(self.store.get(self.users['customer'], developer_board['id'])['document']['elements'][0]['props']['content'],
                         '猪舍环境展示')
        self.assertEqual({b['id'] for b in self.store.list(self.users['admin'])},
                         {developer_board['id'], owner_board['id']})

        updated = self.store.save(self.users['owner'], {
            'id': developer_board['id'], 'title': '已更新白板', 'document': self.document('更新后的内容')})
        self.assertEqual(updated['id'], developer_board['id'])
        self.assertEqual(updated['document']['title'], '已更新白板')
        self.assertEqual(self.store.get(self.users['developer'], updated['id'])['title'], '已更新白板')

    def test_cross_company_isolation(self):
        other = self.other_developer()
        own_board = self.store.save(self.users['developer'], self.payload('本公司白板'))
        other_board = self.store.save(other, self.payload('其他公司白板'))
        self.assertEqual([b['id'] for b in self.store.list(other)], [other_board['id']])
        self.assertEqual([b['id'] for b in self.store.list(self.users['developer'])], [own_board['id']])
        self.assert_error(403, self.store.get, self.users['developer'], other_board['id'])
        self.assert_error(403, self.store.get, other, own_board['id'])
        self.assert_error(403, self.store.save, self.users['developer'],
                          {'id': other_board['id'], 'title': '越权修改', 'document': self.document()})
        self.assertEqual(self.store.get(self.users['admin'], other_board['id'])['title'], '其他公司白板')

    def test_share_public_read_is_sanitized_and_revoke_returns_404(self):
        config, secret = self.registry.create(self.users['developer'], {
            'id': 'WB-ENV-001', 'name': '白板猪舍终端', 'location': '1 号猪舍', 'sceneId': 'pig-house'})
        self.registry.ingest(config['id'], b'{"temperature":25.6,"humidity":62.4,"ammonia":8.2}')
        board = self.store.save(self.users['developer'], self.payload(
            document=self.document(device_id=config['id'])))
        shared = self.store.share(self.users['owner'], board['id'], True)
        token = shared['shareToken']
        self.assertIsInstance(token, str)

        public = self.store.public(token)
        self.assertEqual(set(public), {'id', 'title', 'document', 'devices'})
        self.assertEqual(public['id'], board['id'])
        self.assertEqual(len(public['devices']), 1)
        device = public['devices'][0]
        self.assertEqual(set(device), {'id', 'name', 'location', 'sampleInterval', 'sceneId', 'readings'})
        self.assertEqual(device['sceneId'], 'pig-house')
        self.assertEqual(device['readings'][0]['payload'], '{"temperature":25.6,"humidity":62.4,"ammonia":8.2}')
        serialized = json.dumps(public)
        self.assertNotIn(secret, serialized)
        self.assertNotIn(token, serialized)
        self.assertNotIn('shareToken', serialized)
        self.assertNotIn('secret_hash', serialized)

        revoked = self.store.share(self.users['owner'], board['id'], False)
        self.assertIsNone(revoked['shareToken'])
        self.assert_error(404, self.store.public, token)

    def test_asset_type_signature_and_company_validation(self):
        asset = self.store.upload(self.users['developer'], 'pig-house.png', b'\x89PNG\r\n\x1a\nvalid-test-data')
        self.assertEqual(asset['mime'], 'image/png')
        path, mime = self.store.asset(asset['id'], self.users['customer'])
        self.assertEqual(mime, 'image/png')
        self.assertTrue(path.read_bytes().startswith(b'\x89PNG'))
        model = self.store.upload(self.users['owner'], 'device.glb', b'glTF' + b'\0' * 8)
        self.assertEqual(model['mime'], 'model/gltf-binary')
        for filename, content in [('notes.txt', b'text'), ('fake.png', b'not-an-image'),
                                  ('broken.glb', b'not-a-glb'), ('empty.mp4', b'')]:
            with self.subTest(filename=filename):
                self.assert_error(400, self.store.upload, self.users['developer'], filename, content)
        for role in ('customer', 'admin'):
            self.assert_error(403, self.store.upload, self.users[role], 'image.png', b'\x89PNG\r\n\x1a\n')

        other = self.other_developer()
        foreign_document = self.document()
        foreign_document['elements'][2]['props']['src'] = asset['url']
        self.assert_error(403, self.store.save, other, self.payload(document=foreign_document))
        self.assert_error(403, self.store.asset, asset['id'], other)

    def test_invalid_documents_are_rejected(self):
        invalid = [None, []]
        wrong_canvas = self.document()
        wrong_canvas['canvas']['width'] = 800
        invalid.append(wrong_canvas)
        unsupported = self.document()
        unsupported['elements'][0]['type'] = 'script'
        invalid.append(unsupported)
        duplicate = self.document()
        duplicate['elements'][1]['id'] = duplicate['elements'][0]['id']
        invalid.append(duplicate)
        unsafe_source = self.document()
        unsafe_source['elements'][2]['props']['src'] = 'javascript:alert(1)'
        invalid.append(unsafe_source)
        for index, document in enumerate(invalid):
            with self.subTest(index=index):
                self.assert_error(400, self.store.save, self.users['developer'],
                                  {'title': '无效白板', 'document': document})

    def test_xss_text_stays_inert_json_over_http(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), partial(PlatformHandler, monitors={}, directory=str(self.root)))
        server.registry = self.registry
        server.sessions, server.session_lock = {}, threading.Lock()
        server.allowed_hosts = {'127.0.0.1', 'localhost'}
        server.device_host, server.mqtt_port = '127.0.0.1', 1883
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)

        def request(method, path, data=None, cookie=None):
            connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=5)
            headers = {'Content-Type': 'application/json'}
            if cookie:
                headers['Cookie'] = cookie
            connection.request(method, path, json.dumps(data) if data is not None else None, headers)
            response = connection.getresponse()
            raw = response.read()
            result = response.status, dict(response.getheaders()), raw
            connection.close()
            return result

        status, headers, raw = request('POST', '/api/login', {'username': 'developer', 'password': '123456'})
        self.assertEqual(status, 200, raw)
        cookie = headers['Set-Cookie'].split(';')[0]
        xss = '<img src=x onerror=alert(1)><script>alert(1)</script>'
        status, headers, raw = request('POST', '/api/whiteboards', self.payload(document=self.document(xss)), cookie)
        self.assertEqual(status, 201, raw)
        self.assertTrue(headers['Content-Type'].startswith('application/json'))
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        board = json.loads(raw)['board']
        self.assertEqual(board['document']['elements'][0]['props']['content'], xss)
        board_id = board['id']
        status, headers, raw = request('GET', f'/api/whiteboards/{board_id}', cookie=cookie)
        self.assertEqual(status, 200)
        self.assertTrue(headers['Content-Type'].startswith('application/json'))
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        self.assertEqual(json.loads(raw)['board']['document']['elements'][0]['props']['content'], xss)


if __name__ == '__main__':
    unittest.main()
