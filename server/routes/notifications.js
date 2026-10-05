'use strict';
/** 站内消息中心（F-005） */
const express = require('express');
const { db } = require('../lib/db');
const { ok, wrap, requireMember } = require('../lib/helpers');

const router = express.Router();

/** 消息列表 + 未读数 */
router.get('/notifications', requireMember, wrap((req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const items = db.prepare(`
    SELECT id, order_id, type, title, body, icon, icon_color, is_read, created_at
    FROM notifications WHERE member_id = ? ORDER BY id DESC LIMIT ?
  `).all(req.member.id, limit);
  const unread = db.prepare(
    'SELECT COUNT(*) AS c FROM notifications WHERE member_id = ? AND is_read = 0'
  ).get(req.member.id).c;
  return ok(res, { items, unread });
}));

/** 未读数（轮询降级通道） */
router.get('/notifications/unread-count', requireMember, wrap((req, res) => {
  const unread = db.prepare(
    'SELECT COUNT(*) AS c FROM notifications WHERE member_id = ? AND is_read = 0'
  ).get(req.member.id).c;
  return ok(res, { unread });
}));

/** 单条已读 */
router.post('/notifications/:id/read', requireMember, wrap((req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND member_id = ?')
    .run(Number(req.params.id), req.member.id);
  return ok(res, { id: Number(req.params.id) });
}));

/** 全部已读 */
router.post('/notifications/read-all', requireMember, wrap((req, res) => {
  const info = db.prepare('UPDATE notifications SET is_read = 1 WHERE member_id = ? AND is_read = 0')
    .run(req.member.id);
  return ok(res, { updated: info.changes });
}));

module.exports = router;
