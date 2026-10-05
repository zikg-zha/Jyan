'use strict';
/** 通用工具：JSON 字段解析、鉴权中间件、错误包装 */
const { db } = require('./db');

function parseJSON(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v === null || v === undefined ? fallback : v;
  } catch (_) {
    return fallback;
  }
}

/** 统一错误响应 */
function fail(res, status, message) {
  return res.status(status).json({ ok: false, message });
}

function ok(res, data) {
  return res.json({ ok: true, data });
}

/** 异步路由包装，避免每处 try/catch */
function wrap(handler) {
  return (req, res, next) => {
    try {
      const r = handler(req, res, next);
      if (r && typeof r.catch === 'function') r.catch(next);
    } catch (err) {
      next(err);
    }
  };
}

/**
 * 轻量会话鉴权：请求头 x-member-id 标识当前登录成员。
 * 首版为家庭内部场景，成员登录后前端持有 memberId（PRD 6.3 不做复杂权限）。
 */
function requireMember(req, res, next) {
  const memberId = Number(req.header('x-member-id') || req.query.memberId);
  if (!memberId) return fail(res, 401, '请先登录');
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
  if (!member) return fail(res, 401, '登录已失效，请重新登录');
  req.member = member;
  req.familyId = member.family_id;
  next();
}

/** 成员出参（不含密码） */
function publicMember(m, onlineSet) {
  if (!m) return null;
  return {
    id: m.id,
    name: m.name,
    avatar_text: m.avatar_text,
    role: m.role,
    taboos: parseJSON(m.taboos, []),
    specialties: parseJSON(m.specialties, []),
    preference: m.preference || '',
    last_seen: m.last_seen,
    online: onlineSet ? onlineSet.has(m.id) : false,
  };
}

module.exports = { parseJSON, fail, ok, wrap, requireMember, publicMember };
