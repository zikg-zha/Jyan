/** 消息中心（F-005） */
import { h, onMounted } from '../../vendor/vue.esm-browser.prod.js';
import { api } from '../api.js';
import { state, refreshNotifications, requestPush, toast } from '../store.js';
import { Empty, relativeTime } from './common.js';

export const Messages = {
  emits: ['open-order'],
  setup(props, { emit }) {
    onMounted(refreshNotifications);

    async function open(n) {
      if (!n.is_read) {
        try {
          await api.readNotification(n.id);
          n.is_read = 1;
          state.unread = Math.max(0, state.unread - 1);
        } catch (_) { /* 忽略 */ }
      }
      if (n.order_id) emit('open-order', n.order_id);
    }

    async function readAll() {
      try {
        await api.readAll();
        state.notifications.forEach((n) => { n.is_read = 1; });
        state.unread = 0;
        toast('已全部标为已读');
      } catch (err) {
        toast(err.message);
      }
    }

    return () => h('div', null, [
      !state.pushGranted
        ? h('div', { class: 'section' }, [
          h('div', { class: 'card', style: 'padding:16px' }, [
            h('div', { class: 'semi mb8' }, [
              h('i', { class: 'far fa-bell', style: 'color:var(--color-primary)' }),
              ' 开启进度通知',
            ]),
            h('div', { class: 'fs-sm sec mb12' },
              '开启浏览器推送，做菜进度变更时第一时间提醒你（异地也能收到）。未开启时仍会保留站内消息。'),
            h('button', { class: 'btn btn-primary btn-block', onClick: requestPush }, '允许通知'),
          ]),
        ])
        : null,

      state.notifications.length
        ? h('div', null, [
          h('div', { class: 'row between', style: 'padding:12px 16px' }, [
            h('span', { class: 'fs-sm muted' }, `未读 ${state.unread} 条`),
            state.unread
              ? h('button', { class: 'btn btn-line btn-sm', onClick: readAll }, '全部已读')
              : null,
          ]),
          ...state.notifications.map((n) => h('div', {
            class: `msg-item ${n.is_read ? '' : 'unread'}`,
            key: n.id,
            role: 'button',
            tabindex: 0,
            onClick: () => open(n),
            onKeydown: (e) => { if (e.key === 'Enter') open(n); },
          }, [
            h('div', {
              class: 'msg-icon',
              style: `background:${n.icon_color}`,
            }, [h('i', { class: `fas ${n.icon}` })]),
            h('div', { class: 'grow' }, [
              h('div', { class: 'semi' }, n.title),
              h('div', { class: 'fs-sm muted' },
                `${relativeTime(n.created_at)}${n.body ? ` · ${n.body}` : ''}`),
            ]),
          ])),
        ])
        : h(Empty, { icon: 'fa-bell-slash', text: '还没有消息' }),
    ]);
  },
};
