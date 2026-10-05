'use strict';
/** 登录 / 成员管理 / 消息中心 / 历史统计 接口测试（F-005 F-007 F-009） */
const test = require('node:test');
const assert = require('node:assert');
const { startServer } = require('./helpers/server');

let ctx;
test.before(async () => { ctx = await startServer('member'); });
test.after(async () => { if (ctx) await ctx.close(); });

test('健康检查与字典接口可用', async () => {
  const health = await ctx.call('GET', '/health');
  assert.strictEqual(health.status, 200);
  assert.strictEqual(health.data.status, 'healthy');

  const meta = await ctx.call('GET', '/meta');
  assert.deepStrictEqual(meta.data.categories, ['荤菜', '素菜', '汤', '主食', '凉菜']);
  assert.deepStrictEqual(meta.data.flow, ['已接单', '采购中', '准备中', '烹饪中', '已完成']);
});

test('登录：账号正确返回成员与家庭信息，密码错误返回 401', async () => {
  const ok = await ctx.call('POST', '/auth/login', { body: { name: '妈妈', password: '123456' } });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.data.member.name, '妈妈');
  assert.strictEqual(ok.data.family.name, '幸福一家');
  assert.strictEqual(ok.data.member.password, undefined, '出参不应包含密码');

  const bad = await ctx.call('POST', '/auth/login', { body: { name: '妈妈', password: 'wrong' } });
  assert.strictEqual(bad.status, 401);
  assert.strictEqual(bad.body.message, '成员名或密码不正确');

  const empty = await ctx.call('POST', '/auth/login', { body: { name: '', password: '' } });
  assert.strictEqual(empty.body.message, '请填写成员名和密码');
});

test('当前登录成员：失效 memberId 返回「登录已失效，请重新登录」', async () => {
  const r = await ctx.call('GET', '/auth/me', { memberId: 999999 });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.body.message, '登录已失效，请重新登录');
});

test('成员列表：返回 5 位家人，忌口与擅长可读', async () => {
  const r = await ctx.call('GET', '/members', { memberId: ctx.members['妈妈'] });
  assert.strictEqual(r.data.length, 5);
  const grandpa = r.data.find((m) => m.name === '爷爷');
  assert.deepStrictEqual(grandpa.taboos, ['海鲜', '虾']);
  const mom = r.data.find((m) => m.name === '妈妈');
  assert.ok(mom.specialties.includes('红烧肉'));
});

test('更新资料：忌口 / 擅长 / 偏好可改', async () => {
  const me = ctx.members['哥哥'];
  const r = await ctx.call('PUT', `/members/${me}`, {
    memberId: me,
    body: { taboos: ['芹菜'], specialties: ['番茄炒蛋', '泡面'], preference: '重辣' },
  });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.data.taboos, ['芹菜']);
  assert.strictEqual(r.data.preference, '重辣');
  assert.strictEqual(r.data.specialties.length, 2);
});

test('邀请家人：重名被拒绝，超出 10 人提示「家庭成员已达上限」', async () => {
  const me = ctx.members['妈妈'];
  const dup = await ctx.call('POST', '/members', { memberId: me, body: { name: '妈妈', password: '123456' } });
  assert.strictEqual(dup.status, 400);
  assert.strictEqual(dup.body.message, '该成员名已存在');

  // 现有 5 人，再补 5 人到上限
  for (let i = 1; i <= 5; i += 1) {
    const r = await ctx.call('POST', '/members', {
      memberId: me,
      body: { name: `亲戚${i}`, password: '123456' },
    });
    assert.strictEqual(r.status, 200, `第 ${i} 位应邀请成功`);
  }
  const over = await ctx.call('POST', '/members', {
    memberId: me,
    body: { name: '亲戚6', password: '123456' },
  });
  assert.strictEqual(over.status, 400);
  assert.strictEqual(over.body.message, '家庭成员已达上限');
});

test('消息中心：未读数可查、单条已读与全部已读生效', async () => {
  const me = ctx.members['爸爸'];
  const list = await ctx.call('GET', '/notifications', { memberId: me });
  assert.ok(list.data.items.length >= 1, '演示数据应含欢迎消息');
  assert.ok(list.data.unread >= 1);

  const first = list.data.items[0];
  const read = await ctx.call('POST', `/notifications/${first.id}/read`, { memberId: me });
  assert.strictEqual(read.status, 200);

  const afterOne = await ctx.call('GET', '/notifications/unread-count', { memberId: me });
  assert.strictEqual(afterOne.data.unread, list.data.unread - 1);

  await ctx.call('POST', '/notifications/read-all', { memberId: me });
  const afterAll = await ctx.call('GET', '/notifications/unread-count', { memberId: me });
  assert.strictEqual(afterAll.data.unread, 0);
});

test('历史统计：贡献榜 / 热门菜品 / 谁给谁做过菜 / 汇总', async () => {
  const r = await ctx.call('GET', '/stats', { memberId: ctx.members['妈妈'] });
  assert.strictEqual(r.status, 200);

  const { contributors, popular, pairs, summary } = r.data;
  assert.ok(contributors.length >= 5);
  // 按做饭次数降序
  for (let i = 1; i < contributors.length; i += 1) {
    assert.ok(contributors[i - 1].cook_count >= contributors[i].cook_count, '贡献榜应降序');
  }
  assert.strictEqual(contributors[0].percent, 100, '榜首百分比应为 100');
  assert.ok(contributors.some((c) => c.cook_count > 0), '演示数据应有完成记录');

  assert.ok(popular.length > 0);
  for (let i = 1; i < popular.length; i += 1) {
    assert.ok(popular[i - 1].order_count >= popular[i].order_count, '热门菜品应降序');
  }

  assert.ok(pairs.length > 0);
  assert.ok(pairs[0].creator_name && pairs[0].taker_name && pairs[0].dishes);

  assert.strictEqual(summary.total_orders, 20);
  assert.strictEqual(summary.done_orders, 8);
  assert.strictEqual(summary.canceled_orders, 2);
  assert.ok(summary.dish_total >= 20);
  assert.strictEqual(summary.close_rate, 40);
});

test('接口不存在返回统一 404 结构', async () => {
  const r = await ctx.call('GET', '/not-exist', { memberId: ctx.members['妈妈'] });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(r.body.ok, false);
  assert.strictEqual(r.body.message, '接口不存在');
});
