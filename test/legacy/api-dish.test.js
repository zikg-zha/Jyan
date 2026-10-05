'use strict';
/** 菜品库 + 忌口提醒接口测试（F-001 F-008） */
const test = require('node:test');
const assert = require('node:assert');
const { startServer } = require('./helpers/server');

let ctx;
test.before(async () => { ctx = await startServer('dish'); });
test.after(async () => { if (ctx) await ctx.close(); });

test('未登录访问菜品库返回 401「请先登录」', async () => {
  const r = await ctx.call('GET', '/dishes');
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.body.message, '请先登录');
});

test('演示数据至少 20 道菜，覆盖 5 个分类', async () => {
  const r = await ctx.call('GET', '/dishes', { memberId: ctx.members['妈妈'] });
  assert.strictEqual(r.status, 200);
  assert.ok(r.data.length >= 20, `实际 ${r.data.length} 道`);
  const cats = new Set(r.data.map((d) => d.category));
  for (const c of ['荤菜', '素菜', '汤', '主食', '凉菜']) {
    assert.ok(cats.has(c), `缺少分类 ${c}`);
  }
});

test('菜品列表支持分类筛选与名称搜索', async () => {
  const me = ctx.members['妈妈'];
  const soup = await ctx.call('GET', '/dishes?category=汤', { memberId: me });
  assert.ok(soup.data.length > 0);
  assert.ok(soup.data.every((d) => d.category === '汤'));

  const kw = await ctx.call('GET', '/dishes?keyword=红烧', { memberId: me });
  assert.ok(kw.data.some((d) => d.name === '红烧肉'));
});

test('新建菜品：缺少名称或分类提示「请填写菜品名称和分类」', async () => {
  const r = await ctx.call('POST', '/dishes', {
    memberId: ctx.members['妈妈'],
    body: { name: '', category: '荤菜', steps: [{ desc: 'a' }, { desc: 'b' }, { desc: 'c' }] },
  });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.message, '请填写菜品名称和分类');
});

test('新建菜品：做法少于 3 步提示「做法至少需要 3 步」', async () => {
  const r = await ctx.call('POST', '/dishes', {
    memberId: ctx.members['妈妈'],
    body: { name: '测试菜', category: '素菜', steps: [{ desc: '洗菜' }, { desc: '下锅' }] },
  });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.message, '做法至少需要 3 步');
});

test('新建菜品成功后可查详情，重名被拒绝', async () => {
  const me = ctx.members['妈妈'];
  const payload = {
    name: '葱油拌面',
    category: '主食',
    difficulty: '简单',
    duration: 20,
    servings: 2,
    ingredients: [{ name: '面条', amount: '200', unit: 'g' }, { name: '小葱', amount: '5', unit: '根' }],
    steps: [
      { title: '熬葱油', desc: '小火慢炸葱段至金黄' },
      { title: '煮面', desc: '面条煮熟捞出' },
      { title: '拌匀', desc: '加葱油与生抽拌匀' },
    ],
  };
  const created = await ctx.call('POST', '/dishes', { memberId: me, body: payload });
  assert.strictEqual(created.status, 200);
  assert.strictEqual(created.data.name, '葱油拌面');
  assert.strictEqual(created.data.steps.length, 3);
  assert.strictEqual(created.data.ingredients.length, 2);

  const detail = await ctx.call('GET', `/dishes/${created.data.id}`, { memberId: me });
  assert.strictEqual(detail.data.category, '主食');

  const dup = await ctx.call('POST', '/dishes', { memberId: me, body: payload });
  assert.strictEqual(dup.status, 400);
  assert.strictEqual(dup.body.message, '菜品「葱油拌面」已存在，请换个名称');

  const del = await ctx.call('DELETE', `/dishes/${created.data.id}`, { memberId: me });
  assert.strictEqual(del.status, 200);
  const gone = await ctx.call('GET', `/dishes/${created.data.id}`, { memberId: me });
  assert.strictEqual(gone.status, 404);
});

test('编辑菜品：可更新分类与步骤', async () => {
  const me = ctx.members['爸爸'];
  const list = await ctx.call('GET', '/dishes?keyword=手撕包菜', { memberId: me });
  const dish = list.data[0];
  const r = await ctx.call('PUT', `/dishes/${dish.id}`, {
    memberId: me,
    body: {
      ...dish,
      difficulty: '中等',
      steps: [...dish.steps, { title: '出锅', desc: '装盘' }],
    },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.difficulty, '中等');
  assert.strictEqual(r.data.steps.length, dish.steps.length + 1);
});

test('忌口提醒：命中忌口成员返回提示文案，不阻止下单', async () => {
  const me = ctx.members['妈妈'];
  const list = await ctx.call('GET', '/dishes?keyword=紫菜蛋花汤', { memberId: me });
  const dish = list.data[0];  // 含虾皮
  const r = await ctx.call('POST', '/dishes/taboo-check', {
    memberId: me,
    body: { dish_ids: [dish.id], member_ids: [ctx.members['爷爷']] },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.warnings.length, 1);
  const w = r.data.warnings[0];
  assert.strictEqual(w.member_name, '爷爷');
  assert.ok(w.message.includes('爷爷忌口'));
  assert.ok(w.message.includes('若是代别人点可忽略'));
});

test('忌口提醒：无忌口成员返回空列表', async () => {
  const me = ctx.members['妈妈'];
  const list = await ctx.call('GET', '/dishes?keyword=米饭', { memberId: me });
  const r = await ctx.call('POST', '/dishes/taboo-check', {
    memberId: me,
    body: { dish_ids: [list.data[0].id], member_ids: [ctx.members['哥哥']] },
  });
  assert.deepStrictEqual(r.data.warnings, []);
});
