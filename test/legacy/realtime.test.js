'use strict';
/**
 * 实时同步测试（PRD 6.1 / NFR：状态变更通知 ≤5 秒）
 * 用真实 WebSocket 客户端验证广播与站内消息推送。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { io } = require('socket.io-client');

let ctx;

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jiayan-test-rt-'));
  process.env.JIAYAN_DATA_DIR = dir;
  process.env.JIAYAN_DB_FILE = path.join(dir, 'test.db');

  const { createApp } = require('../../server/app');
  const { seed } = require('../../server/seed');
  const { db } = require('../../server/lib/db');
  const realtime = require('../../server/lib/realtime');

  seed({ force: true });
  const server = http.createServer(createApp());
  realtime.attach(server);

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const members = {};
  for (const m of db.prepare('SELECT id, name FROM members').all()) members[m.name] = m.id;
  const familyId = db.prepare('SELECT id FROM families LIMIT 1').get().id;

  return {
    base,
    members,
    familyId,
    async close() {
      await new Promise((r) => server.close(r));
      try {
        db.close();
      } catch (_) { /* 已关闭 */ }
      fs.rmSync(dir, { recursive: true, force: true });
    },
    async call(method, apiPath, { memberId, body } = {}) {
      const headers = { Accept: 'application/json' };
      if (memberId) headers['x-member-id'] = String(memberId);
      const init = { method, headers };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      const res = await fetch(`${base}/api${apiPath}`, init);
      const payload = await res.json();
      return { status: res.status, body: payload, data: payload.data };
    },
  };
}

/** 连接并加入家庭房间 */
function connect(base, familyId, memberId) {
  return new Promise((resolve, reject) => {
    const socket = io(base, { transports: ['websocket'], reconnection: false });
    socket.on('connect', () => {
      socket.emit('join', { familyId, memberId });
      setTimeout(() => resolve(socket), 120);
    });
    socket.on('connect_error', reject);
  });
}

/** 等待指定事件，超时返回 null */
function waitEvent(socket, event, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, timeoutMs);
    function handler(payload) {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

test.before(async () => { ctx = await boot(); });
test.after(async () => { if (ctx) await ctx.close(); });

test('在线状态：加入房间后家人可见在线列表', async () => {
  const mom = await connect(ctx.base, ctx.familyId, ctx.members['妈妈']);
  const presence = waitEvent(mom, 'presence');
  const dad = await connect(ctx.base, ctx.familyId, ctx.members['爸爸']);
  const payload = await presence;
  assert.ok(payload, '应收到 presence 广播');
  assert.ok(payload.online.includes(ctx.members['爸爸']));

  const list = await ctx.call('GET', '/members', { memberId: ctx.members['妈妈'] });
  const dadRow = list.data.find((m) => m.name === '爸爸');
  assert.strictEqual(dadRow.online, true);

  mom.disconnect();
  dad.disconnect();
});

test('下单：全家在 5 秒内收到 order:created 与站内消息', async () => {
  const dad = await connect(ctx.base, ctx.familyId, ctx.members['爸爸']);
  const created = waitEvent(dad, 'order:created');
  const notif = waitEvent(dad, 'notification');

  const dishes = await ctx.call('GET', '/dishes?keyword=红烧肉', { memberId: ctx.members['妈妈'] });
  const started = Date.now();
  const order = await ctx.call('POST', '/orders', {
    memberId: ctx.members['妈妈'],
    body: { dish_ids: [dishes.data[0].id], meal_time: '今天晚饭', people: 3 },
  });

  const evt = await created;
  const msg = await notif;
  const elapsed = Date.now() - started;

  assert.ok(evt, '应收到 order:created');
  assert.strictEqual(evt.order.id, order.data.id);
  assert.ok(msg && msg.items.length > 0, '应收到站内消息');
  assert.ok(msg.items.some((n) => n.member_id === ctx.members['爸爸']));
  assert.ok(elapsed < 5000, `通知耗时 ${elapsed}ms 应小于 5000ms`);

  dad.disconnect();
});

test('进度更新：异地家人在 5 秒内收到 order:updated', async () => {
  const dishes = await ctx.call('GET', '/dishes?keyword=可乐鸡翅', { memberId: ctx.members['妹妹'] });
  const order = await ctx.call('POST', '/orders', {
    memberId: ctx.members['妹妹'],
    body: { dish_ids: [dishes.data[0].id], meal_time: '今天晚饭', people: 2 },
  });
  await ctx.call('POST', `/orders/${order.data.id}/take`, { memberId: ctx.members['爸爸'] });

  const sister = await connect(ctx.base, ctx.familyId, ctx.members['妹妹']);
  const updated = waitEvent(sister, 'order:updated');

  const started = Date.now();
  await ctx.call('POST', `/orders/${order.data.id}/status`, {
    memberId: ctx.members['爸爸'],
    body: { status: '采购中', remark: '出门买菜' },
  });

  const evt = await updated;
  const elapsed = Date.now() - started;
  assert.ok(evt, '应收到 order:updated');
  assert.strictEqual(evt.order.status, '采购中');
  assert.ok(elapsed < 5000, `广播耗时 ${elapsed}ms 应小于 5000ms`);

  sister.disconnect();
});

test('菜品变更：全家收到 dishes:changed', async () => {
  const dad = await connect(ctx.base, ctx.familyId, ctx.members['爸爸']);
  const changed = waitEvent(dad, 'dishes:changed');
  await ctx.call('POST', '/dishes', {
    memberId: ctx.members['妈妈'],
    body: {
      name: '实时同步测试菜',
      category: '素菜',
      steps: [{ desc: '一' }, { desc: '二' }, { desc: '三' }],
    },
  });
  const evt = await changed;
  assert.ok(evt, '应收到 dishes:changed');
  assert.strictEqual(evt.action, 'create');
  dad.disconnect();
});
