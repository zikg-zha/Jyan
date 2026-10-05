'use strict';
/** 领域规则单测：状态流转（schema.sql）、用餐日期解析（public/js/domain.js） */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb } = require('./helpers/pg');
const { mirrorFrontend } = require('./helpers/frontend');

const FLOW = ['已接单', '采购中', '准备中', '烹饪中', '已完成'];
let h;
let fe;
let domain;

test.before(async () => {
  h = await createDb({ seed: false });
  fe = mirrorFrontend();
  domain = await fe.load('domain.js');
});
test.after(async () => {
  await h.close();
  fe.cleanup();
});

const transition = async (from, to) =>
  (await h.sql('select private.can_transition($1, $2) as msg', [from, to]))[0].msg;
const next = async (s) => (await h.sql('select private.next_status($1) as s', [s]))[0].s;

test('状态流转：待接单只能进入已接单', async () => {
  assert.equal(await transition('待接单', '已接单'), null);
  assert.equal(await transition('待接单', '烹饪中'), '订单还未被接单，请先接单');
});

test('状态流转：必须按 FLOW 顺序前进一步', async () => {
  for (let i = 0; i < FLOW.length - 1; i += 1) {
    assert.equal(await transition(FLOW[i], FLOW[i + 1]), null, `${FLOW[i]} → ${FLOW[i + 1]}`);
  }
});

test('状态流转：跳步、回退、原地都被拒绝', async () => {
  assert.equal(await transition('已接单', '烹饪中'), '请按顺序更新状态');
  assert.equal(await transition('烹饪中', '采购中'), '请按顺序更新状态');
  assert.equal(await transition('烹饪中', '烹饪中'), '请按顺序更新状态');
});

test('状态流转：任意未终态都可取消，终态不可再变更，未知状态被拒绝', async () => {
  for (const s of ['待接单', ...FLOW.slice(0, -1)]) assert.equal(await transition(s, '已取消'), null, s);
  assert.equal(await transition('已完成', '已取消'), '订单已结束，不能再变更状态');
  assert.equal(await transition('已取消', '已接单'), '订单已结束，不能再变更状态');
  assert.equal(await transition('已接单', '上菜中'), '未知的订单状态');
});

test('nextStatus：返回下一步，终态返回 null', async () => {
  assert.equal(await next('待接单'), '已接单');
  assert.equal(await next('已接单'), '采购中');
  assert.equal(await next('烹饪中'), '已完成');
  assert.equal(await next('已完成'), null);
  assert.equal(await next('已取消'), null);
});

test('前端常量与数据库流转顺序一致', () => {
  assert.deepEqual(domain.META.flow, FLOW);
  assert.deepEqual(domain.META.categories, ['荤菜', '素菜', '汤', '主食', '凉菜']);
});

test('用餐日期解析：今天/明天/后天/周末', () => {
  const base = new Date('2026-09-16T10:00:00');  // 周三
  assert.equal(domain.resolveMealDate('今天晚饭', base), '2026-09-16');
  assert.equal(domain.resolveMealDate('明天午饭', base), '2026-09-17');
  assert.equal(domain.resolveMealDate('后天晚饭', base), '2026-09-18');
  assert.equal(domain.resolveMealDate('周末午饭', base), '2026-09-19');  // 最近的周六
  assert.equal(domain.resolveMealDate('周末晚饭', new Date('2026-09-20T10:00:00')), '2026-09-20');  // 周日当天
});

test('toDateStr：补零输出 YYYY-MM-DD', () => {
  assert.equal(domain.toDateStr(new Date('2026-01-05T08:00:00')), '2026-01-05');
});

test('日期入参：非法格式回落到北京时间今天', async () => {
  const [r] = await h.sql(`select private.clean_date('2030-02-03')::text a, private.clean_date('x')::text b,
    private.clean_date('2030-02-30')::text c, (now() at time zone 'Asia/Shanghai')::date::text t`);
  assert.equal(r.a, '2030-02-03');
  assert.equal(r.b, r.t);
  assert.equal(r.c, r.t);
});
