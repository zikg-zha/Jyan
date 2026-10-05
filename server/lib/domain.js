'use strict';
/** 领域常量与业务规则（对应 PRD 五、功能需求） */

// 订单状态流转（PRD 8.1 术语表）
const STATUS = {
  PENDING: '待接单',
  TAKEN: '已接单',
  SHOPPING: '采购中',
  PREPPING: '准备中',
  COOKING: '烹饪中',
  DONE: '已完成',
  CANCELED: '已取消',
};

// 接单后的推进顺序，必须按序推进（F-004 业务规则 1）
const FLOW = [STATUS.TAKEN, STATUS.SHOPPING, STATUS.PREPPING, STATUS.COOKING, STATUS.DONE];

const ALL_STATUS = [STATUS.PENDING, ...FLOW, STATUS.CANCELED];

// 列表分段（F-006）
const SEGMENTS = {
  进行中: [STATUS.PENDING, STATUS.TAKEN, STATUS.SHOPPING, STATUS.PREPPING, STATUS.COOKING],
  已完成: [STATUS.DONE],
  已取消: [STATUS.CANCELED],
};

const CATEGORIES = ['荤菜', '素菜', '汤', '主食', '凉菜'];
const DIFFICULTIES = ['简单', '中等', '困难'];

const MAX_MEMBERS = 10;  // F-007 人数上限
const MIN_STEPS = 3;     // F-001 做法至少 3 步
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * 校验状态流转合法性。
 * 规则：允许从任意未终态转为已取消；否则只能沿 FLOW 前进一步。
 * @returns {{ok:boolean, msg?:string}}
 */
function canTransition(from, to) {
  if (!ALL_STATUS.includes(to)) return { ok: false, msg: '未知的订单状态' };
  if (from === STATUS.DONE || from === STATUS.CANCELED) {
    return { ok: false, msg: '订单已结束，不能再变更状态' };
  }
  if (to === STATUS.CANCELED) return { ok: true };
  if (from === STATUS.PENDING) {
    return to === STATUS.TAKEN
      ? { ok: true }
      : { ok: false, msg: '订单还未被接单，请先接单' };
  }
  const fromIdx = FLOW.indexOf(from);
  const toIdx = FLOW.indexOf(to);
  if (toIdx === -1) return { ok: false, msg: '请按顺序更新状态' };
  if (toIdx <= fromIdx) return { ok: false, msg: '请按顺序更新状态' };
  if (toIdx > fromIdx + 1) return { ok: false, msg: '请按顺序更新状态' };
  return { ok: true };
}

/** 下一个可推进状态，已是终态返回 null */
function nextStatus(cur) {
  if (cur === STATUS.PENDING) return STATUS.TAKEN;
  const i = FLOW.indexOf(cur);
  if (i === -1 || i >= FLOW.length - 1) return null;
  return FLOW[i + 1];
}

/** 忌口命中检测：菜品食材 vs 成员忌口列表（F-008） */
function matchTaboos(ingredients, taboos) {
  const hits = [];
  const names = (ingredients || []).map((x) => String(x && x.name ? x.name : x));
  for (const t of taboos || []) {
    const key = String(t).trim();
    if (!key) continue;
    if (names.some((n) => n.includes(key) || key.includes(n))) hits.push(key);
  }
  return [...new Set(hits)];
}

/** 用餐时间文案 → 实际日期 YYYY-MM-DD */
function resolveMealDate(mealTime, now = new Date()) {
  const d = new Date(now.getTime());
  const text = String(mealTime || '');
  if (text.includes('明天')) d.setDate(d.getDate() + 1);
  else if (text.includes('后天')) d.setDate(d.getDate() + 2);
  else if (text.includes('周末')) {
    const day = d.getDay();
    const delta = day === 6 ? 0 : day === 0 ? 0 : 6 - day;
    d.setDate(d.getDate() + delta);
  }
  return toDateStr(d);
}

function toDateStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

module.exports = {
  STATUS, FLOW, ALL_STATUS, SEGMENTS, CATEGORIES, DIFFICULTIES,
  MAX_MEMBERS, MIN_STEPS, MAX_IMAGE_BYTES,
  canTransition, nextStatus, matchTaboos, resolveMealDate, toDateStr,
};
