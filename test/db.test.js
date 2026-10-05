'use strict';
/** supabase/schema.sql 业务函数 + 权限测试（PGlite） */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb, statusOf } = require('./helpers/pg');

let h;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
const rejectsWith = (p, status, re) => assert.rejects(p, (err) => {
  assert.equal(statusOf(err), status, `期望 ${status}，实际 ${err.message}`);
  if (re) assert.match(err.message, re);
  return true;
});

test.before(async () => { h = await createDb(); });
test.after(async () => { await h.close(); });

test('演示数据：5 位成员、22 道菜、20 个订单', async () => {
  const [r] = await h.sql(`select (select count(*)::int from members) m, (select count(*)::int from dishes) d,
    (select count(*)::int from orders) o`);
  assert.deepEqual(r, { m: 5, d: 22, o: 20 });
  assert.match(await h.inviteCode(), /^[0-9A-F]{8}$/);
});

test('登录：密码错误返回 ok:false，成功后 me 可取到成员与家庭', async () => {
  const uid = await h.newUser();
  const code = await h.inviteCode();
  const bad = await h.rpc(uid, 'login', { p_invite_code: code, p_name: '爸爸', p_password: 'wrong' });
  assert.deepEqual(bad, { ok: false, message: '邀请码、成员名或密码不正确' });
  assert.equal(await h.rpc(uid, 'me'), null);

  const ok = await h.rpc(uid, 'login', { p_invite_code: code.toLowerCase(), p_name: ' 爸爸 ', p_password: '123456' });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.member.name, '爸爸');
  assert.equal(ok.data.family.invite_code, code);
  assert.ok(ok.data.family.channel_key);
  assert.equal((await h.rpc(uid, 'me')).member.name, '爸爸');

  await h.rpc(uid, 'logout');
  assert.equal(await h.rpc(uid, 'me'), null);
  await rejectsWith(h.rpc(uid, 'list_dishes'), 401);
});

test('登录限流：同一成员连续失败 5 次后锁定 15 分钟', async () => {
  const code = await h.inviteCode();
  for (let i = 0; i < 5; i += 1) {
    const uid = await h.newUser();  // 换设备也算同一成员
    const r = await h.rpc(uid, 'login', { p_invite_code: code, p_name: '爷爷', p_password: 'nope' });
    assert.equal(r.ok, false);
  }
  const uid = await h.newUser();
  const r = await h.rpc(uid, 'login', { p_invite_code: code, p_name: '爷爷', p_password: '123456' });
  assert.deepEqual(r, { ok: false, message: '尝试次数过多，请 15 分钟后再试' });
  await h.sql("delete from private.login_attempts where key like 'm:%爷爷'");
});

test('权限：anon 不能调用函数；已登录也不能直接写表或读私有表', async () => {
  await assert.rejects(h.as(null, 'select public.list_dishes()'), /permission denied/);
  const uid = await h.loginAs('妈妈');
  await assert.rejects(h.as(uid, "insert into public.dishes (family_id, name, category) values (1, 'x', '汤')"),
    /permission denied/);
  await assert.rejects(h.as(uid, 'update public.orders set status = \'已完成\''), /permission denied/);
  await assert.rejects(h.as(uid, 'select * from private.member_secrets'), /permission denied/);
  await assert.rejects(h.as(uid, "select private.notify(1, array[1], null, null, 'status', 'x')"),
    /permission denied/);
});

test('RLS：不同家庭之间数据隔离', async () => {
  const [f] = await h.sql("insert into families (name, invite_code) values ('隔壁', 'OTHER001') returning id");
  const [m] = await h.sql(`insert into members (family_id, name, avatar_text) values ($1, '王叔', '王') returning id`,
    [f.id]);
  await h.sql("insert into private.member_secrets values ($1, extensions.crypt('654321', extensions.gen_salt('bf', 4)))",
    [m.id]);
  const other = await h.loginAs('王叔', '654321', 'OTHER001');
  const mine = await h.loginAs('妈妈');

  const seen = await h.as(other, 'select count(*)::int c from public.orders');
  assert.equal(seen.rows[0].c, 0);
  const members = await h.as(other, 'select name from public.members');
  assert.deepEqual(members.rows.map((r) => r.name), ['王叔']);
  assert.equal((await h.as(mine, 'select count(*)::int c from public.members')).rows[0].c, 5);
  assert.equal((await h.as(other, 'select count(*)::int c from public.notifications')).rows[0].c, 0);

  await rejectsWith(h.rpc(other, 'get_order', { p_id: 1 }), 404);
  await rejectsWith(h.rpc(other, 'take_order', { p_id: 1 }), 404);
  await rejectsWith(h.rpc(other, 'get_dish', { p_id: 1 }), 404);
  // 下单时引用别家菜品、指派别家成员都会被拒绝
  await rejectsWith(h.rpc(other, 'create_order', { p_dish_ids: [1] }), 400, /所选菜品不存在/);
  const [myMember] = await h.sql("select id from members where name = '妈妈'");
  await rejectsWith(h.rpc(mine, 'update_member', { p_id: m.id, p_preference: 'x' }), 404);
  assert.equal((await h.rpc(other, 'list_members')).length, 1);
  assert.ok(myMember.id);
});

test('下单：全家收到通知、被指派人额外收到指派通知、菜品被点次数 +1', async () => {
  const uid = await h.loginAs('哥哥');
  const [dish] = await h.sql("select id, order_count from dishes where name = '红烧肉' and family_id = 1");
  const [dad] = await h.sql("select id from members where name = '爸爸' and family_id = 1");
  const before = await h.sql('select count(*)::int c from notifications');

  const o = await h.rpc(uid, 'create_order', {
    p_dish_ids: [dish.id], p_meal_time: '明天晚饭', p_meal_date: '2030-01-02', p_people: 4,
    p_note: ' 少盐 ', p_eat_for: '妹妹', p_assignee_id: dad.id,
  });
  assert.equal(o.status, '已接单');
  assert.equal(o.meal_date, '2030-01-02');
  assert.equal(o.note, '少盐');
  assert.equal(o.taker.name, '爸爸');
  assert.equal(o.next_status, '采购中');
  assert.deepEqual(o.progress.map((p) => p.remark), ['下单并指派给爸爸']);

  const after = await h.sql('select count(*)::int c from notifications');
  assert.equal(after[0].c - before[0].c, 5);  // 4 位家人新订单 + 爸爸指派
  const notes = await h.sql(`select n.type, n.title, m.name from notifications n join members m on m.id = n.member_id
    where n.order_id = $1 order by n.id`, [o.id]);
  assert.ok(!notes.some((n) => n.name === '哥哥'), '不给下单人自己发');
  assert.deepEqual(notes.filter((n) => n.type === 'assigned').map((n) => [n.name, n.title]),
    [['爸爸', '哥哥 指派你做「红烧肉」']]);
  assert.equal(notes.find((n) => n.type === 'new_order').title, '哥哥 发起点菜单「红烧肉」');
  const [d2] = await h.sql('select order_count from dishes where id = $1', [dish.id]);
  assert.equal(d2.order_count, dish.order_count + 1);

  await rejectsWith(h.rpc(uid, 'create_order', { p_dish_ids: [] }), 400, /至少选择一道菜/);
});

test('接单：先到先得，后到者转为协作；已结束订单返回 409', async () => {
  const code = await h.inviteCode();
  const mom = await h.loginAs('妈妈', '123456', code);
  const kid = await h.loginAs('妹妹', '123456', code);
  const [dish] = await h.sql("select id from dishes where name = '米饭' and family_id = 1");
  const o = await h.rpc(mom, 'create_order', { p_dish_ids: [dish.id] });
  assert.equal(o.status, '待接单');

  const dad = await h.loginAs('爸爸', '123456', code);
  const first = await h.rpc(dad, 'take_order', { p_id: o.id });
  assert.equal(first.joined_as_collaborator, false);
  assert.equal(first.order.taker.name, '爸爸');

  const second = await h.rpc(kid, 'take_order', { p_id: o.id });
  assert.equal(second.joined_as_collaborator, true);
  assert.equal(second.message, '该订单已被接单，已把你加入协作');
  assert.deepEqual(second.order.collaborators.map((c) => c.name), ['妹妹']);
  assert.equal(second.order.taker.name, '爸爸');

  await h.rpc(mom, 'cancel_order', { p_id: o.id, p_reason: '不吃了' });
  await rejectsWith(h.rpc(kid, 'take_order', { p_id: o.id }), 409, /订单已结束/);
});

test('进度：按序推进、跳步被拒、非相关人 403、版本冲突 409 带最新订单', async () => {
  const code = await h.inviteCode();
  const mom = await h.loginAs('妈妈', '123456', code);
  const dad = await h.loginAs('爸爸', '123456', code);
  const grandpa = await h.loginAs('爷爷', '123456', code);
  const [dish] = await h.sql("select id from dishes where name = '炒青菜' and family_id = 1");
  const o = await h.rpc(mom, 'create_order', { p_dish_ids: [dish.id] });

  await rejectsWith(h.rpc(dad, 'update_status', { p_id: o.id, p_status: '采购中' }), 403);
  const taken = (await h.rpc(dad, 'take_order', { p_id: o.id })).order;
  await rejectsWith(h.rpc(dad, 'update_status', { p_id: o.id, p_status: '烹饪中' }), 400, /请按顺序/);
  await rejectsWith(h.rpc(grandpa, 'update_status', { p_id: o.id, p_status: '采购中' }), 403);

  const s1 = await h.rpc(dad, 'update_status', {
    p_id: o.id, p_status: '采购中', p_remark: '去菜市场', p_photo_url: 'javascript:alert(1)', p_version: taken.version,
  });
  assert.equal(s1.status, '采购中');
  assert.equal(s1.version, taken.version + 1);
  assert.equal(s1.progress.at(-1).photo_url, '');  // 非 http(s) 地址被清掉
  assert.equal(s1.progress.at(-1).member_name, '爸爸');

  // 用旧版本号提交：409 + detail 里带最新订单
  await assert.rejects(h.rpc(mom, 'update_status', { p_id: o.id, p_status: '准备中', p_version: taken.version }),
    (err) => {
      assert.equal(statusOf(err), 409);
      const latest = JSON.parse(err.detail);
      assert.equal(latest.status, '采购中');
      assert.equal(latest.version, s1.version);
      return true;
    });

  let cur = s1;
  for (const st of ['准备中', '烹饪中', '已完成']) {
    cur = await h.rpc(mom, 'update_status', { p_id: o.id, p_status: st, p_version: cur.version });
  }
  assert.equal(cur.segment, '已完成');
  assert.ok(cur.completed_at);
  assert.equal(cur.next_status, null);
  await rejectsWith(h.rpc(mom, 'cancel_order', { p_id: o.id }), 400, /订单已结束/);

  const [done] = await h.sql("select type, title from notifications where order_id = $1 and type = 'done'", [o.id]);
  assert.equal(done.title, '妈妈 完成了「炒青菜」');
});

test('指派：只有下单人能指派，待接单 → 已接单', async () => {
  const code = await h.inviteCode();
  const mom = await h.loginAs('妈妈', '123456', code);
  const kid = await h.loginAs('哥哥', '123456', code);
  const [dish] = await h.sql("select id from dishes where name = '蛋炒饭' and family_id = 1");
  const [grandpa] = await h.sql("select id from members where name = '爷爷' and family_id = 1");
  const o = await h.rpc(mom, 'create_order', { p_dish_ids: [dish.id] });
  await rejectsWith(h.rpc(kid, 'assign_order', { p_id: o.id, p_member_id: grandpa.id }), 403);
  const r = await h.rpc(mom, 'assign_order', { p_id: o.id, p_member_id: grandpa.id });
  assert.equal(r.status, '已接单');
  assert.equal(r.taker.name, '爷爷');
  await rejectsWith(h.rpc(mom, 'assign_order', { p_id: o.id, p_member_id: 999999 }), 400);

  const c = await h.rpc(kid, 'collaborate', { p_id: o.id });
  assert.deepEqual(c.collaborators.map((x) => x.name), ['哥哥']);
  const g = await h.loginAs('爷爷', '123456', code);
  await rejectsWith(h.rpc(g, 'collaborate', { p_id: o.id }), 400, /已是该订单接单人/);
});

test('订单列表：今日进行中、我下单的、我接单的', async () => {
  const mom = await h.loginAs('妈妈');
  const t = today();
  const all = await h.rpc(mom, 'list_orders', { p_segment: '进行中', p_scope: '今日', p_today: t });
  assert.ok(all.items.every((o) => o.segment === '进行中' && o.meal_date === t));
  assert.ok(all.items.length >= 8);
  assert.equal(typeof all.elapsed_ms, 'number');

  const mine = await h.rpc(mom, 'list_orders', { p_segment: '已完成', p_scope: '全部', p_relation: '我下单的' });
  assert.ok(mine.items.length > 0 && mine.items.every((o) => o.creator.name === '妈妈'));
  const took = await h.rpc(mom, 'list_orders', { p_segment: '已完成', p_scope: '全部', p_relation: '我接单的' });
  assert.ok(took.items.every((o) => o.taker.name === '妈妈'));

  const detail = await h.rpc(mom, 'get_order', { p_id: all.items[0].id });
  assert.ok(Array.isArray(detail.progress));
});

test('菜品：校验 3 步做法、名称唯一、清洗图片地址、增删改', async () => {
  const uid = await h.loginAs('妹妹');
  const base = {
    name: '桂花糯米藕', category: '凉菜', difficulty: '超难', duration: '0', servings: 'abc',
    cover_url: 'javascript:alert(1)', icon: 'fa-leaf" onclick="x',
    ingredients: [{ name: ' 莲藕 ', amount: 2, unit: '节' }, { name: '' }],
    steps: [{ title: '', desc: '洗藕' }, { title: '灌米', desc: '' }, { desc: '  ' }],
  };
  await rejectsWith(h.rpc(uid, 'create_dish', { p_payload: base }), 400, /至少需要 3 步/);
  await rejectsWith(h.rpc(uid, 'create_dish', { p_payload: { ...base, category: '甜品' } }), 400, /分类不正确/);

  const payload = { ...base, steps: [...base.steps, { desc: '蒸 1 小时', photo: 'https://x.test/a.jpg' }] };
  const d = await h.rpc(uid, 'create_dish', { p_payload: payload });
  assert.equal(d.difficulty, '简单');
  assert.equal(d.duration, 30);
  assert.equal(d.servings, 2);
  assert.equal(d.cover_url, '');
  assert.equal(d.icon, 'fa-utensils');
  assert.deepEqual(d.ingredients, [{ name: '莲藕', amount: '2', unit: '节' }]);
  assert.deepEqual(d.steps.map((s) => s.title), ['步骤 1', '灌米', '步骤 3']);
  assert.equal(d.steps[2].photo, 'https://x.test/a.jpg');

  await rejectsWith(h.rpc(uid, 'create_dish', { p_payload: payload }), 400, /已存在/);
  const u = await h.rpc(uid, 'update_dish', { p_id: d.id, p_payload: { ...payload, name: '糯米藕', duration: 90 } });
  assert.equal(u.name, '糯米藕');
  assert.equal(u.duration, 90);
  await rejectsWith(h.rpc(uid, 'update_dish', { p_id: d.id, p_payload: { ...payload, name: '红烧肉' } }), 400);

  const found = await h.rpc(uid, 'list_dishes', { p_category: '凉菜', p_keyword: '糯米' });
  assert.deepEqual(found.map((x) => x.name), ['糯米藕']);
  assert.deepEqual(await h.rpc(uid, 'delete_dish', { p_id: d.id }), { id: d.id });
  await rejectsWith(h.rpc(uid, 'delete_dish', { p_id: d.id }), 404);
});

test('忌口检查：食材与忌口双向包含即提醒', async () => {
  const uid = await h.loginAs('妈妈');
  const dishes = await h.sql("select id, name from dishes where family_id = 1 and name in ('凉拌黄瓜', '米饭', '紫菜蛋花汤')");
  const members = await h.sql("select id, name from members where family_id = 1 and name in ('妹妹', '爷爷', '妈妈')");
  const r = await h.rpc(uid, 'taboo_check', {
    p_dish_ids: dishes.map((d) => d.id), p_member_ids: members.map((m) => m.id),
  });
  const msgs = r.warnings.map((w) => w.message).sort();
  assert.deepEqual(msgs, [
    '该菜品「凉拌黄瓜」含香菜，妹妹忌口。若是代别人点可忽略。',
    '该菜品「紫菜蛋花汤」含虾，爷爷忌口。若是代别人点可忽略。',
  ]);
  assert.deepEqual(await h.rpc(uid, 'taboo_check', { p_dish_ids: [], p_member_ids: [1] }), { warnings: [] });
});

test('消息中心：列表、未读数、单条已读、全部已读', async () => {
  const uid = await h.loginAs('爷爷');
  const list = await h.rpc(uid, 'list_notifications', { p_limit: 5 });
  assert.ok(list.items.length > 0 && list.items.length <= 5);
  assert.equal(list.items[0].family_id, undefined);
  const { unread } = await h.rpc(uid, 'unread_count');
  assert.equal(unread, list.unread);
  await h.rpc(uid, 'read_notification', { p_id: list.items[0].id });
  assert.equal((await h.rpc(uid, 'unread_count')).unread, unread - (list.items[0].is_read ? 0 : 1));
  const all = await h.rpc(uid, 'read_all_notifications');
  assert.equal(all.updated, unread - (list.items[0].is_read ? 0 : 1));
  assert.equal((await h.rpc(uid, 'unread_count')).unread, 0);
});

test('统计：贡献榜、热门菜、谁给谁做过菜', async () => {
  const fresh = await createDb();
  try {
    const uid = await fresh.loginAs('妈妈');
    const s = await fresh.rpc(uid, 'family_stats');
    const counts = Object.fromEntries(s.contributors.map((c) => [c.name, c.cook_count]));
    assert.deepEqual(counts, { 爸爸: 4, 妈妈: 3, 哥哥: 1, 妹妹: 0, 爷爷: 0 });
    assert.equal(s.contributors[0].percent, 100);
    assert.equal(s.contributors[1].percent, 75);
    assert.deepEqual(s.summary, {
      total_orders: 20, done_orders: 8, canceled_orders: 2, dish_total: 22, member_total: 5, close_rate: 40,
    });
    assert.ok(s.popular.length > 0 && s.popular.length <= 10);
    assert.ok(s.pairs.some((p) => p.taker_name === '妈妈' && p.creator_name === '爸爸' && p.times === 2));
  } finally {
    await fresh.close();
  }
});

test('成员：邀请上限 10 人、重名拒绝、修改密码后其他设备下线', async () => {
  const code = await h.inviteCode();
  const mom = await h.loginAs('妈妈', '123456', code);
  const phone2 = await h.loginAs('妈妈', '123456', code);
  await rejectsWith(h.rpc(mom, 'add_member', { p_name: '爸爸', p_password: '123456' }), 400, /已存在/);
  await rejectsWith(h.rpc(mom, 'add_member', { p_name: '姑姑', p_password: '123' }), 400, /至少 6 位/);

  const added = await h.rpc(mom, 'add_member', { p_name: '姑姑', p_password: 'gugu2026', p_taboos: [' 辣椒 ', ''] });
  assert.deepEqual(added.taboos, ['辣椒']);
  const gugu = await h.loginAs('姑姑', 'gugu2026', code);
  assert.equal((await h.rpc(gugu, 'me')).member.name, '姑姑');

  for (const n of ['A1', 'A2', 'A3', 'A4']) await h.rpc(mom, 'add_member', { p_name: n, p_password: '123456' });
  await rejectsWith(h.rpc(mom, 'add_member', { p_name: 'A5', p_password: '123456' }), 400, /上限/);

  await rejectsWith(h.rpc(mom, 'change_password', { p_old: 'bad', p_new: 'abcdef' }), 400, /原密码不正确/);
  await h.rpc(mom, 'change_password', { p_old: '123456', p_new: 'mama-new-pass' });
  assert.equal(await h.rpc(phone2, 'me'), null);            // 另一台设备被下线
  assert.equal((await h.rpc(mom, 'me')).member.name, '妈妈'); // 当前设备保留
  await h.loginAs('妈妈', 'mama-new-pass', code);
});
