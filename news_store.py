"""Platform notices and company news posts."""
import secrets
import time

from device_registry import RegistryError


class NewsStore:
    SCOPES = ('platform', 'company')

    def __init__(self, registry):
        self.registry = registry
        with registry.connect() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS news_posts (
                id TEXT PRIMARY KEY, scope TEXT NOT NULL, company TEXT,
                title TEXT NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL,
                author_id TEXT NOT NULL, author_name TEXT NOT NULL,
                created REAL NOT NULL)''')
            db.execute('CREATE INDEX IF NOT EXISTS news_posts_feed ON news_posts(scope, company, created)')

    @staticmethod
    def serialize(row):
        return {'id': row['id'], 'scope': row['scope'], 'companyId': row['company'],
                'title': row['title'], 'summary': row['summary'], 'body': row['body'],
                'author': row['author_name'],
                'date': time.strftime('%Y-%m-%d', time.localtime(row['created'])),
                'createdAt': row['created']}

    def list(self, user, company=None):
        if not user:
            raise RegistryError('请先登录。', 401)
        company = (company or '').strip() or None
        if user.get('role') != 'admin':
            if company and company != user.get('companyId'):
                raise RegistryError('只能查看本公司的新闻。', 403)
            company = user.get('companyId')
        with self.registry.connect() as db:
            if company:
                rows = db.execute(
                    'SELECT * FROM news_posts WHERE scope=? OR (scope=? AND company=?) '
                    'ORDER BY created DESC, id DESC',
                    ('platform', 'company', company)).fetchall()
            else:
                rows = db.execute('SELECT * FROM news_posts WHERE scope=? ORDER BY created DESC, id DESC',
                                  ('platform',)).fetchall()
        return [self.serialize(row) for row in rows]

    def create(self, user, data):
        if not user:
            raise RegistryError('请先登录。', 401)
        scope = data.get('scope')
        if scope not in self.SCOPES:
            raise RegistryError('发布范围无效。')
        if scope == 'platform':
            if user.get('role') != 'admin':
                raise RegistryError('只有平台管理员可以发布平台更新通知。', 403)
            company = None
        else:
            if user.get('role') != 'company_admin':
                raise RegistryError('只有公司管理员可以发布公司新闻。', 403)
            company = user.get('companyId')
            if not company:
                raise RegistryError('当前账号未分配公司。', 403)

        def text(key, label, low, high):
            value = data.get(key)
            value = value.strip() if isinstance(value, str) else ''
            if not low <= len(value) <= high:
                raise RegistryError('%s需为 %d–%d 个字符。' % (label, low, high))
            return value

        title = text('title', '标题', 2, 80)
        summary = text('summary', '摘要', 2, 160)
        body = text('body', '正文', 10, 8000)
        post_id = 'news-' + secrets.token_hex(6)
        created = time.time()
        with self.registry.connect() as db:
            db.execute('INSERT INTO news_posts VALUES (?,?,?,?,?,?,?,?,?)',
                       (post_id, scope, company, title, summary, body,
                        user.get('id', ''), user.get('name') or user.get('username') or '平台', created))
        return {'id': post_id, 'scope': scope, 'companyId': company, 'title': title,
                'summary': summary, 'body': body, 'author': user.get('name') or '',
                'date': time.strftime('%Y-%m-%d', time.localtime(created)), 'createdAt': created}
