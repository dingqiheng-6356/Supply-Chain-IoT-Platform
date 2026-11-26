"""Persistent device identities and bounded real telemetry for the local platform."""
from contextlib import contextmanager
import hashlib
import hmac
import json
import math
from pathlib import Path
import re
import secrets
import sqlite3
import time


class RegistryError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class DeviceRegistry:
    def __init__(self, database, root, import_demo=True, retention_days=90):
        self.database = str(database)
        self.root = Path(root)
        self.retention_days = retention_days
        self.last_cleanup = 0
        Path(database).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS devices (
                    id TEXT PRIMARY KEY COLLATE NOCASE, company TEXT NOT NULL,
                    config TEXT NOT NULL, secret_hash TEXT NOT NULL,
                    deleted INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS readings (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    device TEXT NOT NULL COLLATE NOCASE, received REAL NOT NULL,
                    payload TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS readings_device ON readings(device, sequence);
                CREATE INDEX IF NOT EXISTS readings_time ON readings(device, received);
                CREATE INDEX IF NOT EXISTS readings_retention ON readings(received);
                CREATE TABLE IF NOT EXISTS alert_workflows (
                    id TEXT PRIMARY KEY, device TEXT NOT NULL COLLATE NOCASE,
                    metric TEXT NOT NULL, trigger_value REAL,
                    range_min REAL, range_max REAL, status TEXT NOT NULL,
                    handling_note TEXT NOT NULL, handler_id TEXT NOT NULL,
                    handler_name TEXT NOT NULL, handled_at REAL NOT NULL,
                    review_note TEXT, reviewer_id TEXT, reviewer_name TEXT,
                    reviewed_at REAL);
                CREATE INDEX IF NOT EXISTS alert_workflows_device
                    ON alert_workflows(device, status, handled_at);
            ''')
        from organization import OrganizationStore
        self.organization = OrganizationStore(self)
        from accounts import AccountStore
        self.accounts = AccountStore(self, import_demo=import_demo)
        from whiteboard import WhiteboardStore
        self.whiteboards = WhiteboardStore(self)
        from news_store import NewsStore
        self.news = NewsStore(self)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.database, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def digest(secret):
        return hashlib.sha256(secret.encode()).hexdigest()

    @staticmethod
    def coordinates(lng, lat):
        if lng is None and lat is None:
            return {}
        if (isinstance(lng, bool) or isinstance(lat, bool)
                or not isinstance(lng, (int, float)) or not isinstance(lat, (int, float))):
            raise RegistryError('请同时填写有效的经度和纬度。')
        if not (math.isfinite(lng) and math.isfinite(lat)) or not -180 <= lng <= 180 or not -90 <= lat <= 90:
            raise RegistryError('经纬度超出范围：经度 -180~180，纬度 -90~90。')
        return {'lng': round(float(lng), 6), 'lat': round(float(lat), 6)}

    def account(self, username, password):
        return self.accounts.authenticate(username, password)

    def authorize(self, user, row=None, write=False):
        if not user:
            raise RegistryError('请重新登录本机平台。', 401)
        if write and user.get('role') not in ('developer', 'company_admin'):
            raise RegistryError('仅本公司管理员或开发者可以管理设备。', 403)
        if row and not (user.get('role') == 'admin' and not write) and row['company'] != user.get('companyId'):
            raise RegistryError('无权访问该设备。', 403)
        if row and user.get('role') == 'customer':
            with self.connect() as db:
                grant = db.execute('SELECT 1 FROM device_grants WHERE user=? AND device=?', (user['id'], row['id'])).fetchone()
            if not grant or row['deleted']:
                raise RegistryError('该设备未分配给你。', 403)

    def row(self, db, device_id):
        row = db.execute('SELECT * FROM devices WHERE id = ?', (device_id,)).fetchone()
        if not row:
            raise RegistryError('设备不存在。', 404)
        return row

    def create(self, user, data):
        self.authorize(user, write=True)
        device_id = data.get('id', '').strip() if isinstance(data.get('id', ''), str) else ''
        if not device_id:
            device_id = 'dev-' + secrets.token_hex(6)
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{2,39}', device_id):
            raise RegistryError('设备 ID 应为 3–40 位字母、数字、短横线或下划线。')
        config = {'id': device_id, 'companyId': user.get('companyId')}
        types = json.loads((self.root / 'devices.json').read_text())['scenes']
        type_name = data.get('typeName')
        if isinstance(type_name, str) and type_name.strip():
            type_name = type_name.strip()
            if len(type_name) > 40:
                raise RegistryError('设备类型最多 40 字。')
            matched = next((t for t in types if t['name'] == type_name), None)
            config['sceneId'] = matched['id'] if matched else None
            config['typeName'] = type_name
        else:
            scene_id = data.get('sceneId')
            if not isinstance(scene_id, str) or scene_id not in {t['id'] for t in types}:
                raise RegistryError('请填写设备类型。')
            config['sceneId'] = scene_id
            config['typeName'] = next(t['name'] for t in types if t['id'] == scene_id)
        if config['companyId'] not in {c['id'] for c in self.organization.companies()}:
            raise RegistryError('公司不存在。')
        config['workspaceSceneId'] = data.get('workspaceSceneId') or None
        for key, limit in [('name', 40), ('location', 80)]:
            value = data.get(key)
            if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
                raise RegistryError(f'请填写有效的设备名称和安装位置（最多 {limit} 字）。')
            config[key] = value.strip()
        config.update(self.coordinates(data.get('lng'), data.get('lat')))
        interval = data.get('sampleInterval', 30)
        try:
            number = float(interval)
            if isinstance(interval, bool) or not number.is_integer() or not 1 <= number <= 3600:
                raise ValueError
        except (TypeError, ValueError, OverflowError):
            raise RegistryError('采样周期应为 1–3600 秒的整数。') from None
        config['sampleInterval'] = int(number)
        base = json.loads((self.root / 'devices.json').read_text())['devices']
        if any(d['id'].lower() == device_id.lower() for d in base):
            raise RegistryError('设备 ID 已存在，请更换。', 409)
        secret = secrets.token_urlsafe(32)
        try:
            with self.connect() as db:
                self.organization.validate_scene(db, config['companyId'], config['workspaceSceneId'])
                db.execute('INSERT INTO devices(id, company, config, secret_hash) VALUES (?, ?, ?, ?)',
                           (device_id, config['companyId'], json.dumps(config, ensure_ascii=False), self.digest(secret)))
        except sqlite3.IntegrityError:
            raise RegistryError('设备 ID 已存在（含已删除设备）。', 409) from None
        return config, secret

    def change(self, user, device_id, action):
        self.authorize(user, write=True)
        with self.connect() as db:
            row = self.row(db, device_id)
            self.authorize(user, row, write=True)
            if action == 'reset-secret':
                if row['deleted']:
                    raise RegistryError('请先恢复设备。')
                secret = secrets.token_urlsafe(32)
                db.execute('UPDATE devices SET secret_hash = ? WHERE id = ?', (self.digest(secret), device_id))
                config = json.loads(row['config'])
                config['activationAfter'] = time.time()
                db.execute('UPDATE devices SET config = ? WHERE id = ?', (json.dumps(config, ensure_ascii=False), device_id))
                return config, secret
            if action == 'purge':
                if not row['deleted']:
                    raise RegistryError('请先删除设备，再永久删除。')
                db.execute('DELETE FROM readings WHERE device = ?', (device_id,))
                db.execute('DELETE FROM alert_workflows WHERE device = ?', (device_id,))
                db.execute('DELETE FROM device_grants WHERE device = ?', (device_id,))
                db.execute('DELETE FROM devices WHERE id = ?', (device_id,))
                return None
            if action not in ('delete', 'restore'):
                raise RegistryError('未知设备操作。')
            db.execute('UPDATE devices SET deleted = ? WHERE id = ?', (int(action == 'delete'), device_id))
            # Preserve history, but require a fresh report after restore or credential rotation.
            config = json.loads(row['config'])
            config['activationAfter'] = time.time()
            db.execute('UPDATE devices SET config = ? WHERE id = ?', (json.dumps(config, ensure_ascii=False), device_id))
        return None

    def update(self, user, device_id, data):
        self.authorize(user, write=True)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = self.row(db, device_id)
            self.authorize(user, row, write=True)
            config = json.loads(row['config'])
            for key in ('name', 'location'):
                if key in data:
                    value = data[key]
                    if not isinstance(value, str) or not 1 <= len(value.strip()) <= (40 if key == 'name' else 80):
                        raise RegistryError('设备名称或安装位置无效。')
                    config[key] = value.strip()
            if 'lng' in data or 'lat' in data:
                config.pop('lng', None)
                config.pop('lat', None)
                config.update(self.coordinates(data.get('lng'), data.get('lat')))
            if 'sampleInterval' in data:
                interval = data['sampleInterval']
                if isinstance(interval, bool) or not isinstance(interval, (int, float)) or not float(interval).is_integer() or not 1 <= interval <= 3600:
                    raise RegistryError('预期上报周期应为 1–3600 秒的整数。')
                config['sampleInterval'] = int(interval)
            if 'thresholds' in data:
                thresholds = data['thresholds']
                if not isinstance(thresholds, dict) or len(thresholds) > 32:
                    raise RegistryError('告警阈值无效。')
                for key, value in thresholds.items():
                    if len(key) > 200 or not isinstance(value, dict):
                        raise RegistryError('告警阈值无效。')
                    low, high = value.get('min'), value.get('max')
                    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or abs(v) > 100000 for v in (low, high)) or low >= high:
                        raise RegistryError('告警阈值必须为有效数值，且最小值小于最大值。')
                config['thresholds'] = thresholds
            if 'workspaceSceneId' in data:
                scene_id = data['workspaceSceneId'] or None
                self.organization.validate_scene(db, row['company'], scene_id)
                config['workspaceSceneId'] = scene_id
            if 'cameraUrl' in data:
                camera_url = data['cameraUrl'] or ''
                if not isinstance(camera_url, str) or len(camera_url.strip()) > 500 or (camera_url.strip() and not re.match(r'^https?://\S+$', camera_url.strip(), re.I)):
                    raise RegistryError('摄像头画面地址需为 http(s) 开头的有效链接，且不超过 500 字符。')
                config['cameraUrl'] = camera_url.strip() or None
            db.execute('UPDATE devices SET config=? WHERE id=?', (json.dumps(config, ensure_ascii=False), row['id']))
        return config

    @staticmethod
    def alert_record(row):
        return {'id': row['id'], 'deviceId': row['device'], 'metric': row['metric'],
                'triggerValue': row['trigger_value'], 'rangeMin': row['range_min'],
                'rangeMax': row['range_max'], 'status': row['status'],
                'handlingNote': row['handling_note'], 'handlerId': row['handler_id'],
                'handlerName': row['handler_name'], 'handledAt': row['handled_at'],
                'reviewNote': row['review_note'], 'reviewerId': row['reviewer_id'],
                'reviewerName': row['reviewer_name'], 'reviewedAt': row['reviewed_at']}

    def handle_alert(self, user, device_id, data):
        self.authorize(user, write=True)
        metric, note = data.get('metric'), data.get('note')
        if not isinstance(metric, str) or not 1 <= len(metric.strip()) <= 200:
            raise RegistryError('请选择需要处理的告警指标。')
        if not isinstance(note, str) or not 2 <= len(note.strip()) <= 500:
            raise RegistryError('处理说明应为 2–500 个字符。')
        numbers = []
        for key in ('triggerValue', 'rangeMin', 'rangeMax'):
            value = data.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise RegistryError('告警触发值和阈值必须为有效数值。')
            numbers.append(float(value))
        if numbers[1] >= numbers[2]:
            raise RegistryError('告警阈值最小值必须小于最大值。')
        metric, note = metric.strip(), note.strip()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = self.row(db, device_id)
            self.authorize(user, row, write=True)
            if row['deleted']:
                raise RegistryError('请先恢复设备。')
            active = db.execute("SELECT 1 FROM alert_workflows WHERE device=? AND metric=? AND status='processing'",
                                (device_id, metric)).fetchone()
            if active:
                raise RegistryError('该指标已有处理中的告警，请直接完成复核。', 409)
            workflow_id = secrets.token_hex(12)
            db.execute('''INSERT INTO alert_workflows(
                       id,device,metric,trigger_value,range_min,range_max,status,
                       handling_note,handler_id,handler_name,handled_at)
                       VALUES (?,?,?,?,?,?,'processing',?,?,?,?)''',
                       (workflow_id, row['id'], metric, *numbers, note,
                        user['id'], user.get('name') or user['username'], time.time()))
            stored = db.execute('SELECT * FROM alert_workflows WHERE id=?', (workflow_id,)).fetchone()
        return self.alert_record(stored)

    def review_alert(self, user, device_id, data):
        self.authorize(user, write=True)
        workflow_id, note = data.get('id'), data.get('note')
        if not isinstance(workflow_id, str) or not 1 <= len(workflow_id) <= 64:
            raise RegistryError('告警处理记录无效。')
        if not isinstance(note, str) or not 2 <= len(note.strip()) <= 500:
            raise RegistryError('复核结论应为 2–500 个字符。')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            device = self.row(db, device_id)
            self.authorize(user, device, write=True)
            if device['deleted']:
                raise RegistryError('请先恢复设备。')
            row = db.execute('SELECT * FROM alert_workflows WHERE id=? AND device=?',
                             (workflow_id, device_id)).fetchone()
            if not row:
                raise RegistryError('告警处理记录不存在。', 404)
            if row['status'] != 'processing':
                raise RegistryError('该告警已完成复核。', 409)
            db.execute("""UPDATE alert_workflows SET status='closed',review_note=?,
                       reviewer_id=?,reviewer_name=?,reviewed_at=? WHERE id=?""",
                       (note.strip(), user['id'], user.get('name') or user['username'], time.time(), workflow_id))
            stored = db.execute('SELECT * FROM alert_workflows WHERE id=?', (workflow_id,)).fetchone()
        return self.alert_record(stored)

    def authenticate_device(self, device_id, secret):
        if not isinstance(device_id, str) or not isinstance(secret, str):
            return False
        with self.connect() as db:
            row = db.execute('SELECT * FROM devices WHERE id = ? AND deleted = 0', (device_id,)).fetchone()
        return bool(row and row['id'] == device_id and hmac.compare_digest(row['secret_hash'], self.digest(secret)))

    @staticmethod
    def topic(device_id):
        return f'rd/devices/{device_id}/telemetry'

    def ingest(self, device_id, payload, retained=False):
        if retained or not payload or len(payload) > 8192:
            return
        try:
            text = bytes(payload).decode('utf-8')
        except UnicodeDecodeError:
            return
        with self.connect() as db:
            row = db.execute('SELECT id FROM devices WHERE id = ? AND deleted = 0', (device_id,)).fetchone()
            if not row:
                return
            db.execute('INSERT INTO readings(device, received, payload) VALUES (?, ?, ?)', (device_id, time.time(), text))
            now=time.time()
            if now-self.last_cleanup>=3600:
                db.execute('DELETE FROM readings WHERE received < ?', (now-self.retention_days*86400,))
                self.last_cleanup=now

    def history(self, user, device_id, start, end, before=None, limit=200):
        self.authorize(user)
        try:
            start, end, limit = float(start), float(end), int(limit)
            before = int(before) if before is not None else None
            if not all(map(math.isfinite,(start,end))) or start<0 or end<=start or end-start>366*86400 or not 1<=limit<=20000 or (before is not None and before<1):
                raise ValueError
        except (ValueError,TypeError,OverflowError):
            raise RegistryError('请选择有效时间范围（最多 366 天），每页 1–20000 条。') from None
        with self.connect() as db:
            row = self.row(db,device_id)
            self.authorize(user,row)
            rows = [dict(r) for r in db.execute(
                'SELECT sequence,received,payload FROM readings WHERE device=? AND received>=? AND received<=? '
                'AND received>=? AND (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT ?',
                (device_id,start,end,time.time()-self.retention_days*86400,before,before,limit+1))]
        return {'readings':rows[:limit], 'nextBefore':rows[limit-1]['sequence'] if len(rows)>limit else None,
                'retentionDays':self.retention_days}

    def import_demo_devices(self):
        """Seed the explicit local demo without changing production registry defaults."""
        rows = json.loads((self.root / 'devices.json').read_text())['devices']
        now = time.time()
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS device_meta (key TEXT PRIMARY KEY)')
            if db.execute("SELECT 1 FROM device_meta WHERE key='demo-imported'").fetchone():
                self.backfill_demo_coordinates(db, rows)
                return
            for raw in rows:
                config = {key: value for key, value in raw.items()
                          if key not in {'online', 'values', 'history', 'diagnostics'}}
                config['demo'] = True
                config['demoOnline'] = bool(raw.get('online'))
                cursor = db.execute(
                    'INSERT OR IGNORE INTO devices(id, company, config, secret_hash) VALUES (?, ?, ?, ?)',
                    (raw['id'], raw['companyId'], json.dumps(config, ensure_ascii=False),
                     self.digest(secrets.token_urlsafe(32))))
                if not cursor.rowcount:
                    continue
                interval = raw.get('sampleInterval', 30)
                history = raw.get('history', {})
                count = max([len(series) for series in history.values()
                             if isinstance(series, list)] + [1])
                last = now - (2 if raw.get('online') else max(120, interval * 4))
                for index in range(count):
                    payload = {key: series[min(index, len(series) - 1)]
                               for key, series in history.items()
                               if isinstance(series, list) and series}
                    if index == count - 1:
                        payload.update(raw.get('values', {}))
                    db.execute('INSERT INTO readings(device, received, payload) VALUES (?, ?, ?)',
                               (raw['id'], last - (count - 1 - index) * interval,
                                json.dumps(payload, ensure_ascii=False)))
            db.execute("INSERT INTO device_meta VALUES ('demo-imported')")
            db.execute("INSERT OR IGNORE INTO device_grants(user, device) "
                       "SELECT a.id, d.id FROM accounts a, devices d "
                       "WHERE a.username='customer' AND d.deleted=0")

    @staticmethod
    def backfill_demo_coordinates(db, rows):
        """Mark demo devices and fill coordinates created before the map feature."""
        for raw in rows:
            row = db.execute('SELECT config FROM devices WHERE id=? AND deleted=0', (raw['id'],)).fetchone()
            if not row:
                continue
            config = json.loads(row['config'])
            config['demo'] = True
            config['demoOnline'] = bool(raw.get('online'))
            if isinstance(raw.get('lng'), (int, float)) and isinstance(raw.get('lat'), (int, float)) and ('lng' not in config or 'lat' not in config):
                config['lng'], config['lat'] = raw['lng'], raw['lat']
            db.execute('UPDATE devices SET config=? WHERE id=?', (json.dumps(config, ensure_ascii=False), raw['id']))

    def snapshot(self, user):
        self.authorize(user)
        with self.connect() as db:
            rows = db.execute('SELECT * FROM devices ORDER BY rowid').fetchall() if user.get('role') == 'admin' else db.execute(
                'SELECT * FROM devices WHERE company = ? ORDER BY rowid', (user.get('companyId', ''),)).fetchall()
            result = []
            for row in rows:
                if user.get('role') == 'customer':
                    if row['deleted'] or not db.execute('SELECT 1 FROM device_grants WHERE user=? AND device=?', (user['id'], row['id'])).fetchone():
                        continue
                item = json.loads(row['config'])
                item.update(provisioned=True, deleted=bool(row['deleted']), online=False,
                            mqtt={'topic': self.topic(row['id']), 'key': json.dumps([self.topic(row['id']), ''], separators=(',', ':'))},
                            metrics=[], values={}, history={}, diagnostics=[])
                item['readings'] = [dict(r) for r in db.execute(
                    'SELECT sequence, received, payload FROM readings WHERE device = ? AND received >= ? ORDER BY sequence DESC LIMIT 30',
                    (row['id'],time.time()-self.retention_days*86400))][::-1]
                item['alertWorkflows'] = [self.alert_record(r) for r in db.execute(
                    'SELECT * FROM alert_workflows WHERE device=? ORDER BY handled_at DESC LIMIT 20', (row['id'],))]
                result.append(item)
        return result
