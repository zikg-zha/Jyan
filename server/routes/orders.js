'use strict';
/** 点菜下单 / 接单指派 / 进度跟踪 / 列表筛选（F-002 F-003 F-004 F-006） */
const express = require('express');
const { db } = require('../lib/db');
const {
  STATUS, SEGMENTS, canTransition, nextStatus, resolveMealDate, toDateStr,
} = require('../lib/domain');
const { parseJSON, fail, ok, wrap, requireMember } = require('../lib/helpers');
const realtime = require('../lib/realtime');
const { notify, orderStakeholders, familyMemberIds } = require('../lib/notify');

const router = express.Router();

/* ---------- 查询装配 ---------- */

const dishesOfOrder = db.prepare(
  'SELECT dish_id, name, icon FROM order_dishes WHERE order_id = ? ORDER BY id'
);
const collabsOfOrder = db.prepare(`
  SELECT m.id, m.name, m.avatar_text FROM order_collaborators c
  JOIN members m ON m.id = c.member_id WHERE c.order_id = ? ORDER BY c.joined_at
`);
const progressOfOrder = db.prepare(`
  SELECT p.id, p.status, p.photo_url, p.remark, p.created_at, p.member_id, m.name AS member_name
  FROM order_progress p LEFT JOIN members m ON m.id = p.member_id
  WHERE p.order_id = ? ORDER BY p.id
`);

/** 订单出参装配 */
function outOrder(row, opts = {}) {
  if (!row) return null;
  const base = {
    id: row.id,
    status: row.status,
    segment: segmentOf(row.status),
    meal_time: row.meal_time,
    meal_date: row.meal_date,
    people: row.people,
    eat_for: row.eat_for,
    note: row.note,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
    creator: { id: row.creator_id, name: row.creator_name, avatar_text: row.creator_avatar },
    taker: row.taker_id
      ? { id: row.taker_id, name: row.taker_name, avatar_text: row.taker_avatar }
      : null,
    dishes: dishesOfOrder.all(row.id),
    collaborators: collabsOfOrder.all(row.id),
    next_status: nextStatus(row.status),
  };
  if (opts.withProgress) base.progress = progressOfOrder.all(row.id);
  return base;
}

function segmentOf(status) {
  for (const [seg, list] of Object.entries(SEGMENTS)) {
    if (list.includes(status)) return seg;
  }
  return '进行中';
}

const SELECT_ORDER = `
  SELECT o.*, c.name AS creator_name, c.avatar_text AS creator_avatar,
         t.name AS taker_name, t.avatar_text AS taker_avatar
  FROM orders o
  JOIN members c ON c.id = o.creator_id
  LEFT JOIN members t ON t.id = o.taker_id
`;

function getOrderRow(id, familyId) {
  return db.prepare(`${SELECT_ORDER} WHERE o.id = ? AND o.family_id = ?`).get(id, familyId);
}

/* ---------- 列表与筛选（F-006） ---------- */

router.get('/orders', requireMember, wrap((req, res) => {
  const started = process.hrtime.bigint();
  const segment = String(req.query.segment || '进行中');
  const scope = String(req.query.scope || '今日');      // 今日 | 全部
  const relation = String(req.query.relation || '全部'); // 全部 | 我下单的 | 我接单的
  const creatorId = Number(req.query.creator_id) || 0;
  const takerId = Number(req.query.taker_id) || 0;
  const date = String(req.query.date || '').trim();

  const conds = ['o.family_id = ?'];
  const args = [req.familyId];

  const statuses = SEGMENTS[segment];
  if (statuses) {
    conds.push(`o.status IN (${statuses.map(() => '?').join(',')})`);
    args.push(...statuses);
  }
  if (scope === '今日') {
    conds.push('o.meal_date = ?');
    args.push(toDateStr(new Date()));
  }
  if (date) {
    conds.push('o.meal_date = ?');
    args.push(date);
  }
  if (relation === '我下单的') {
    conds.push('o.creator_id = ?');
    args.push(req.member.id);
  } else if (relation === '我接单的') {
    conds.push('(o.taker_id = ? OR EXISTS (SELECT 1 FROM order_collaborators oc WHERE oc.order_id = o.id AND oc.member_id = ?))');
    args.push(req.member.id, req.member.id);
  }
  if (creatorId) {
    conds.push('o.creator_id = ?');
    args.push(creatorId);
  }
  if (takerId) {
    conds.push('o.taker_id = ?');
    args.push(takerId);
  }

  const rows = db.prepare(
    `${SELECT_ORDER} WHERE ${conds.join(' AND ')} ORDER BY o.meal_date DESC, o.id DESC LIMIT 200`
  ).all(...args);

  const items = rows.map((r) => outOrder(r));
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  return ok(res, { items, total: items.length, elapsed_ms: Number(elapsedMs.toFixed(1)) });
}));

/** 订单详情（含进度轨迹） */
router.get('/orders/:id', requireMember, wrap((req, res) => {
  const row = getOrderRow(Number(req.params.id), req.familyId);
  if (!row) return fail(res, 404, '订单不存在');
  return ok(res, outOrder(row, { withProgress: true }));
}));

/* ---------- 下单（F-002） ---------- */

router.post('/orders', requireMember, wrap((req, res) => {
  const dishIds = (Array.isArray(req.body.dish_ids) ? req.body.dish_ids : []).map(Number).filter(Boolean);
  if (!dishIds.length) return fail(res, 400, '请至少选择一道菜');

  const mealTime = String(req.body.meal_time || '今天晚饭').trim();
  const people = Math.max(1, Number(req.body.people) || 2);
  const note = String(req.body.note || '').trim();
  const eatFor = String(req.body.eat_for || '').trim();
  const assigneeId = Number(req.body.assignee_id) || 0;

  const dishes = db.prepare(
    `SELECT id, name, icon FROM dishes WHERE family_id = ? AND id IN (${dishIds.map(() => '?').join(',')})`
  ).all(req.familyId, ...dishIds);
  if (!dishes.length) return fail(res, 400, '所选菜品不存在，请重新选择');

  let assignee = null;
  if (assigneeId) {
    assignee = db.prepare('SELECT id, name FROM members WHERE id = ? AND family_id = ?')
      .get(assigneeId, req.familyId);
    if (!assignee) return fail(res, 400, '指派的家人不存在');
  }

  const mealDate = resolveMealDate(mealTime);
  const status = assignee ? STATUS.TAKEN : STATUS.PENDING;

  const orderId = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO orders (family_id, creator_id, taker_id, status, meal_time, meal_date,
                          people, eat_for, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.familyId, req.member.id, assignee ? assignee.id : null, status,
      mealTime, mealDate, people, eatFor, note);
    const id = Number(info.lastInsertRowid);

    const insDish = db.prepare(
      'INSERT INTO order_dishes (order_id, dish_id, name, icon) VALUES (?, ?, ?, ?)'
    );
    const bump = db.prepare('UPDATE dishes SET order_count = order_count + 1 WHERE id = ?');
    for (const d of dishes) {
      insDish.run(id, d.id, d.name, d.icon);
      bump.run(d.id);
    }

    db.prepare(
      'INSERT INTO order_progress (order_id, status, member_id, remark) VALUES (?, ?, ?, ?)'
    ).run(id, status, req.member.id, assignee ? `下单并指派给${assignee.name}` : '已发起点菜单');
    return id;
  })();

  const row = getOrderRow(orderId, req.familyId);
  const payload = outOrder(row, { withProgress: true });
  const dishNames = dishes.map((d) => d.name).join(' + ');

  realtime.emitFamily(req.familyId, 'order:created', { order: payload });
  notify({
    familyId: req.familyId,
    memberIds: familyMemberIds(req.familyId),
    excludeMemberId: req.member.id,
    orderId,
    type: 'new_order',
    title: `${req.member.name} 发起点菜单「${dishNames}」`,
    body: `${mealTime} · ${people}人用餐`,
  });
  if (assignee && assignee.id !== req.member.id) {
    notify({
      familyId: req.familyId,
      memberIds: [assignee.id],
      orderId,
      type: 'assigned',
      title: `${req.member.name} 指派你做「${dishNames}」`,
      body: `${mealTime} · ${people}人用餐`,
    });
  }
  return ok(res, payload);
}));

/* ---------- 接单（F-003） ---------- */

router.post('/orders/:id/take', requireMember, wrap((req, res) => {
  const id = Number(req.params.id);
  let conflict = null;
  let joinedAsCollaborator = false;

  const result = db.transaction(() => {
    const cur = db.prepare('SELECT * FROM orders WHERE id = ? AND family_id = ?').get(id, req.familyId);
    if (!cur) return null;

    // 并发接单：服务端以先到为准，后到者转为协作（F-003 异常处理）
    if (cur.taker_id && cur.taker_id !== req.member.id) {
      const exists = db.prepare(
        'SELECT 1 FROM order_collaborators WHERE order_id = ? AND member_id = ?'
      ).get(id, req.member.id);
      if (!exists) {
        db.prepare('INSERT INTO order_collaborators (order_id, member_id) VALUES (?, ?)')
          .run(id, req.member.id);
      }
      joinedAsCollaborator = true;
      conflict = '该订单已被接单，已把你加入协作';
      return cur;
    }
    if (cur.status === STATUS.DONE || cur.status === STATUS.CANCELED) {
      conflict = '订单已结束，无法接单';
      return cur;
    }

    db.prepare(`
      UPDATE orders SET taker_id = ?, status = ?, version = version + 1,
        updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(req.member.id, STATUS.TAKEN, id);
    db.prepare(
      'INSERT INTO order_progress (order_id, status, member_id, remark) VALUES (?, ?, ?, ?)'
    ).run(id, STATUS.TAKEN, req.member.id, '已接单');
    return cur;
  })();

  if (!result) return fail(res, 404, '订单不存在');
  if (conflict && !joinedAsCollaborator) return fail(res, 409, conflict);

  const row = getOrderRow(id, req.familyId);
  const payload = outOrder(row, { withProgress: true });
  realtime.emitFamily(req.familyId, 'order:updated', { order: payload });

  const dishNames = payload.dishes.map((d) => d.name).join(' + ');
  notify({
    familyId: req.familyId,
    memberIds: orderStakeholders(id),
    excludeMemberId: req.member.id,
    orderId: id,
    type: 'taken',
    title: joinedAsCollaborator
      ? `${req.member.name} 加入协作「${dishNames}」`
      : `${req.member.name} 接单了「${dishNames}」`,
    body: joinedAsCollaborator ? '多人协作进行中' : '开始准备啦',
  });

  return ok(res, { order: payload, joined_as_collaborator: joinedAsCollaborator, message: conflict || '' });
}));

/** 下单人指派家人 */
router.post('/orders/:id/assign', requireMember, wrap((req, res) => {
  const id = Number(req.params.id);
  const memberId = Number(req.body.member_id);
  const cur = db.prepare('SELECT * FROM orders WHERE id = ? AND family_id = ?').get(id, req.familyId);
  if (!cur) return fail(res, 404, '订单不存在');
  if (cur.creator_id !== req.member.id) return fail(res, 403, '只有下单人可以指派');
  if (cur.status === STATUS.DONE || cur.status === STATUS.CANCELED) {
    return fail(res, 400, '订单已结束，无法指派');
  }

  const target = db.prepare('SELECT id, name FROM members WHERE id = ? AND family_id = ?')
    .get(memberId, req.familyId);
  if (!target) return fail(res, 400, '指派的家人不存在');

  db.transaction(() => {
    db.prepare(`
      UPDATE orders SET taker_id = ?, status = CASE WHEN status = ? THEN ? ELSE status END,
        version = version + 1, updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(target.id, STATUS.PENDING, STATUS.TAKEN, id);
    db.prepare(
      'INSERT INTO order_progress (order_id, status, member_id, remark) VALUES (?, ?, ?, ?)'
    ).run(id, STATUS.TAKEN, req.member.id, `指派给${target.name}`);
  })();

  const payload = outOrder(getOrderRow(id, req.familyId), { withProgress: true });
  realtime.emitFamily(req.familyId, 'order:updated', { order: payload });
  notify({
    familyId: req.familyId,
    memberIds: [target.id],
    excludeMemberId: req.member.id,
    orderId: id,
    type: 'assigned',
    title: `${req.member.name} 指派你做「${payload.dishes.map((d) => d.name).join(' + ')}」`,
    body: `${payload.meal_time} · ${payload.people}人用餐`,
  });
  return ok(res, payload);
}));

/** 加入协作 */
router.post('/orders/:id/collaborate', requireMember, wrap((req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM orders WHERE id = ? AND family_id = ?').get(id, req.familyId);
  if (!cur) return fail(res, 404, '订单不存在');
  if (cur.status === STATUS.DONE || cur.status === STATUS.CANCELED) {
    return fail(res, 400, '订单已结束');
  }
  if (cur.taker_id === req.member.id) return fail(res, 400, '你已是该订单接单人');

  db.prepare(
    'INSERT OR IGNORE INTO order_collaborators (order_id, member_id) VALUES (?, ?)'
  ).run(id, req.member.id);

  const payload = outOrder(getOrderRow(id, req.familyId), { withProgress: true });
  realtime.emitFamily(req.familyId, 'order:updated', { order: payload });
  notify({
    familyId: req.familyId,
    memberIds: orderStakeholders(id),
    excludeMemberId: req.member.id,
    orderId: id,
    type: 'taken',
    title: `${req.member.name} 加入协作「${payload.dishes.map((d) => d.name).join(' + ')}」`,
  });
  return ok(res, payload);
}));

/* ---------- 进度更新（F-004） ---------- */

router.post('/orders/:id/status', requireMember, wrap((req, res) => {
  const id = Number(req.params.id);
  const to = String(req.body.status || '').trim();
  const photoUrl = String(req.body.photo_url || '');
  const remark = String(req.body.remark || '').trim();
  const clientVersion = Number(req.body.version) || 0;

  const cur = db.prepare('SELECT * FROM orders WHERE id = ? AND family_id = ?').get(id, req.familyId);
  if (!cur) return fail(res, 404, '订单不存在');

  // 乐观锁：异地并发时以服务端为准（R-001）
  if (clientVersion && clientVersion !== cur.version) {
    const latest = outOrder(getOrderRow(id, req.familyId), { withProgress: true });
    return res.status(409).json({
      ok: false,
      message: '订单已被其他家人更新，已为你同步最新状态',
      data: latest,
    });
  }

  const allowed = [cur.creator_id, cur.taker_id].filter(Boolean);
  const collabs = db.prepare('SELECT member_id FROM order_collaborators WHERE order_id = ?')
    .all(id).map((c) => c.member_id);
  if (![...allowed, ...collabs].includes(req.member.id)) {
    return fail(res, 403, '只有接单人、协作人或下单人可以更新进度');
  }

  const check = canTransition(cur.status, to);
  if (!check.ok) return fail(res, 400, check.msg);

  db.transaction(() => {
    const isDone = to === STATUS.DONE;
    db.prepare(`
      UPDATE orders SET status = ?, version = version + 1,
        updated_at = datetime('now','localtime'),
        completed_at = CASE WHEN ? = 1 THEN datetime('now','localtime') ELSE completed_at END
      WHERE id = ?
    `).run(to, isDone ? 1 : 0, id);
    db.prepare(
      'INSERT INTO order_progress (order_id, status, member_id, photo_url, remark) VALUES (?, ?, ?, ?, ?)'
    ).run(id, to, req.member.id, photoUrl, remark);
  })();

  const payload = outOrder(getOrderRow(id, req.familyId), { withProgress: true });
  const dishNames = payload.dishes.map((d) => d.name).join(' + ');

  // 实时广播 + 站内消息，保证 ≤5 秒触达
  realtime.emitFamily(req.familyId, 'order:updated', { order: payload });
  notify({
    familyId: req.familyId,
    memberIds: orderStakeholders(id),
    excludeMemberId: req.member.id,
    orderId: id,
    type: to === STATUS.DONE ? 'done' : to === STATUS.CANCELED ? 'cancel' : 'status',
    title: to === STATUS.DONE
      ? `${req.member.name} 完成了「${dishNames}」`
      : `${req.member.name} 把「${dishNames}」更新为 ${to}`,
    body: remark || (photoUrl ? '附了一张过程照片' : ''),
  });
  return ok(res, payload);
}));

/** 取消订单 */
router.post('/orders/:id/cancel', requireMember, wrap((req, res) => {
  const id = Number(req.params.id);
  const reason = String(req.body.reason || '').trim();
  const cur = db.prepare('SELECT * FROM orders WHERE id = ? AND family_id = ?').get(id, req.familyId);
  if (!cur) return fail(res, 404, '订单不存在');

  const check = canTransition(cur.status, STATUS.CANCELED);
  if (!check.ok) return fail(res, 400, check.msg);

  db.transaction(() => {
    db.prepare(`
      UPDATE orders SET status = ?, version = version + 1, updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(STATUS.CANCELED, id);
    db.prepare(
      'INSERT INTO order_progress (order_id, status, member_id, remark) VALUES (?, ?, ?, ?)'
    ).run(id, STATUS.CANCELED, req.member.id, reason || '订单已取消');
  })();

  const payload = outOrder(getOrderRow(id, req.familyId), { withProgress: true });
  realtime.emitFamily(req.familyId, 'order:updated', { order: payload });
  notify({
    familyId: req.familyId,
    memberIds: orderStakeholders(id),
    excludeMemberId: req.member.id,
    orderId: id,
    type: 'cancel',
    title: `${req.member.name} 取消了「${payload.dishes.map((d) => d.name).join(' + ')}」`,
    body: reason,
  });
  return ok(res, payload);
}));

module.exports = { router, outOrder };
