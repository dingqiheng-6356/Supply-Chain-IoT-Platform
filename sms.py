"""SMS delivery for verification codes.

Configure with environment variables:

    SMS_PROVIDER=aliyun
    ALIYUN_ACCESS_KEY_ID=...
    ALIYUN_ACCESS_KEY_SECRET=...
    ALIYUN_SMS_SIGN_NAME=...
    ALIYUN_SMS_TEMPLATE_CODE=...

Without ``SMS_PROVIDER=aliyun`` the platform falls back to ``log``: the code is
printed to the server console instead of being sent, which keeps local demos
usable. The HTTP layer only echoes the code back when the log provider is active.
"""
import base64
import hashlib
import hmac
import json
import os
import time
import urllib.parse
import urllib.request
import uuid

from device_registry import RegistryError


def mask_phone(phone):
    phone = str(phone or '')
    if len(phone) != 11:
        return phone
    return f'{phone[:3]}****{phone[-4:]}'


def provider():
    return (os.environ.get('SMS_PROVIDER') or 'log').strip().lower()


def is_console():
    return provider() != 'aliyun'


def _aliyun_signature(params, secret):
    query = '&'.join(f'{urllib.parse.quote(k, safe="~")}={urllib.parse.quote(v, safe="~")}'
                     for k, v in sorted(params.items()))
    string_to_sign = 'GET&%2F&' + urllib.parse.quote(query, safe='')
    digest = hmac.new((secret + '&').encode(), string_to_sign.encode(), hashlib.sha1).digest()
    return base64.b64encode(digest).decode()


def _send_aliyun(phone, code):
    key_id = os.environ.get('ALIYUN_ACCESS_KEY_ID', '')
    key_secret = os.environ.get('ALIYUN_ACCESS_KEY_SECRET', '')
    sign_name = os.environ.get('ALIYUN_SMS_SIGN_NAME', '')
    template = os.environ.get('ALIYUN_SMS_TEMPLATE_CODE', '')
    if not all((key_id, key_secret, sign_name, template)):
        raise RegistryError('短信服务未配置完整，请联系平台管理员。', 503)
    params = {
        'AccessKeyId': key_id,
        'Action': 'SendSms',
        'Format': 'JSON',
        'PhoneNumbers': phone,
        'RegionId': os.environ.get('ALIYUN_SMS_REGION', 'cn-hangzhou'),
        'SignName': sign_name,
        'SignatureMethod': 'HMAC-SHA1',
        'SignatureNonce': uuid.uuid4().hex,
        'SignatureVersion': '1.0',
        'TemplateCode': template,
        'TemplateParam': json.dumps({'code': code}, ensure_ascii=False),
        'Timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'Version': '2017-05-25',
    }
    params['Signature'] = _aliyun_signature(params, key_secret)
    url = 'https://dysmsapi.aliyuncs.com/?' + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(urllib.request.Request(url), timeout=10) as response:
            payload = json.loads(response.read().decode('utf-8') or '{}')
    except Exception:
        raise RegistryError('短信发送失败，请稍后重试。', 502) from None
    if payload.get('Code') != 'OK':
        raise RegistryError(f"短信发送失败：{payload.get('Message') or '服务商返回错误'}", 502)


def send_code(phone, code):
    """Deliver a verification code. Returns the active provider name."""
    if provider() == 'aliyun':
        _send_aliyun(phone, code)
        return 'aliyun'
    print(f'[sms] {mask_phone(phone)} 验证码：{code}（SMS_PROVIDER=log，仅输出到控制台）', flush=True)
    return 'log'
