'use strict';
/** 领域规则单测：状态流转、忌口匹配、用餐日期解析 */
const test = require('node:test');
const assert = require('node:assert');

const {
  STATUS, FLOW, canTransition, nextStatus, matchTaboos, resolveMealDate, toDateStr,
} = require('../../server/lib/domain');

test('状态流转：待接单只能进入已接单', () => {
  assert.strictEqual(canTransition(STATUS.PENDING, STATUS.TAKEN).ok, true);
  const bad = canTransition(STATUS.PENDING, STATUS.COOKING);
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.msg, '订单还未被接单，请先接单');
});

test('状态流转：必须按 FLOW 顺序前进一步', () => {
  for (let i = 0; i < FLOW.length - 1; i += 1) {
    assert.strictEqual(canTransition(FLOW[i], FLOW[i + 1]).ok, true, `${FLOW[i]} → ${FLOW[i + 1]}`);
  }
});

test('状态流转：跳步与回退都被拒绝，提示「请按顺序更新状态」', () => {
  const skip = canTransition(STATUS.TAKEN, STATUS.COOKING);
  assert.strictEqual(skip.ok, false);
  assert.strictEqual(skip.msg, '请按顺序更新状态');

  const backward = canTransition(STATUS.COOKING, STATUS.SHOPPING);
  assert.strictEqual(backward.ok, false);
  assert.strictEqual(backward.msg, '请按顺序更新状态');

  const same = canTransition(STATUS.COOKING, STATUS.COOKING);
  assert.strictEqual(same.ok, false);
});

test('状态流转：任意未终态都可取消，终态不可再变更', () => {
  for (const s of [STATUS.PENDING, STATUS.TAKEN, STATUS.SHOPPING, STATUS.PREPPING, STATUS.COOKING]) {
    assert.strictEqual(canTransition(s, STATUS.CANCELED).ok, true, s);
  }
  assert.strictEqual(canTransition(STATUS.DONE, STATUS.CANCELED).ok, false);
  assert.strictEqual(canTransition(STATUS.CANCELED, STATUS.TAKEN).ok, false);
  assert.strictEqual(canTransition(STATUS.DONE, STATUS.DONE).msg, '订单已结束，不能再变更状态');
});

test('状态流转：未知状态被拒绝', () => {
  assert.strictEqual(canTransition(STATUS.TAKEN, '上菜中').msg, '未知的订单状态');
});

test('nextStatus：返回下一步，终态返回 null', () => {
  assert.strictEqual(nextStatus(STATUS.PENDING), STATUS.TAKEN);
  assert.strictEqual(nextStatus(STATUS.TAKEN), STATUS.SHOPPING);
  assert.strictEqual(nextStatus(STATUS.COOKING), STATUS.DONE);
  assert.strictEqual(nextStatus(STATUS.DONE), null);
  assert.strictEqual(nextStatus(STATUS.CANCELED), null);
});

test('忌口匹配：命中食材并去重，无忌口返回空', () => {
  const ing = [{ name: '虾仁' }, { name: '香菜' }, { name: '盐' }];
  assert.deepStrictEqual(matchTaboos(ing, ['香菜']), ['香菜']);
  assert.deepStrictEqual(matchTaboos(ing, ['虾', '虾']), ['虾']);
  assert.deepStrictEqual(matchTaboos(ing, []), []);
  assert.deepStrictEqual(matchTaboos(ing, ['牛肉']), []);
});

test('忌口匹配：双向包含（食材含忌口词 / 忌口词含食材）', () => {
  assert.deepStrictEqual(matchTaboos([{ name: '虾仁' }], ['虾']), ['虾']);
  assert.deepStrictEqual(matchTaboos([{ name: '海鲜' }], ['海鲜拼盘']), ['海鲜拼盘']);
});

test('用餐日期解析：今天/明天/后天/周末', () => {
  const base = new Date('2026-09-16T10:00:00');  // 周三
  assert.strictEqual(resolveMealDate('今天晚饭', base), '2026-09-16');
  assert.strictEqual(resolveMealDate('明天午饭', base), '2026-09-17');
  assert.strictEqual(resolveMealDate('后天晚饭', base), '2026-09-18');
  assert.strictEqual(resolveMealDate('周末午饭', base), '2026-09-19');  // 最近的周六
});

test('toDateStr：补零输出 YYYY-MM-DD', () => {
  assert.strictEqual(toDateStr(new Date('2026-01-05T08:00:00')), '2026-01-05');
});
