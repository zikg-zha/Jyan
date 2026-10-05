'use strict';
/** Supabase 配置容错：URL 规范化、密钥误填拦截、登录失败原因不再一律报「网络异常」 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { mirrorFrontend } = require('./helpers/frontend');

const mirrors = [];
let created = [];

/** 每次用独立镜像目录加载，保证 supabase.js 按新配置重新求值 */
async function loadWith(config, signInResult) {
  created = [];
  globalThis.supabase = {
    createClient(url, key) {
      created.push({ url, key });
      return {
        auth: {
          getSession: async () => ({ data: { session: null }, error: null }),
          signInAnonymously: async () => signInResult || { data: { session: {} }, error: null },
        },
        rpc: async () => ({ data: { ok: false, message: 'x' }, error: null }),
      };
    },
  };
  const fe = mirrorFrontend({ config });
  mirrors.push(fe);
  return { sb: await fe.load('supabase.js'), api: (await fe.load('api.js')).api };
}

test.after(() => {
  for (const fe of mirrors) fe.cleanup();
  delete globalThis.supabase;
});

test('SUPABASE_URL 误带 /rest/v1/ 时自动去掉', async () => {
  for (const url of [
    'https://abc.supabase.co/rest/v1/',
    'https://abc.supabase.co/rest/v1',
    ' https://abc.supabase.co/ ',
    'https://abc.supabase.co/auth/v1',
  ]) {
    const { sb } = await loadWith({ url, key: 'sb_publishable_x' });
    assert.equal(sb.PROJECT_URL, 'https://abc.supabase.co', url);
    assert.equal(sb.configError, '');
    assert.equal(created[0].url, 'https://abc.supabase.co');
  }
});

test('配置缺失、格式错误、误填 secret key 时给出明确提示且不创建客户端', async () => {
  let r = await loadWith({ url: '', key: '' });
  assert.match(r.sb.configError, /尚未配置/);
  r = await loadWith({ url: 'http://abc.supabase.co', key: 'sb_publishable_x' });
  assert.match(r.sb.configError, /格式不正确/);
  r = await loadWith({ url: 'https://abc.supabase.co/project/x', key: 'sb_publishable_x' });
  assert.match(r.sb.configError, /格式不正确/);
  r = await loadWith({ url: 'https://abc.supabase.co', key: 'sb_secret_abc' });
  assert.match(r.sb.configError, /service_role \/ secret/);
  const payload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
  r = await loadWith({ url: 'https://abc.supabase.co', key: `eyJhbGciOiJIUzI1NiJ9.${payload}.sig` });
  assert.match(r.sb.configError, /service_role \/ secret/);
  assert.equal(created.length, 0);
});

test('匿名登录失败：按原因给出提示，而不是一律「网络异常」', async () => {
  const cases = [
    [{ status: 404, message: 'Invalid path specified in request URL' }, /SUPABASE_URL 填写有误/],
    [{ status: 401, message: 'Invalid API key' }, /SUPABASE_ANON_KEY 无效/],
    [{ status: 422, code: 'anonymous_provider_disabled', message: 'Anonymous sign-ins are disabled' }, /未开启匿名登录/],
    [{ status: 429, message: 'Request rate limit reached' }, /太频繁/],
    [{ status: 0, message: 'Failed to fetch' }, /网络异常/],
    [{ status: 500, message: 'boom' }, /登录服务异常（500）/],
  ];
  for (const [error, re] of cases) {
    const { api } = await loadWith({ url: 'https://abc.supabase.co', key: 'sb_publishable_x' },
      { data: { session: null }, error });
    await assert.rejects(api.login('CODE', '妈妈', '123456'), re, JSON.stringify(error));
  }
});
