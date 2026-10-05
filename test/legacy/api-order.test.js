'use strict';
/** 点菜 / 接单 / 进度 / 筛选 接口测试（F-002 F-003 F-004 F-006） */
const test = require('node:test');
const assert = require('node:assert');
const { startServer } = require('./helpers/server');

let ctx;
let dishIds = {};

test.before(async () => {
  ctx = await startServer('order');
  const r = await ctx.call('GET', '/dishes', { memberId: ctx.members['妈妈'] });
  for (const d of r.data) dishIds[d.name] = d.id;
});
test.after(async () => { if (ctx) await ctx.close(); });

async function createOrder(creatorName, dishNames, extra = {}) {
  return ctx.call('POST', '/orders', {
    memberId: ctx.members[creatorName],
    body: {
      dish_ids: dishNames.map((n) => dishIds[n]),
      meal_time: '今天晚饭',
      people: 3,
      ...extra,
    },
  });
}

test('下单：未选菜品提示「请至少选择一道菜」', async () => {
  const r = await ctx.call('POST', '/orders', {
    memberId: ctx.members['妈妈'],
    body: { dish_ids: [], meal_time: '今天晚饭' },
  });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.message, '请至少选择一道菜');
});

test('下单成功：状态为待接单，菜品被点次数 +1，全家收到消息', async () => {
  const before = await ctx.call('GET', `/dishes/${dishIds['蛋炒饭']}`, { memberId: ctx.members['妈妈'] });
  const r = await createOrder('妈妈', ['蛋炒饭'], { note: '多放葱花' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.status, '待接单');
  assert.strictEqual(r.data.segment, '进行中');
  assert.strictEqual(r.data.next_status, '已接单');
  assert.strictEqual(r.data.creator.name, '妈妈');
  assert.strictEqual(r.data.taker, null);
  assert.strictEqual(r.data.note, '多放葱花');

  const after = await ctx.call('GET', `/dishes/${dishIds['蛋炒饭']}`, { memberId: ctx.members['妈妈'] });
  assert.strictEqual(after.data.order_count, before.data.order_count + 1);

  // 下单人之外的家人都收到新订单消息
  const msg = await ctx.call('GET', '/notifications', { memberId: ctx.members['爸爸'] });
  assert.ok(msg.data.items.some((n) => n.order_id === r.data.id && n.type === 'new_order'));
});

test('下单时直接指派：订单进入已接单并通知被指派人', async () => {
  const r = await createOrder('妹妹', ['炒青菜'], { assignee_id: ctx.members['爸爸'] });
  assert.strictEqual(r.data.status, '已接单');
  assert.strictEqual(r.data.taker.name, '爸爸');

  const msg = await ctx.call('GET', '/notifications', { memberId: ctx.members['爸爸'] });
  assert.ok(msg.data.items.some((n) => n.order_id === r.data.id && n.type === 'assigned'));
});

test('接单：接单人写入并通知下单人', async () => {
  const created = await createOrder('哥哥', ['西红柿炒蛋']);
  const taken = await ctx.call('POST', `/orders/${created.data.id}/take`, {
    memberId: ctx.members['妈妈'],
  });
  assert.strictEqual(taken.status, 200);
  assert.strictEqual(taken.data.joined_as_collaborator, false);
  assert.strictEqual(taken.data.order.status, '已接单');
  assert.strictEqual(taken.data.order.taker.name, '妈妈');

  const msg = await ctx.call('GET', '/notifications', { memberId: ctx.members['哥哥'] });
  assert.ok(msg.data.items.some((n) => n.order_id === created.data.id && n.type === 'taken'));
});

test('并发接单：后到者转为协作，提示「已把你加入协作」', async () => {
  const created = await createOrder('爷爷', ['冬瓜排骨汤']);
  const first = await ctx.call('POST', `/orders/${created.data.id}/take`, {
    memberId: ctx.members['妈妈'],
  });
  const second = await ctx.call('POST', `/orders/${created.data.id}/take`, {
    memberId: ctx.members['爸爸'],
  });
  assert.strictEqual(first.data.joined_as_collaborator, false);
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.data.joined_as_collaborator, true);
  assert.strictEqual(second.data.message, '该订单已被接单，已把你加入协作');
  assert.strictEqual(second.data.order.taker.name, '妈妈');
  assert.ok(second.data.order.collaborators.some((c) => c.name === '爸爸'));
});

test('进度更新：按顺序推进六态直至已完成', async () => {
  const created = await createOrder('妹妹', ['可乐鸡翅']);
  const cook = ctx.members['爸爸'];
  await ctx.call('POST', `/orders/${created.data.id}/take`, { memberId: cook });

  let cur = null;
  for (const status of ['采购中', '准备中', '烹饪中', '已完成']) {
    const r = await ctx.call('POST', `/orders/${created.data.id}/status`, {
      memberId: cook,
      body: { status, remark: `进入${status}` },
    });
    assert.strictEqual(r.status, 200, `${status} 应成功`);
    assert.strictEqual(r.data.status, status);
    cur = r.data;
  }
  assert.strictEqual(cur.segment, '已完成');
  assert.ok(cur.completed_at, '已完成应写入完成时间');
  assert.strictEqual(cur.next_status, null);

  // 进度轨迹完整
  const detail = await ctx.call('GET', `/orders/${created.data.id}`, { memberId: cook });
  const trail = detail.data.progress.map((p) => p.status);
  for (const s of ['待接单', '已接单', '采购中', '准备中', '烹饪中', '已完成']) {
    assert.ok(trail.includes(s), `轨迹缺少 ${s}`);
  }

  // 下单人收到完成通知
  const msg = await ctx.call('GET', '/notifications', { memberId: ctx.members['妹妹'] });
  assert.ok(msg.data.items.some((n) => n.order_id === created.data.id && n.type === 'done'));
});

test('进度更新：跳步被拒绝，提示「请按顺序更新状态」', async () => {
  const created = await createOrder('哥哥', ['麻婆豆腐']);
  const cook = ctx.members['妈妈'];
  await ctx.call('POST', `/orders/${created.data.id}/take`, { memberId: cook });

  const r = await ctx.call('POST', `/orders/${created.data.id}/status`, {
    memberId: cook,
    body: { status: '烹饪中' },
  });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.message, '请按顺序更新状态');
});

test('进度更新：未接单订单不能直接推进（下单人本人也不行）', async () => {
  const created = await createOrder('哥哥', ['阳春面']);
  const r = await ctx.call('POST', `/orders/${created.data.id}/status`, {
    memberId: ctx.members['哥哥'],
    body: { status: '采购中' },
  });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.message, '订单还未被接单，请先接单');
});

test('进度更新：无关成员无权更新', async () => {
  const created = await createOrder('哥哥', ['蒜蓉西兰花']);
  await ctx.call('POST', `/orders/${created.data.id}/take`, { memberId: ctx.members['妈妈'] });
  const r = await ctx.call('POST', `/orders/${created.data.id}/status`, {
    memberId: ctx.members['爷爷'],
    body: { status: '采购中' },
  });
  assert.strictEqual(r.status, 403);
});

test('乐观锁：版本过期返回 409 并附带最新订单（异地并发）', async () => {
  const created = await createOrder('妹妹', ['干煸四季豆']);
  const cook = ctx.members['爸爸'];
  const taken = await ctx.call('POST', `/orders/${created.data.id}/take`, { memberId: cook });
  const staleVersion = taken.data.order.version;

  // 另一端先推进一步，版本 +1
  const ahead = await ctx.call('POST', `/orders/${created.data.id}/status`, {
    memberId: cook,
    body: { status: '采购中' },
  });
  assert.strictEqual(ahead.status, 200);

  const conflict = await ctx.call('POST', `/orders/${created.data.id}/status`, {
    memberId: cook,
    body: { status: '采购中', version: staleVersion },
  });
  assert.strictEqual(conflict.status, 409);
  assert.strictEqual(conflict.body.message, '订单已被其他家人更新，已为你同步最新状态');
  assert.strictEqual(conflict.data.status, '采购中');
  assert.ok(conflict.data.version > staleVersion);
});

test('取消订单：进行中可取消，终态不可再取消', async () => {
  const created = await createOrder('哥哥', ['凉拌黄瓜']);
  const r = await ctx.call('POST', `/orders/${created.data.id}/cancel`, {
    memberId: ctx.members['哥哥'],
    body: { reason: '临时不吃了' },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.status, '已取消');
  assert.strictEqual(r.data.segment, '已取消');

  const again = await ctx.call('POST', `/orders/${created.data.id}/cancel`, {
    memberId: ctx.members['哥哥'],
    body: {},
  });
  assert.strictEqual(again.status, 400);
  assert.strictEqual(again.body.message, '订单已结束，不能再变更状态');
});

test('指派：仅下单人可指派家人', async () => {
  const created = await createOrder('妈妈', ['小鸡炖蘑菇']);
  const bad = await ctx.call('POST', `/orders/${created.data.id}/assign`, {
    memberId: ctx.members['哥哥'],
    body: { member_id: ctx.members['爸爸'] },
  });
  assert.strictEqual(bad.status, 403);

  const good = await ctx.call('POST', `/orders/${created.data.id}/assign`, {
    memberId: ctx.members['妈妈'],
    body: { member_id: ctx.members['爸爸'] },
  });
  assert.strictEqual(good.status, 200);
  assert.strictEqual(good.data.taker.name, '爸爸');
  assert.strictEqual(good.data.status, '已接单');
});

test('列表筛选：今日进行中返回耗时指标且 ≤500ms', async () => {
  const r = await ctx.call('GET', '/orders?segment=进行中&scope=今日', {
    memberId: ctx.members['妈妈'],
  });
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.data.items));
  assert.ok(r.data.items.length > 0, '演示数据应包含今日进行中订单');
  assert.ok(r.data.items.every((o) => o.segment === '进行中'));
  assert.strictEqual(typeof r.data.elapsed_ms, 'number');
  assert.ok(r.data.elapsed_ms < 500, `筛选耗时 ${r.data.elapsed_ms}ms 应小于 500ms`);
});

test('列表筛选：按我下单的 / 我接单的 / 分段 过滤', async () => {
  const me = ctx.members['妈妈'];
  const mine = await ctx.call('GET', '/orders?segment=进行中&scope=全部&relation=我下单的', { memberId: me });
  assert.ok(mine.data.items.every((o) => o.creator.id === me));

  const taken = await ctx.call('GET', '/orders?segment=进行中&scope=全部&relation=我接单的', { memberId: me });
  assert.ok(taken.data.items.every(
    (o) => (o.taker && o.taker.id === me) || o.collaborators.some((c) => c.id === me)
  ));

  const done = await ctx.call('GET', '/orders?segment=已完成&scope=全部', { memberId: me });
  assert.ok(done.data.items.length > 0);
  assert.ok(done.data.items.every((o) => o.status === '已完成'));

  const canceled = await ctx.call('GET', '/orders?segment=已取消&scope=全部', { memberId: me });
  assert.ok(canceled.data.items.every((o) => o.status === '已取消'));
});

test('订单详情：不存在返回 404', async () => {
  const r = await ctx.call('GET', '/orders/999999', { memberId: ctx.members['妈妈'] });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(r.body.message, '订单不存在');
});
