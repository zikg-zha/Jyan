#!/usr/bin/env node
'use strict';
/**
 * 部署后核心流程冒烟验证（对运行中的服务发真实 HTTP 请求）
 * 用法：node scripts/smoke.js [baseUrl]   默认 http://127.0.0.1:3000
 * 覆盖：健康检查 → 登录 → 菜品库 → 下单 → 接单 → 六态推进 → 消息 → 统计 → 首页可达
 */
const BASE = (process.argv[2] || process.env.SMOKE_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');

const results = [];
let failed = 0;

function record(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  if (!ok) failed += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function call(method, apiPath, { memberId, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (memberId) headers['x-member-id'] = String(memberId);
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}/api${apiPath}`, init);
  let payload = null;
  try {
    payload = await res.json();
  } catch (_) { /* 非 JSON */ }
  return { status: res.status, body: payload, data: payload && payload.data };
}

async function main() {
  console.log(`[smoke] 目标服务 ${BASE}`);

  // 1. 健康检查
  const health = await call('GET', '/health');
  record('健康检查 /api/health', health.status === 200 && health.data && health.data.status === 'healthy',
    health.data ? `uptime ${health.data.uptime_s}s` : `HTTP ${health.status}`);
  if (health.status !== 200) {
    console.log('[smoke] 服务不可达，终止后续验证');
    process.exit(1);
  }

  // 2. 首页与静态资源可达
  const page = await fetch(`${BASE}/`);
  const html = await page.text();
  record('首页 HTML 可达', page.ok && html.includes('家宴'), `HTTP ${page.status}`);
  for (const asset of ['/js/main.js', '/css/app.css', '/vendor/vue.esm-browser.prod.js']) {
    const r = await fetch(`${BASE}${asset}`);
    record(`静态资源 ${asset}`, r.ok, `HTTP ${r.status}`);
  }

  // 3. 登录
  const login = await call('POST', '/auth/login', { body: { name: '妈妈', password: '123456' } });
  const mom = login.data && login.data.member;
  record('登录 妈妈/123456', login.status === 200 && !!mom,
    mom ? `家庭「${login.data.family.name}」邀请码 ${login.data.family.invite_code}` : login.body && login.body.message);
  if (!mom) process.exit(1);

  const dadLogin = await call('POST', '/auth/login', { body: { name: '爸爸', password: '123456' } });
  const dad = dadLogin.data && dadLogin.data.member;
  record('登录 爸爸/123456', dadLogin.status === 200 && !!dad);

  // 4. 成员与菜品库
  const members = await call('GET', '/members', { memberId: mom.id });
  record('家庭成员列表', members.status === 200 && members.data.length >= 5,
    `${members.data ? members.data.length : 0} 位家人`);

  const dishes = await call('GET', '/dishes', { memberId: mom.id });
  record('菜品库 ≥20 道', dishes.status === 200 && dishes.data.length >= 20,
    `${dishes.data ? dishes.data.length : 0} 道菜`);

  // 5. 今日进行中筛选性能
  const listing = await call('GET', '/orders?segment=进行中&scope=今日', { memberId: mom.id });
  record('今日进行中筛选 ≤500ms',
    listing.status === 200 && listing.data.elapsed_ms < 500,
    `${listing.data ? listing.data.total : 0} 个订单 / ${listing.data ? listing.data.elapsed_ms : '-'}ms`);

  // 6. 核心流程：下单 → 接单 → 推进到已完成
  const dish = dishes.data.find((d) => d.name === '西红柿炒蛋') || dishes.data[0];
  const created = await call('POST', '/orders', {
    memberId: mom.id,
    body: { dish_ids: [dish.id], meal_time: '今天晚饭', people: 2, note: '冒烟验证订单' },
  });
  const orderId = created.data && created.data.id;
  record('下单（待接单）', created.status === 200 && created.data.status === '待接单',
    orderId ? `订单 #${orderId} · ${dish.name}` : created.body && created.body.message);
  if (!orderId) process.exit(1);

  const taken = await call('POST', `/orders/${orderId}/take`, { memberId: dad.id });
  record('爸爸接单', taken.status === 200 && taken.data.order.status === '已接单');

  for (const status of ['采购中', '准备中', '烹饪中', '已完成']) {
    const r = await call('POST', `/orders/${orderId}/status`, {
      memberId: dad.id,
      body: { status, remark: `冒烟验证 ${status}` },
    });
    record(`进度推进 → ${status}`, r.status === 200 && r.data.status === status,
      r.status === 200 ? '' : r.body && r.body.message);
  }

  const detail = await call('GET', `/orders/${orderId}`, { memberId: mom.id });
  const trail = detail.data ? detail.data.progress.map((p) => p.status) : [];
  record('进度轨迹完整（六态）',
    ['待接单', '已接单', '采购中', '准备中', '烹饪中', '已完成'].every((s) => trail.includes(s)),
    trail.join(' → '));

  // 7. 状态顺序校验（异常分支）
  const bad = await call('POST', `/orders/${orderId}/status`, {
    memberId: dad.id, body: { status: '烹饪中' },
  });
  record('已完成订单拒绝再变更',
    bad.status === 400 && bad.body.message === '订单已结束，不能再变更状态',
    bad.body && bad.body.message);

  // 8. 忌口提醒
  const soup = dishes.data.find((d) => d.name === '紫菜蛋花汤');
  const grandpa = members.data.find((m) => m.name === '爷爷');
  if (soup && grandpa) {
    const taboo = await call('POST', '/dishes/taboo-check', {
      memberId: mom.id,
      body: { dish_ids: [soup.id], member_ids: [grandpa.id] },
    });
    record('忌口提醒命中',
      taboo.status === 200 && taboo.data.warnings.length > 0,
      taboo.data && taboo.data.warnings[0] ? taboo.data.warnings[0].message : '未命中');
  }

  // 9. 消息中心
  const msg = await call('GET', '/notifications', { memberId: mom.id });
  record('消息中心可读',
    msg.status === 200 && msg.data.items.some((n) => n.order_id === orderId),
    `${msg.data ? msg.data.items.length : 0} 条消息 / 未读 ${msg.data ? msg.data.unread : '-'}`);

  // 10. 历史统计
  const stats = await call('GET', '/stats', { memberId: mom.id });
  record('历史统计可读',
    stats.status === 200 && stats.data.contributors.length > 0 && stats.data.popular.length > 0,
    stats.data ? `完成 ${stats.data.summary.done_orders} 单 · 闭环率 ${stats.data.summary.close_rate}%` : '');

  // 收尾：取消冒烟订单不适用（已完成），保留作为数据痕迹
  console.log(`[smoke] ${results.length - failed}/${results.length} 项通过`);
  if (failed) {
    console.log(`[smoke] 失败 ${failed} 项`);
    process.exit(1);
  }
  console.log('[smoke] 核心流程验证通过');
}

main().catch((err) => {
  console.log(`[smoke] 执行异常：${err.message}`);
  process.exit(1);
});
