'use strict';
/**
 * 实时同步中心（PRD 6.1：WebSocket 优先，轮询降级）
 * 以 family:<id> 房间广播，保证异地成员数据一致。
 */
const { Server } = require('socket.io');
const { db } = require('./db');

let io = null;
/** memberId -> Set<socketId>，用于在线状态 */
const onlineMembers = new Map();

function room(familyId) {
  return `family:${familyId}`;
}

function attach(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: '*' },
    pingInterval: 10000,
    pingTimeout: 20000,
  });

  io.on('connection', (socket) => {
    socket.on('join', (payload = {}) => {
      const familyId = Number(payload.familyId);
      const memberId = Number(payload.memberId);
      if (!familyId || !memberId) return;
      socket.data.familyId = familyId;
      socket.data.memberId = memberId;
      socket.join(room(familyId));

      if (!onlineMembers.has(memberId)) onlineMembers.set(memberId, new Set());
      onlineMembers.get(memberId).add(socket.id);
      touchLastSeen(memberId);
      broadcastPresence(familyId);
    });

    socket.on('heartbeat', () => {
      if (socket.data.memberId) touchLastSeen(socket.data.memberId);
    });

    socket.on('disconnect', () => {
      const { memberId, familyId } = socket.data || {};
      if (!memberId) return;
      const set = onlineMembers.get(memberId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) onlineMembers.delete(memberId);
      }
      if (familyId) broadcastPresence(familyId);
    });
  });

  return io;
}

function touchLastSeen(memberId) {
  try {
    db.prepare("UPDATE members SET last_seen = datetime('now','localtime') WHERE id = ?").run(memberId);
  } catch (_) { /* 非关键路径，忽略 */ }
}

function isOnline(memberId) {
  return onlineMembers.has(Number(memberId));
}

function onlineIds(familyId) {
  const rows = db.prepare('SELECT id FROM members WHERE family_id = ?').all(familyId);
  return rows.map((r) => r.id).filter((id) => onlineMembers.has(id));
}

/** 向整个家庭房间广播事件 */
function emitFamily(familyId, event, payload) {
  if (!io) return;
  io.to(room(familyId)).emit(event, payload);
}

function broadcastPresence(familyId) {
  emitFamily(familyId, 'presence', { online: onlineIds(familyId) });
}

module.exports = { attach, emitFamily, broadcastPresence, isOnline, onlineIds, get io() { return io; } };
