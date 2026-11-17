"""Company-scoped, shareable free-form display boards and their uploaded assets."""
import json
import math
from pathlib import Path
import re
import secrets
import time

from device_registry import RegistryError


class WhiteboardStore:
    TYPES = {'text', 'shape', 'image', 'video', 'model'}
    EXTENSIONS = {
        '.png': ('image/png', 8 * 1024 * 1024), '.jpg': ('image/jpeg', 8 * 1024 * 1024),
        '.jpeg': ('image/jpeg', 8 * 1024 * 1024), '.webp': ('image/webp', 8 * 1024 * 1024),
        '.gif': ('image/gif', 8 * 1024 * 1024), '.mp4': ('video/mp4', 50 * 1024 * 1024),
        '.webm': ('video/webm', 50 * 1024 * 1024), '.glb': ('model/gltf-binary', 25 * 1024 * 1024),
    }

    def __init__(self, registry):
        self.registry = registry
        self.root = registry.root / 'data' / 'whiteboard_assets'
        self.root.mkdir(parents=True, exist_ok=True)
        with registry.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS whiteboards (
                    id TEXT PRIMARY KEY, company TEXT NOT NULL, title TEXT NOT NULL,
                    document TEXT NOT NULL, share_token TEXT UNIQUE,
                    created REAL NOT NULL, updated REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS whiteboards_company ON whiteboards(company, updated);
                CREATE TABLE IF NOT EXISTS whiteboard_assets (
                    id TEXT PRIMARY KEY, company TEXT NOT NULL, name TEXT NOT NULL,
                    mime TEXT NOT NULL, extension TEXT NOT NULL, size INTEGER NOT NULL,
                    created REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS whiteboard_assets_company ON whiteboard_assets(company);
            ''')

    @staticmethod
    def require_write(user):
        if not user or user.get('role') not in ('company_admin', 'developer'):
            raise RegistryError('仅本公司管理员或开发者可以编辑白板。', 403)
        if not user.get('companyId'):
            raise RegistryError('账号尚未分配公司。', 403)

    @staticmethod
    def number(value, low, high, label):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
            raise RegistryError(f'{label}无效。')
        return value

    def validate_document(self, document, company):
        if not isinstance(document, dict):
            raise RegistryError('白板文档应为 JSON 对象。')
        if len(json.dumps(document, ensure_ascii=False)) > 1_000_000:
            raise RegistryError('白板内容超过 1 MB，请减少组件或使用上传资源。')
        canvas = document.get('canvas')
        elements = document.get('elements')
        if not isinstance(canvas, dict) or not isinstance(elements, list) or len(elements) > 150:
            raise RegistryError('白板画布或组件列表无效，最多支持 150 个组件。')
        if canvas.get('width') != 1600 or canvas.get('height') != 900:
            raise RegistryError('白板逻辑尺寸应为 1600 × 900。')
        for key in ('background', 'backgroundEnd'):
            value = canvas.get(key, '#071b18')
            if not isinstance(value, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', value):
                raise RegistryError('画布配色无效。')
        ids = set()
        for element in elements:
            if not isinstance(element, dict) or element.get('type') not in self.TYPES:
                raise RegistryError('白板包含不支持的组件。')
            element_id = element.get('id')
            if not isinstance(element_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{3,64}', element_id) or element_id in ids:
                raise RegistryError('组件 ID 无效或重复。')
            ids.add(element_id)
            for key, low, high in [('x', -4000, 8000), ('y', -4000, 8000), ('width', 8, 4000),
                                   ('height', 8, 4000), ('rotation', -360, 360), ('z', 0, 10000)]:
                self.number(element.get(key, 0 if key in ('x', 'y', 'rotation') else 1), low, high, '组件位置或尺寸')
            props = element.get('props', {})
            if not isinstance(props, dict) or len(json.dumps(props, ensure_ascii=False)) > 100_000:
                raise RegistryError('组件属性无效。')
            if element['type'] in ('image', 'video', 'model'):
                src = props.get('src')
                if not isinstance(src, str) or len(src) > 2048:
                    raise RegistryError('媒体资源地址无效。')
                match = re.fullmatch(r'/api/whiteboards/assets/([a-f0-9]{32})', src)
                if match:
                    with self.registry.connect() as db:
                        row = db.execute('SELECT company FROM whiteboard_assets WHERE id=?', (match.group(1),)).fetchone()
                    if not row or row['company'] != company:
                        raise RegistryError('媒体资源不存在或不属于本公司。', 403)
                elif not (src.startswith('./assets/') or src.startswith('https://') or src.startswith('http://')):
                    raise RegistryError('服务器白板仅支持已上传资源、内置资源或 HTTP(S) 资源。')
            for key in ('deviceId', 'metric'):
                if key in props and (not isinstance(props[key], str) or len(props[key]) > 100):
                    raise RegistryError('设备指标绑定无效。')
        return document

    @staticmethod
    def row_dict(row, document=False):
        result = {'id': row['id'], 'title': row['title'], 'company': row['company'],
                  'shareToken': row['share_token'], 'created': row['created'], 'updated': row['updated']}
        if document:
            result['document'] = json.loads(row['document'])
        return result

    def row(self, db, board_id):
        if not isinstance(board_id, str) or not re.fullmatch(r'board-[a-f0-9]{16}', board_id):
            raise RegistryError('白板不存在。', 404)
        row = db.execute('SELECT * FROM whiteboards WHERE id=?', (board_id,)).fetchone()
        if not row:
            raise RegistryError('白板不存在。', 404)
        return row

    @staticmethod
    def authorize(user, row, write=False):
        if write:
            WhiteboardStore.require_write(user)
        if not user:
            raise RegistryError('请登录后查看白板。', 401)
        if user.get('role') != 'admin' and row['company'] != user.get('companyId'):
            raise RegistryError('无权访问该白板。', 403)

    def list(self, user):
        if not user:
            raise RegistryError('请登录后查看白板。', 401)
        with self.registry.connect() as db:
            rows = db.execute('SELECT * FROM whiteboards ORDER BY updated DESC').fetchall() if user.get('role') == 'admin' else db.execute(
                'SELECT * FROM whiteboards WHERE company=? ORDER BY updated DESC', (user.get('companyId'),)).fetchall()
            return [self.row_dict(row) for row in rows]

    def get(self, user, board_id):
        with self.registry.connect() as db:
            row = self.row(db, board_id)
            self.authorize(user, row)
            return self.row_dict(row, True)

    def save(self, user, data):
        self.require_write(user)
        company = user['companyId']
        document = self.validate_document(data.get('document'), company)
        title = data.get('title', document.get('title'))
        if not isinstance(title, str) or not 1 <= len(title.strip()) <= 80:
            raise RegistryError('白板名称需为 1–80 个字符。')
        title = title.strip()
        document = {**document, 'title': title}
        board_id = data.get('id')
        now = time.time()
        with self.registry.connect() as db:
            if board_id:
                row = self.row(db, board_id)
                self.authorize(user, row, True)
                db.execute('UPDATE whiteboards SET title=?,document=?,updated=? WHERE id=?',
                           (title, json.dumps(document, ensure_ascii=False), now, board_id))
            else:
                board_id = 'board-' + secrets.token_hex(8)
                db.execute('INSERT INTO whiteboards(id,company,title,document,created,updated) VALUES (?,?,?,?,?,?)',
                           (board_id, company, title, json.dumps(document, ensure_ascii=False), now, now))
            return self.row_dict(self.row(db, board_id), True)

    def delete(self, user, board_id):
        with self.registry.connect() as db:
            row = self.row(db, board_id)
            self.authorize(user, row, True)
            db.execute('DELETE FROM whiteboards WHERE id=?', (board_id,))

    def share(self, user, board_id, enabled):
        if not isinstance(enabled, bool):
            raise RegistryError('分享状态无效。')
        with self.registry.connect() as db:
            row = self.row(db, board_id)
            self.authorize(user, row, True)
            token = secrets.token_urlsafe(24) if enabled else None
            db.execute('UPDATE whiteboards SET share_token=?,updated=? WHERE id=?', (token, time.time(), board_id))
            return self.row_dict(self.row(db, board_id), True)

    def public(self, token):
        if not isinstance(token, str) or not 20 <= len(token) <= 128:
            raise RegistryError('展示链接无效或已取消分享。', 404)
        with self.registry.connect() as db:
            row = db.execute('SELECT * FROM whiteboards WHERE share_token=?', (token,)).fetchone()
            if not row:
                raise RegistryError('展示链接无效或已取消分享。', 404)
            document = json.loads(row['document'])
            wanted = {e.get('props', {}).get('deviceId') for e in document['elements'] if e.get('type') == 'text'}
            result = {'id': row['id'], 'title': row['title'], 'document': document, 'devices': []}
            for device_id in wanted:
                if not isinstance(device_id, str):
                    continue
                device = db.execute('SELECT * FROM devices WHERE id=? AND company=? AND deleted=0', (device_id, row['company'])).fetchone()
                if not device:
                    continue
                config = json.loads(device['config'])
                readings = [dict(r) for r in db.execute(
                    'SELECT sequence,received,payload FROM readings WHERE device=? ORDER BY sequence DESC LIMIT 30', (device['id'],))][::-1]
                result['devices'].append({'id': device['id'], 'name': config.get('name', device['id']),
                    'location': config.get('location', ''), 'sampleInterval': config.get('sampleInterval', 30),
                    'sceneId': config.get('sceneId'), 'demo': config.get('demo') is True,
                    'demoOnline': config.get('demoOnline') is not False, 'readings': readings})
            return result

    def upload(self, user, filename, content):
        self.require_write(user)
        if not isinstance(filename, str) or len(filename) > 160:
            raise RegistryError('资源文件名无效。')
        extension = Path(filename).suffix.lower()
        if extension not in self.EXTENSIONS:
            raise RegistryError('支持 PNG/JPG/WebP/GIF、MP4/WebM 和 GLB 文件。')
        mime, maximum = self.EXTENSIONS[extension]
        if not content or len(content) > maximum:
            raise RegistryError(f'资源为空或超过 {maximum // 1024 // 1024} MB 限制。')
        if extension == '.glb' and (len(content) < 12 or content[:4] != b'glTF'):
            raise RegistryError('GLB 文件格式无效。')
        if extension in ('.png', '.jpg', '.jpeg', '.webp', '.gif'):
            signatures = ((b'\x89PNG\r\n\x1a\n',), (b'\xff\xd8\xff',), (b'RIFF',), (b'GIF87a', b'GIF89a'))
            if not any(content.startswith(sig) for group in signatures for sig in group):
                raise RegistryError('图片内容与文件扩展名不匹配。')
        asset_id = secrets.token_hex(16)
        path = self.root / f'{asset_id}{extension}'
        path.write_bytes(content)
        try:
            with self.registry.connect() as db:
                db.execute('INSERT INTO whiteboard_assets(id,company,name,mime,extension,size,created) VALUES (?,?,?,?,?,?,?)',
                           (asset_id, user['companyId'], Path(filename).name[:160], mime, extension, len(content), time.time()))
        except Exception:
            path.unlink(missing_ok=True)
            raise
        return {'id': asset_id, 'url': f'/api/whiteboards/assets/{asset_id}', 'name': Path(filename).name[:160],
                'mime': mime, 'size': len(content)}

    def asset(self, asset_id, user=None, token=None):
        if not isinstance(asset_id, str) or not re.fullmatch(r'[a-f0-9]{32}', asset_id):
            raise RegistryError('资源不存在。', 404)
        with self.registry.connect() as db:
            row = db.execute('SELECT * FROM whiteboard_assets WHERE id=?', (asset_id,)).fetchone()
            if not row:
                raise RegistryError('资源不存在。', 404)
            allowed = bool(user and (user.get('role') == 'admin' or user.get('companyId') == row['company']))
            if token and db.execute('SELECT 1 FROM whiteboards WHERE company=? AND share_token=?', (row['company'], token)).fetchone():
                allowed = True
            if not allowed:
                raise RegistryError('无权读取该资源。', 403)
        path = (self.root / f"{asset_id}{row['extension']}").resolve()
        if not path.is_relative_to(self.root.resolve()) or not path.is_file():
            raise RegistryError('资源文件不存在。', 404)
        return path, row['mime']
