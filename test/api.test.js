'use strict';
/**
 * 前端 public/js/api.js 端到端测试：
 * 用假的 window.supabase 把 rpc 转发到 PGlite，验证前端参数名与 SQL 函数签名一致、错误码映射正确
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb } = require('./helpers/pg');
const { createFakeSupabase } = require('./helpers/fake-supabase');
const { mirrorFrontend } = require('./helpers/frontend');

let h;
let api;
let ApiError;
let session;
let fake;
let fe;

test.before(async () => {
  h = await createDb();
  fake = createFakeSupabase(h);
  fake.install();
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  fe = mirrorFrontend();
  ({ api, ApiError, session } = await fe.load('api.js'));
});

test.after(async () => {
  await h.close();
  fe.cleanup();
  delete globalThis.supabase;
  delete globalThis.localStorage;
});

async function switchUser(name, password = '123456') {
  fake.resetSession();
  return api.login(await h.inviteCode(), name, password);
}

test('未登录：me 返回 null，调用业务接口得到 401', async () => {
  assert.equal(await api.me(), null);
  // 没有匿名会话时以 anon 身份调用，函数执行权限被拒
  await assert.rejects(api.dishes(), (err) => err instanceof ApiError && err.status === 401);
  await fake.client.auth.signInAnonymously();
  await assert.rejects(api.dishes(), (err) => err instanceof ApiError && err.status === 401 && err.message === '请先登录');
});

test('登录：错误密码给出友好提示；成功后 me 返回成员与家庭', async () => {
  fake.resetSession();
  await assert.rejects(api.login(await h.inviteCode(), '妈妈', 'bad'),
    (err) => err.status === 401 && err.message === '邀请码、成员名或密码不正确');
  const data = await api.login((await h.inviteCode()).toLowerCase(), '妈妈', '123456');
  assert.equal(data.member.name, '妈妈');
  session.setInvite(data.family.invite_code);
  assert.equal(session.getInvite(), data.family.invite_code);
  assert.equal((await api.me()).family.name, '幸福一家');
  assert.deepEqual((await api.meta()).flow, ['已接单', '采购中', '准备中', '烹饪中', '已完成']);
});

test('完整流程：下单 → 接单 → 冲突 409 → 推进 → 消息', async () => {
  await switchUser('妈妈');
  const dishes = await api.dishes({ category: '汤', keyword: '蛋' });
  assert.ok(dishes.length >= 1 && dishes.every((d) => d.category === '汤'));
  const members = await api.members();
  const warn = await api.tabooCheck([dishes[0].id], members.map((m) => m.id));
  assert.ok(Array.isArray(warn.warnings));

  const order = await api.createOrder({
    dish_ids: [dishes[0].id], meal_time: '今天晚饭', people: 3, note: '少盐', eat_for: '爷爷',
  });
  assert.equal(order.status, '待接单');
  assert.equal(order.meal_date, new Date().toLocaleDateString('en-CA'));

  await switchUser('爸爸');
  const taken = await api.takeOrder(order.id);
  assert.equal(taken.order.taker.name, '爸爸');
  const s1 = await api.updateStatus(order.id, { status: '采购中', version: taken.order.version });
  await assert.rejects(api.updateStatus(order.id, { status: '准备中', version: taken.order.version }),
    (err) => err.status === 409 && err.data && err.data.version === s1.version);
  await assert.rejects(api.updateStatus(order.id, { status: '已完成', version: s1.version }),
    (err) => err.status === 400 && /按顺序/.test(err.message));

  const list = await api.orders({ segment: '进行中', scope: '今日', relation: '我接单的' });
  assert.ok(list.items.some((o) => o.id === order.id));

  await switchUser('妈妈');
  const inbox = await api.notifications(10);
  assert.ok(inbox.items.some((n) => n.title === '爸爸 接单了「' + dishes[0].name + '」'));
  await api.readAll();
  assert.equal((await api.unreadCount()).unread, 0);
  const detail = await api.cancelOrder(order.id, '改天吃');
  assert.equal(detail.status, '已取消');
});

test('菜品与成员：校验错误原样透出，更新成员偏好', async () => {
  await switchUser('妹妹');
  await assert.rejects(api.createDish({ name: '空菜', category: '汤', steps: [] }),
    (err) => err.status === 400 && err.message === '做法至少需要 3 步');
  const d = await api.createDish({
    name: '银耳羹', category: '汤', ingredients: [{ name: '银耳', amount: '1', unit: '朵' }],
    steps: [{ desc: '泡发' }, { desc: '炖煮' }, { desc: '加冰糖' }],
  });
  assert.equal((await api.dish(d.id)).name, '银耳羹');
  assert.equal((await api.updateDish(d.id, { ...d, duration: 45 })).duration, 45);
  await api.deleteDish(d.id);
  await assert.rejects(api.dish(d.id), (err) => err.status === 404);

  const me = (await api.me()).member;
  const updated = await api.updateMember(me.id, { taboos: ['香菜', '芹菜'], preference: '爱吃甜口' });
  assert.deepEqual(updated.taboos, ['香菜', '芹菜']);
  assert.deepEqual(updated.specialties, me.specialties);
  const stats = await api.stats();
  assert.equal(stats.summary.member_total, 5);
});

test('图片上传：类型/大小校验，路径以家庭 id 开头', async () => {
  const me = await switchUser('哥哥');
  await assert.rejects(api.upload({ type: 'image/svg+xml', size: 10 }), /仅支持/);
  await assert.rejects(api.upload({ type: 'image/png', size: 6 * 1024 * 1024 }), /图片过大/);
  const r = await api.upload({ type: 'image/jpeg', size: 1024 });
  const last = fake.state.uploads.at(-1);
  assert.equal(last.bucket, 'jiayan');
  assert.match(last.path, new RegExp(`^${me.family.id}/[0-9a-f]{32}\\.jpg$`));
  assert.ok(r.url.endsWith(last.path));
});

test('退出：解除设备绑定', async () => {
  await switchUser('爷爷');
  await api.logout();
  assert.equal(await api.me(), null);
  await assert.rejects(api.upload({ type: 'image/png', size: 1 }), /请先登录/);
});
