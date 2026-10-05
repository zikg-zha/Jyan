'use strict';
/** 历史统计（F-009）：贡献榜 / 热门菜品 / 谁给谁做过什么菜 */
const express = require('express');
const { db } = require('../lib/db');
const { STATUS } = require('../lib/domain');
const { ok, wrap, requireMember } = require('../lib/helpers');

const router = express.Router();

router.get('/stats', requireMember, wrap((req, res) => {
  const familyId = req.familyId;

  // 做饭贡献榜：已完成订单按接单人聚合
  const contributors = db.prepare(`
    SELECT m.id, m.name, m.avatar_text, COUNT(o.id) AS cook_count
    FROM members m
    LEFT JOIN orders o ON o.taker_id = m.id AND o.status = ? AND o.family_id = ?
    WHERE m.family_id = ?
    GROUP BY m.id ORDER BY cook_count DESC, m.id
  `).all(STATUS.DONE, familyId, familyId);

  // 热门菜品：按被点次数
  const popular = db.prepare(`
    SELECT d.id, d.name, d.category, d.icon, d.order_count
    FROM dishes d WHERE d.family_id = ? AND d.order_count > 0
    ORDER BY d.order_count DESC, d.id LIMIT 10
  `).all(familyId);

  // 谁给谁做过什么菜
  const pairs = db.prepare(`
    SELECT c.name AS creator_name, t.name AS taker_name,
           GROUP_CONCAT(od.name, '、') AS dishes, COUNT(DISTINCT o.id) AS times
    FROM orders o
    JOIN members c ON c.id = o.creator_id
    JOIN members t ON t.id = o.taker_id
    JOIN order_dishes od ON od.order_id = o.id
    WHERE o.family_id = ? AND o.status = ?
    GROUP BY o.creator_id, o.taker_id ORDER BY times DESC LIMIT 20
  `).all(familyId, STATUS.DONE);

  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total_orders,
      SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS done_orders,
      SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS canceled_orders
    FROM orders WHERE family_id = ?
  `).get(STATUS.DONE, STATUS.CANCELED, familyId);

  const dishTotal = db.prepare('SELECT COUNT(*) AS c FROM dishes WHERE family_id = ?').get(familyId).c;
  const memberTotal = db.prepare('SELECT COUNT(*) AS c FROM members WHERE family_id = ?').get(familyId).c;

  const maxCook = contributors.reduce((m, c) => Math.max(m, c.cook_count), 0);

  return ok(res, {
    contributors: contributors.map((c) => ({
      ...c,
      percent: maxCook ? Math.round((c.cook_count / maxCook) * 100) : 0,
    })),
    popular,
    pairs,
    summary: {
      total_orders: totals.total_orders || 0,
      done_orders: totals.done_orders || 0,
      canceled_orders: totals.canceled_orders || 0,
      dish_total: dishTotal,
      member_total: memberTotal,
      close_rate: totals.total_orders
        ? Math.round(((totals.done_orders || 0) / totals.total_orders) * 100)
        : 0,
    },
  });
}));

module.exports = router;
