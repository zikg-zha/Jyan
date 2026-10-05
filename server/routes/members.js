'use strict';
/** 登录 + 家庭成员管理（F-007） */
const express = require('express');
const { db } = require('../lib/db');
const { MAX_MEMBERS } = require('../lib/domain');
const { parseJSON, fail, ok, wrap, requireMember, publicMember } = require('../lib/helpers');
const realtime = require('../lib/realtime');

const router = express.Router();

/** 构造在线成员集合 */
function buildOnlineSet(familyId) {
  return new Set(realtime.onlineIds(familyId));
}

/** 登录：家庭内成员名 + 密码 */
router.post('/auth/login', wrap((req, res) => {
  const name = String(req.body.name || '').trim();
  const password = String(req.body.password || '');
  if (!name || !password) return fail(res, 400, '请填写成员名和密码');

  const member = db.prepare(
    'SELECT * FROM members WHERE name = ? AND password = ?'
  ).get(name, password);
  if (!member) return fail(res, 401, '成员名或密码不正确');

  const family = db.prepare('SELECT id, name, invite_code FROM families WHERE id = ?')
    .get(member.family_id);
  db.prepare("UPDATE members SET last_seen = datetime('now','localtime') WHERE id = ?").run(member.id);

  return ok(res, {
    member: publicMember(member, buildOnlineSet(member.family_id)),
    family,
  });
}));

/** 当前登录成员信息 */
router.get('/auth/me', requireMember, wrap((req, res) => {
  const family = db.prepare('SELECT id, name, invite_code FROM families WHERE id = ?')
    .get(req.familyId);
  return ok(res, {
    member: publicMember(req.member, buildOnlineSet(req.familyId)),
    family,
  });
}));

/** 成员列表（含在线状态） */
router.get('/members', requireMember, wrap((req, res) => {
  const rows = db.prepare('SELECT * FROM members WHERE family_id = ? ORDER BY id').all(req.familyId);
  const set = buildOnlineSet(req.familyId);
  return ok(res, rows.map((m) => publicMember(m, set)));
}));

/** 邀请家人加入（人数上限 10） */
router.post('/members', requireMember, wrap((req, res) => {
  const name = String(req.body.name || '').trim();
  const password = String(req.body.password || '').trim();
  if (!name || !password) return fail(res, 400, '请填写成员名和初始密码');

  const count = db.prepare('SELECT COUNT(*) AS c FROM members WHERE family_id = ?')
    .get(req.familyId).c;
  if (count >= MAX_MEMBERS) return fail(res, 400, '家庭成员已达上限');

  const dup = db.prepare('SELECT id FROM members WHERE family_id = ? AND name = ?')
    .get(req.familyId, name);
  if (dup) return fail(res, 400, '该成员名已存在');

  const info = db.prepare(`
    INSERT INTO members (family_id, name, avatar_text, password, taboos, specialties, preference)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.familyId, name, name.slice(0, 1), password,
    JSON.stringify(req.body.taboos || []),
    JSON.stringify(req.body.specialties || []),
    String(req.body.preference || '')
  );

  const created = db.prepare('SELECT * FROM members WHERE id = ?').get(info.lastInsertRowid);
  realtime.emitFamily(req.familyId, 'members:changed', {});
  return ok(res, publicMember(created, buildOnlineSet(req.familyId)));
}));

/** 更新成员偏好 / 忌口 / 擅长 */
router.put('/members/:id', requireMember, wrap((req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT * FROM members WHERE id = ? AND family_id = ?')
    .get(id, req.familyId);
  if (!target) return fail(res, 404, '成员不存在');

  const taboos = Array.isArray(req.body.taboos) ? req.body.taboos : parseJSON(target.taboos, []);
  const specialties = Array.isArray(req.body.specialties)
    ? req.body.specialties : parseJSON(target.specialties, []);
  const preference = req.body.preference !== undefined
    ? String(req.body.preference) : target.preference;

  db.prepare('UPDATE members SET taboos = ?, specialties = ?, preference = ? WHERE id = ?')
    .run(JSON.stringify(taboos), JSON.stringify(specialties), preference, id);

  const updated = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
  realtime.emitFamily(req.familyId, 'members:changed', {});
  return ok(res, publicMember(updated, buildOnlineSet(req.familyId)));
}));

module.exports = router;
