/** 全局状态 + 实时同步（Supabase Realtime 优先，断开时 3 秒轮询降级） */
import { reactive } from '../vendor/vue.esm-browser.prod.js';
import { api } from './api.js';
import { sb, configError } from './supabase.js';
import { META } from './domain.js';

export const state = reactive({
  ready: false,
  configError,
  member: null,
  family: null,
  meta: { ...META },
  members: [],
  onlineIds: [],
  notifications: [],
  unread: 0,
  connected: false,
  pushGranted: typeof Notification !== 'undefined' && Notification.permission === 'granted',
  toast: '',
});

let channel = null;
let pollTimer = null;
let toastTimer = null;
/** 订单变更订阅者（各页面注册回调） */
const orderListeners = new Set();
const dishListeners = new Set();

export function toast(msg) {
  state.toast = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { state.toast = ''; }, 2400);
}

export function onOrderChange(fn) {
  orderListeners.add(fn);
  return () => orderListeners.delete(fn);
}
export function onDishChange(fn) {
  dishListeners.add(fn);
  return () => dishListeners.delete(fn);
}

export function isOnline(memberId) {
  return state.onlineIds.includes(Number(memberId));
}

/** 恢复会话 */
export async function bootstrap() {
  if (!configError) {
    try {
      const me = await api.me();
      if (me) applyLogin(me);
    } catch (_) {
      state.member = null;
    }
  }
  state.ready = true;
}

export function applyLogin(payload) {
  state.member = payload.member;
  state.family = payload.family;
  connectRealtime();
  refreshMembers();
  refreshNotifications();
}

export async function logout() {
  disconnectRealtime();
  stopPolling();
  await api.logout();
  state.member = null;
  state.family = null;
  state.members = [];
  state.notifications = [];
  state.unread = 0;
}

export async function refreshMembers() {
  if (!state.member) return;
  try {
    state.members = await api.members();
  } catch (_) { /* 忽略 */ }
}

export async function refreshNotifications() {
  if (!state.member) return;
  try {
    const data = await api.notifications(50);
    state.notifications = data.items;
    state.unread = data.unread;
  } catch (_) { /* 忽略 */ }
}

/* ---------- 实时通道 ---------- */

function emitOrders(evt) {
  orderListeners.forEach((fn) => fn(evt));
}

/** 订单行变化 → 拉取完整订单（含菜品、协作人、进度）后分发 */
async function onOrderRow(payload) {
  const row = payload.new || {};
  if (!row.id) {
    emitOrders({ type: 'refresh' });
    return;
  }
  try {
    const order = await api.order(row.id);
    emitOrders({ type: payload.eventType === 'INSERT' ? 'created' : 'updated', order });
  } catch (_) {
    emitOrders({ type: 'refresh' });
  }
}

function onNotificationRow(payload) {
  const n = payload.new;
  if (!n || !state.member || Number(n.member_id) !== state.member.id) return;
  if (state.notifications.some((x) => x.id === n.id)) return;
  state.notifications = [n, ...state.notifications].slice(0, 80);
  state.unread += 1;
  showBrowserPush(n);
  toast(n.title);
}

function connectRealtime() {
  if (channel || !sb || !state.member || !state.family) return;
  const familyId = state.family.id;
  const memberId = state.member.id;

  const ch = sb.channel(`family-${state.family.channel_key}`, {
    config: { presence: { key: String(memberId) } },
  });
  channel = ch;

  ch.on('postgres_changes',
    { event: '*', schema: 'public', table: 'orders', filter: `family_id=eq.${familyId}` }, onOrderRow)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'dishes', filter: `family_id=eq.${familyId}` },
      (payload) => dishListeners.forEach((fn) => fn(payload)))
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'members', filter: `family_id=eq.${familyId}` }, refreshMembers)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `member_id=eq.${memberId}` },
      onNotificationRow)
    .on('presence', { event: 'sync' }, () => {
      state.onlineIds = Object.keys(ch.presenceState()).map(Number).filter(Boolean);
    })
    .subscribe((status) => {
      if (channel !== ch) return;
      if (status === 'SUBSCRIBED') {
        state.connected = true;
        stopPolling();
        ch.track({ member_id: memberId, at: new Date().toISOString() });
        // 重连后补齐可能遗漏的数据
        refreshNotifications();
        emitOrders({ type: 'refresh' });
      } else {
        state.connected = false;
        startPolling();  // CHANNEL_ERROR / TIMED_OUT / CLOSED 时降级
      }
    });
}

function disconnectRealtime() {
  const ch = channel;
  channel = null;
  state.connected = false;
  state.onlineIds = [];
  if (ch && sb) sb.removeChannel(ch);
}

function startPolling() {
  if (pollTimer) return;
  // 降级通道：3 秒轮询，保证状态变更 ≤5 秒可见
  pollTimer = setInterval(async () => {
    if (!state.member) return;
    await refreshNotifications();
    emitOrders({ type: 'refresh' });
  }, 3000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/* ---------- 浏览器推送 ---------- */

export async function requestPush() {
  if (typeof Notification === 'undefined') {
    toast('当前浏览器不支持推送通知，已保留站内消息');
    return false;
  }
  const res = await Notification.requestPermission();
  state.pushGranted = res === 'granted';
  toast(state.pushGranted ? '已开启推送，进度变更将实时提醒' : '已在消息中心提醒');
  return state.pushGranted;
}

function showBrowserPush(n) {
  if (!state.pushGranted || typeof Notification === 'undefined') return;
  try {
    new Notification(n.title, { body: n.body || '家宴 · 做菜进度更新', tag: `jiayan-${n.id}` });
  } catch (_) { /* 站内消息已兜底 */ }
}
