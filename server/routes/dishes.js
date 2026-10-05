'use strict';
/** 菜品库管理（F-001） */
const express = require('express');
const { db } = require('../lib/db');
const { CATEGORIES, DIFFICULTIES, MIN_STEPS, matchTaboos } = require('../lib/domain');
const { parseJSON, fail, ok, wrap, requireMember } = require('../lib/helpers');
const realtime = require('../lib/realtime');

const router = express.Router();

function outDish(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    difficulty: row.difficulty,
    duration: row.duration,
    servings: row.servings,
    cover_url: row.cover_url,
    icon: row.icon,
    ingredients: parseJSON(row.ingredients, []),
    steps: parseJSON(row.steps, []),
    order_count: row.order_count,
    created_at: row.created_at,
  };
}

/** 入参校验：名称、分类、做法步数 */
function validateDish(body) {
  const name = String(body.name || '').trim();
  const category = String(body.category || '').trim();
  if (!name || !category) return { err: '请填写菜品名称和分类' };
  if (!CATEGORIES.includes(category)) return { err: '菜品分类不正确' };

  const steps = Array.isArray(body.steps)
    ? body.steps.filter((s) => s && String(s.desc || s.title || '').trim())
    : [];
  if (steps.length < MIN_STEPS) return { err: `做法至少需要 ${MIN_STEPS} 步` };

  const ingredients = Array.isArray(body.ingredients)
    ? body.ingredients
      .filter((i) => i && String(i.name || '').trim())
      .map((i) => ({
        name: String(i.name).trim(),
        amount: String(i.amount ?? '').trim(),
        unit: String(i.unit ?? '').trim(),
      }))
    : [];

  const difficulty = DIFFICULTIES.includes(body.difficulty) ? body.difficulty : '简单';
  const duration = Math.max(1, Number(body.duration) || 30);
  const servings = Math.max(1, Number(body.servings) || 2);

  return {
    value: {
      name,
      category,
      difficulty,
      duration,
      servings,
      cover_url: String(body.cover_url || ''),
      icon: String(body.icon || 'fa-utensils'),
      ingredients,
      steps: steps.map((s, idx) => ({
        title: String(s.title || `步骤 ${idx + 1}`).trim(),
        desc: String(s.desc || '').trim(),
        photo: String(s.photo || ''),
      })),
    },
  };
}

/** 菜品列表：支持分类筛选 + 名称模糊搜索 */
router.get('/dishes', requireMember, wrap((req, res) => {
  const category = String(req.query.category || '全部');
  const keyword = String(req.query.keyword || '').trim();

  const conds = ['family_id = ?'];
  const args = [req.familyId];
  if (category && category !== '全部') {
    conds.push('category = ?');
    args.push(category);
  }
  if (keyword) {
    conds.push('name LIKE ?');
    args.push(`%${keyword}%`);
  }
  const rows = db.prepare(
    `SELECT * FROM dishes WHERE ${conds.join(' AND ')} ORDER BY order_count DESC, id DESC`
  ).all(...args);
  return ok(res, rows.map(outDish));
}));

/** 菜品详情 */
router.get('/dishes/:id', requireMember, wrap((req, res) => {
  const row = db.prepare('SELECT * FROM dishes WHERE id = ? AND family_id = ?')
    .get(Number(req.params.id), req.familyId);
  if (!row) return fail(res, 404, '菜品不存在');
  return ok(res, outDish(row));
}));

/** 新建菜品 */
router.post('/dishes', requireMember, wrap((req, res) => {
  const { err, value } = validateDish(req.body);
  if (err) return fail(res, 400, err);

  const dup = db.prepare('SELECT id FROM dishes WHERE family_id = ? AND name = ?')
    .get(req.familyId, value.name);
  if (dup) return fail(res, 400, `菜品「${value.name}」已存在，请换个名称`);

  const info = db.prepare(`
    INSERT INTO dishes
      (family_id, name, category, difficulty, duration, servings, cover_url, icon,
       ingredients, steps, created_by)
    VALUES (@family_id, @name, @category, @difficulty, @duration, @servings, @cover_url, @icon,
       @ingredients, @steps, @created_by)
  `).run({
    ...value,
    family_id: req.familyId,
    ingredients: JSON.stringify(value.ingredients),
    steps: JSON.stringify(value.steps),
    created_by: req.member.id,
  });

  const created = db.prepare('SELECT * FROM dishes WHERE id = ?').get(info.lastInsertRowid);
  realtime.emitFamily(req.familyId, 'dishes:changed', { id: created.id, action: 'create' });
  return ok(res, outDish(created));
}));

/** 编辑菜品 */
router.put('/dishes/:id', requireMember, wrap((req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM dishes WHERE id = ? AND family_id = ?').get(id, req.familyId);
  if (!row) return fail(res, 404, '菜品不存在');

  const { err, value } = validateDish(req.body);
  if (err) return fail(res, 400, err);

  const dup = db.prepare('SELECT id FROM dishes WHERE family_id = ? AND name = ? AND id <> ?')
    .get(req.familyId, value.name, id);
  if (dup) return fail(res, 400, `菜品「${value.name}」已存在，请换个名称`);

  db.prepare(`
    UPDATE dishes SET name=@name, category=@category, difficulty=@difficulty, duration=@duration,
      servings=@servings, cover_url=@cover_url, icon=@icon, ingredients=@ingredients, steps=@steps,
      updated_at=datetime('now','localtime')
    WHERE id=@id
  `).run({
    ...value,
    id,
    ingredients: JSON.stringify(value.ingredients),
    steps: JSON.stringify(value.steps),
  });

  const updated = db.prepare('SELECT * FROM dishes WHERE id = ?').get(id);
  realtime.emitFamily(req.familyId, 'dishes:changed', { id, action: 'update' });
  return ok(res, outDish(updated));
}));

/** 删除菜品 */
router.delete('/dishes/:id', requireMember, wrap((req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id FROM dishes WHERE id = ? AND family_id = ?').get(id, req.familyId);
  if (!row) return fail(res, 404, '菜品不存在');
  db.prepare('DELETE FROM dishes WHERE id = ?').run(id);
  realtime.emitFamily(req.familyId, 'dishes:changed', { id, action: 'delete' });
  return ok(res, { id });
}));

/**
 * 忌口检查（F-008）：传入菜品 ID 列表 + 用餐成员，返回命中明细。
 * 仅提醒，不阻止下单。
 */
router.post('/dishes/taboo-check', requireMember, wrap((req, res) => {
  const dishIds = (Array.isArray(req.body.dish_ids) ? req.body.dish_ids : []).map(Number).filter(Boolean);
  const memberIds = (Array.isArray(req.body.member_ids) ? req.body.member_ids : []).map(Number).filter(Boolean);
  if (!dishIds.length || !memberIds.length) return ok(res, { warnings: [] });

  const dishes = db.prepare(
    `SELECT id, name, ingredients FROM dishes WHERE family_id = ?
      AND id IN (${dishIds.map(() => '?').join(',')})`
  ).all(req.familyId, ...dishIds);

  const members = db.prepare(
    `SELECT id, name, taboos FROM members WHERE family_id = ?
      AND id IN (${memberIds.map(() => '?').join(',')})`
  ).all(req.familyId, ...memberIds);

  const warnings = [];
  for (const d of dishes) {
    const ing = parseJSON(d.ingredients, []);
    for (const m of members) {
      const hits = matchTaboos(ing, parseJSON(m.taboos, []));
      if (hits.length) {
        warnings.push({
          dish_id: d.id,
          dish_name: d.name,
          member_id: m.id,
          member_name: m.name,
          taboos: hits,
          message: `该菜品「${d.name}」含${hits.join('、')}，${m.name}忌口。若是代别人点可忽略。`,
        });
      }
    }
  }
  return ok(res, { warnings });
}));

module.exports = { router, outDish };
