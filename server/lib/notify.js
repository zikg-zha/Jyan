'use strict';
/**
 * 消息通知（F-005）
 * 写入站内消息表 + 通过 WebSocket 即时推送，保证 ≤5 秒触达。
 * 浏览器推送由前端基于该事件调用 Notification API 呈现（需用户授权）。
 */
const { db } = require('./db');
const realtime = require('./realtime');

const ICONS = {
  new_order: { icon: 'fa-utensils', color: '#FA6400' },
  taken: { icon: 'fa-hand-paper', color: '#1F69FF' },
  assigned: { icon: 'fa-user-check', color: '#1F69FF' },
  status: { icon: 'fa-fire', color: '#FA830C' },
  done: { icon: 'fa-check', color: '#12B312' },
  cancel: { icon: 'fa-ban', color: '#8c8c8c' },
};

const insertStmt = db.prepare(`
  INSERT INTO notifications (family_id, member_id, order_id, type, title, body, icon, icon_color)
  VALUES (@family_id, @member_id, @order_id, @type, @title, @body, @icon, @icon_color)
`);

/**
 * 给指定成员集合发通知（自动去重、排除触发者自己）
 * @param {object} opts
 * @param {number} opts.familyId
 * @param {number[]} opts.memberIds 接收人
 * @param {number} [opts.excludeMemberId] 触发者，不给自己发
 * @param {number|null} opts.orderId
 * @param {string} opts.type
 * @param {string} opts.title
 * @param {string} [opts.body]
 */
function notify(opts) {
  const { familyId, memberIds, excludeMemberId, orderId = null, type, title, body = '' } = opts;
  const style = ICONS[type] || { icon: 'fa-bell', color: '#FA6400' };
  const targets = [...new Set((memberIds || []).map(Number).filter(Boolean))]
    .filter((id) => id !== Number(excludeMemberId));

  const created = [];
  const tx = db.transaction(() => {
    for (const memberId of targets) {
      const info = insertStmt.run({
        family_id: familyId,
        member_id: memberId,
        order_id: orderId,
        type,
        title,
        body,
        icon: style.icon,
        icon_color: style.color,
      });
      created.push({
        id: info.lastInsertRowid,
        member_id: memberId,
        order_id: orderId,
        type,
        title,
        body,
        icon: style.icon,
        icon_color: style.color,
        is_read: 0,
        created_at: new Date().toISOString(),
      });
    }
  });
  tx();

  // 即时推送：同一房间广播，前端按 member_id 过滤，达成秒级触达
  if (created.length) {
    realtime.emitFamily(familyId, 'notification', { items: created });
  }
  return created;
}

/** 订单相关人：下单人 + 接单人 + 协作人 */
function orderStakeholders(orderId) {
  const row = db.prepare('SELECT creator_id, taker_id FROM orders WHERE id = ?').get(orderId);
  if (!row) return [];
  const collabs = db.prepare('SELECT member_id FROM order_collaborators WHERE order_id = ?').all(orderId);
  return [...new Set([row.creator_id, row.taker_id, ...collabs.map((c) => c.member_id)].filter(Boolean))];
}

/** 全家成员 ID */
function familyMemberIds(familyId) {
  return db.prepare('SELECT id FROM members WHERE family_id = ?').all(familyId).map((r) => r.id);
}

module.exports = { notify, orderStakeholders, familyMemberIds };
