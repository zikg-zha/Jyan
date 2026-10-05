'use strict';
/**
 * 前端渲染测试：jsdom + 真实 Vue 运行时挂载真实组件，
 * 数据走 PGlite 里的 supabase/schema.sql，实时同步由 fake-supabase 模拟 Realtime，
 * 验证页面在浏览器语义下确实可用。
 * 覆盖：登录、订单列表、菜品库、点菜与忌口提醒、进度推进、消息、我的、实时刷新。
 */
// 演示数据的「今天」按北京时间生成，前端按本地时区算今天，这里固定时区避免 CI 跨日
process.env.TZ = 'Asia/Shanghai';

const test = require('node:test');
const { before, after } = require('node:test');
const assert = require('node:assert');
const { createDb } = require('./helpers/pg');
const { createFakeSupabase } = require('./helpers/fake-supabase');
const { startDom } = require('./helpers/dom');

let h;
let fake;
let dom;
let store;
let api;

before(async () => {
  h = await createDb();
  fake = createFakeSupabase(h);
  await h.enableRealtime(fake.dispatch);
  // 模拟「这台设备之前已登录过妈妈」，bootstrap 应恢复会话
  fake.state.uid = await h.loginAs('妈妈');
  dom = await startDom({ supabase: fake });
  store = await dom.load('store.js');
  ({ api } = await dom.load('api.js'));
  await store.bootstrap();
  await dom.waitFor(() => store.state.member && store.state.members.length > 0);
});

after(async () => {
  try {
    await store.logout();
  } catch (_) { /* 忽略 */ }
  await dom.close();
  await h.close();
});

test('登录态与实时通道：bootstrap 后恢复会话并连上 Realtime', async () => {
  assert.strictEqual(store.state.member.name, '妈妈');
  assert.ok(store.state.family, '应恢复家庭信息');
  assert.ok(store.state.members.length >= 5, '应加载家庭成员');
  // 频道订阅成功后 connected 置真，否则会退化为 3 秒轮询
  await dom.waitFor(() => store.state.connected === true);
  assert.strictEqual(store.state.connected, true);
  // Presence：自己应显示在线
  await dom.waitFor(() => store.isOnline(store.state.member.id));
});

test('登录页：渲染表单并支持快捷切换成员', async () => {
  const { Login } = await dom.load('components/Login.js');
  const w = await dom.mount(Login);

  assert.match(w.text(), /家宴/);
  assert.match(w.text(), /一家人的点菜协作平台/);
  const inviteInput = w.find('#login-invite');
  const nameInput = w.find('#login-name');
  const pwdInput = w.find('#login-pwd');
  assert.ok(inviteInput && nameInput && pwdInput, '应渲染邀请码、成员名与密码输入框');
  assert.strictEqual(pwdInput.getAttribute('type'), 'password', '密码框不应明文');
  assert.strictEqual(pwdInput.value, '', '不应预填密码');

  // 快捷成员按钮点击后回填输入框
  await w.click(w.findByText('.quick-login .opt', '爷爷'));
  assert.strictEqual(w.find('#login-name').value, '爷爷');
  w.unmount();
});

test('菜品库：渲染菜品卡片，分类与搜索可过滤', async () => {
  const { DishLibrary } = await dom.load('components/DishLibrary.js');
  const w = await dom.mount(DishLibrary);

  await dom.waitFor(() => w.all('.dish-card').length > 0);
  const total = w.all('.dish-card').length;
  assert.ok(total >= 20, `菜品库应有 20 道以上，实际 ${total}`);

  // 分类筛选：切到「汤」后数量收敛且全部是汤
  await w.click(w.findByText('.filter-bar .chip', '汤'));
  await dom.waitFor(() => w.all('.dish-card').length > 0 && w.all('.dish-card').length < total);
  const soups = w.all('.dish-card');
  assert.ok(soups.length > 0 && soups.length < total, '分类筛选应收窄结果');
  for (const card of soups) {
    assert.match(card.textContent, /汤/, '分类筛选后应只剩汤类');
  }

  // 关键词搜索（组件内有 220ms 防抖）
  await w.click(w.findByText('.filter-bar .chip', '全部'));
  await dom.waitFor(() => w.all('.dish-card').length === total);
  await w.type(w.find('input[aria-label="搜索菜品名称"]'), '红烧');
  await dom.waitFor(() => {
    const cards = w.all('.dish-card');
    return cards.length > 0 && cards.every((c) => c.textContent.includes('红烧'));
  });
  w.unmount();
});

test('订单列表：渲染订单卡片，分段与筛选切换生效', async () => {
  const { OrderList } = await dom.load('components/OrderList.js');
  const opened = [];
  const w = await dom.mount(OrderList, { onOpen: (o) => opened.push(o) });

  // 默认「进行中 + 今日」
  await dom.waitFor(() => w.all('.order-card').length > 0);
  assert.ok(w.all('.order-card').length > 0, '进行中应有订单');
  // 待接单订单展示接单按钮，已接单订单展示更新进度
  assert.ok(w.findByText('.order-card .btn', '接单'), '待接单订单应有接单按钮');

  // 切到「全部时间」后订单不少于今日
  const todayCount = w.all('.order-card').length;
  await w.click(w.findByText('.filter-bar .chip', '全部时间'));
  await dom.waitFor(() => w.all('.order-card').length >= todayCount);
  assert.ok(w.all('.order-card').length >= todayCount);

  // 切到「已完成」分段，卡片状态应全为已完成
  await w.click(w.findByText('.seg button', '已完成'));
  await dom.waitFor(() => {
    const cards = w.all('.order-card');
    return cards.length > 0 && cards.every((c) => c.querySelector('.st-已完成'));
  });
  assert.ok(w.all('.order-card').length > 0, '已完成分段应有订单');

  // 点击卡片向上抛出 open 事件（父级据此打开详情）
  await w.click(w.find('.order-card'));
  assert.strictEqual(opened.length, 1, '点击订单卡片应触发 open');
  assert.ok(opened[0].id, 'open 事件应带上订单对象');
  w.unmount();
});

test('点菜页：勾选忌口菜品弹出提醒，可仍然提交并生成订单', async () => {
  const { OrderCreate } = await dom.load('components/OrderCreate.js');
  const submitted = [];
  const w = await dom.mount(OrderCreate, { onSubmitted: (o) => submitted.push(o) });

  await dom.waitFor(() => w.all('.selectable-dish').length > 0);

  // 「为谁点」改为爷爷（忌海鲜、虾），触发忌口比对
  await w.click(w.findByText('.opt', '妈妈'));           // 取消默认的自己
  await w.click(w.findByText('.opt', '爷爷'));
  // 紫菜蛋花汤含虾，命中爷爷忌口
  await w.click(w.findByText('.selectable-dish', '紫菜蛋花汤'));

  await dom.waitFor(() => w.find('.sheet'));
  assert.match(w.find('.sheet').textContent, /忌口提醒/, '应弹出忌口提醒');
  assert.match(w.find('.sheet').textContent, /爷爷忌口/, '提醒应点明是谁忌口');
  assert.match(w.find('.sheet').textContent, /若是代别人点可忽略/, '提醒不应阻断下单');

  // 选择「仍然选择」保留该菜品，再提交
  await w.click(w.findByText('.sheet .btn', '仍然选择'));
  await dom.waitFor(() => !w.find('.sheet'));

  await w.click(w.findByText('.bottom-bar .btn', '提交点菜单'));
  // 提交前会再校验一次忌口，命中后需要确认「仍然提交」
  await dom.waitFor(() => w.find('.sheet'));
  await w.click(w.findByText('.sheet .btn', '仍然提交'));

  await dom.waitFor(() => submitted.length === 1, { timeout: 6000 });
  assert.strictEqual(submitted.length, 1, '应提交成功并抛出 submitted');
  assert.ok(submitted[0].id, '返回的订单应有 id');
  assert.strictEqual(submitted[0].status, '待接单');
  assert.ok(
    submitted[0].dishes.some((d) => d.name === '紫菜蛋花汤'),
    '忌口提醒只提示不拦截，菜品应仍在订单里',
  );
  w.unmount();
});

test('进度弹层：只放开下一步，早于当前的状态置灰', async () => {
  const { ProgressSheet } = await dom.load('components/ProgressSheet.js');
  // 取一个妈妈接单、处于「采购中」的订单
  const list = await api.orders({ segment: '进行中', scope: '全部' });
  const order = list.items.find(
    (o) => o.status === '采购中' && o.taker && o.taker.id === store.state.member.id,
  );
  assert.ok(order, '演示数据应包含妈妈接单且处于采购中的订单');

  const updates = [];
  const w = await dom.mount(ProgressSheet, { order, onUpdated: (o) => updates.push(o) });

  const optText = (needle) => w.findByText('.opt', needle);
  // 已经走过的状态：置灰 + 标注已完成
  assert.ok(optText('已接单').disabled, '已走过的状态应不可点');
  assert.match(optText('已接单').textContent, /已完成/);
  // 当前状态本身也不可再选
  assert.ok(optText('采购中').disabled, '当前状态应不可重复提交');
  // 下一步「准备中」可选，且默认已选中（来自 next_status）
  assert.ok(!optText('准备中').disabled, '下一步应可选');
  assert.match(optText('准备中').className, /active/, '应默认选中下一步');
  // 跨步状态被锁住
  assert.ok(optText('烹饪中').disabled, '跨步状态应锁住');
  assert.match(optText('烹饪中').textContent, /待前一步/);
  assert.ok(optText('已完成').disabled, '跨步状态应锁住');

  // 提交后按 FLOW 推进一步
  await w.click(w.findByText('.btn', '确认更新'));
  await dom.waitFor(() => updates.length === 1, { timeout: 6000 });
  assert.strictEqual(updates[0].status, '准备中');
  assert.ok(updates[0].version > order.version, '乐观锁版本号应递增');
  w.unmount();
});

test('进度弹层：版本过期时按服务端最新状态同步（乐观锁 409）', async () => {
  const { ProgressSheet } = await dom.load('components/ProgressSheet.js');
  const list = await api.orders({ segment: '进行中', scope: '全部' });
  const order = list.items.find(
    (o) => o.status === '已接单' && o.taker && o.taker.id === store.state.member.id,
  );
  assert.ok(order, '演示数据应包含妈妈接单且处于已接单的订单');

  // 模拟异地家人先提交了一步，手里的 version 变旧
  const ahead = await api.updateStatus(order.id, { status: '采购中', version: order.version });
  assert.strictEqual(ahead.status, '采购中');

  const updates = [];
  const w = await dom.mount(ProgressSheet, {
    order: { ...order, next_status: '采购中' },
    onUpdated: (o) => updates.push(o),
  });
  await w.click(w.findByText('.btn', '确认更新'));

  // 冲突不报错，而是回落到服务端权威状态
  await dom.waitFor(() => updates.length === 1, { timeout: 6000 });
  assert.strictEqual(updates[0].status, '采购中', '应同步为服务端最新状态');
  assert.match(store.state.toast, /订单已被其他家人更新/, '应提示已同步最新状态');
  w.unmount();
});

test('消息中心：渲染通知列表，全部已读后未读归零', async () => {
  const { Messages } = await dom.load('components/Messages.js');
  const w = await dom.mount(Messages);

  await dom.waitFor(() => w.all('.msg-item').length > 0);
  assert.ok(w.all('.msg-item').length > 0, '应渲染通知条目');
  assert.ok(store.state.unread > 0, '演示数据应有未读通知');
  assert.ok(w.all('.msg-item.unread').length > 0, '未读通知应有未读样式');

  await w.click(w.findByText('.btn', '全部已读'));
  await dom.waitFor(() => store.state.unread === 0);
  assert.strictEqual(store.state.unread, 0);
  assert.strictEqual(w.all('.msg-item.unread').length, 0, '全部已读后不应残留未读样式');
  w.unmount();
});

test('我的：渲染成员资料、统计看板与做饭贡献榜', async () => {
  const { Profile } = await dom.load('components/Profile.js');
  const w = await dom.mount(Profile);

  await dom.waitFor(() => w.all('.stat-box').length === 4);
  assert.match(w.text(), /妈妈/, '应展示当前成员');
  assert.match(w.text(), /幸福一家/, '应展示家庭名称');
  assert.strictEqual(w.all('.stat-box').length, 4, '统计看板应有 4 个指标');
  assert.match(w.text(), /做饭贡献/, '应展示贡献榜');

  // 贡献榜按次数倒序
  const counts = w.all('.rank-item').slice(0, 3)
    .map((el) => Number(el.textContent.trim().match(/(\d+)\s*$/)?.[1] ?? NaN))
    .filter((n) => !Number.isNaN(n));
  assert.ok(counts.length > 0, '贡献榜应有数据');
  for (let i = 1; i < counts.length; i += 1) {
    assert.ok(counts[i - 1] >= counts[i], '贡献榜应按做饭次数倒序');
  }
  // 家庭成员上限提示
  assert.match(w.text(), /10/, '应展示家庭成员上限');
  w.unmount();
});

test('实时同步：他人下单后订单列表自动刷新（≤5 秒）', async () => {
  const { OrderList } = await dom.load('components/OrderList.js');
  const w = await dom.mount(OrderList);
  await dom.waitFor(() => w.all('.order-card').length > 0);

  // 切到全部时间，避免用餐日期落在今日之外导致断言不稳
  await w.click(w.findByText('.filter-bar .chip', '全部时间'));
  await dom.waitFor(() => w.all('.order-card').length > 0);
  const before = w.all('.order-card').length;

  // 以爸爸的身份（另一台设备）直接调用数据库函数下单，不经过当前页面
  const dishes = await api.dishes({ keyword: '西红柿' });
  assert.ok(dishes.length > 0, '应能查到用于下单的菜品');
  const dad = await h.loginAs('爸爸');
  const started = Date.now();
  const created = await h.rpc(dad, 'create_order', {
    p_dish_ids: [dishes[0].id], p_meal_time: '今天晚饭', p_people: 4, p_note: '实时刷新验证',
  });
  assert.ok(created.id, '后台下单应成功');

  // Realtime 推送后列表自增，无需手动刷新
  await dom.waitFor(() => w.all('.order-card').length > before, { timeout: 5000 });
  const cost = Date.now() - started;
  assert.ok(w.all('.order-card').length > before, '收到实时事件后列表应新增订单');
  assert.ok(cost < 5000, `实时刷新应在 5 秒内，实际 ${cost}ms`);
  w.unmount();
});
