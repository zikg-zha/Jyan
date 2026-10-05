/** 订单详情 + 进度跟踪（F-004） */
import { h, ref, computed, onMounted, onUnmounted } from '../../vendor/vue.esm-browser.prod.js';
import { api } from '../api.js';
import { state, toast, onOrderChange, isOnline } from '../store.js';
import { STATUS_ICON, clockTime } from './common.js';

export const OrderDetail = {
  props: { orderId: Number },
  emits: ['progress', 'back'],
  setup(props, { emit }) {
    const order = ref(null);
    const loading = ref(true);
    const assigning = ref(false);

    async function load() {
      try {
        order.value = await api.order(props.orderId);
      } catch (err) {
        toast(err.message);
      } finally {
        loading.value = false;
      }
    }

    let off = null;
    onMounted(() => {
      load();
      // 异地家人更新状态时详情页同步刷新
      off = onOrderChange((evt) => {
        if (evt.type === 'refresh') return load();
        if (evt.order && evt.order.id === props.orderId) order.value = evt.order;
      });
    });
    onUnmounted(() => { if (off) off(); });

    const me = computed(() => state.member.id);
    const isCreator = computed(() => order.value && order.value.creator.id === me.value);
    const canUpdate = computed(() => {
      const o = order.value;
      if (!o || o.segment !== '进行中' || o.status === '待接单') return false;
      return (o.taker && o.taker.id === me.value) || o.creator.id === me.value
        || (o.collaborators || []).some((c) => c.id === me.value);
    });
    const canTake = computed(() => order.value && order.value.status === '待接单');
    const canCollaborate = computed(() => {
      const o = order.value;
      if (!o || o.segment !== '进行中' || !o.taker) return false;
      return o.taker.id !== me.value && !(o.collaborators || []).some((c) => c.id === me.value);
    });

    async function take() {
      try {
        const res = await api.takeOrder(props.orderId);
        order.value = res.order;
        toast(res.joined_as_collaborator ? '已加入协作' : '已接单，已通知下单人');
      } catch (err) {
        toast(err.message);
        load();
      }
    }

    async function collaborate() {
      try {
        order.value = await api.collaborate(props.orderId);
        toast('已加入协作');
      } catch (err) {
        toast(err.message);
      }
    }

    async function assign(memberId) {
      if (!memberId) return;
      try {
        order.value = await api.assignOrder(props.orderId, memberId);
        assigning.value = false;
        toast('已指派并通知家人');
      } catch (err) {
        toast(err.message);
      }
    }

    async function cancel() {
      if (!window.confirm('确认取消这个点菜单？相关家人会收到通知。')) return;
      try {
        order.value = await api.cancelOrder(props.orderId, '');
        toast('订单已取消，已通知相关家人');
      } catch (err) {
        toast(err.message);
      }
    }

    /** 进度步进条：按 FLOW 展示，附过程照片 */
    function renderStepper() {
      const o = order.value;
      const progress = o.progress || [];
      const byStatus = new Map();
      for (const p of progress) {
        if (!byStatus.has(p.status)) byStatus.set(p.status, p);
      }

      if (o.status === '已取消') {
        const canceledAt = byStatus.get('已取消');
        return h('div', { class: 'stepper' }, [
          h('div', { class: 'step canceled' }, [
            h('div', { class: 'dot' }, [h('i', { class: 'fas fa-ban' })]),
            h('div', { class: 'txt' }, [
              h('div', { class: 't' }, '已取消'),
              h('div', { class: 'time' }, canceledAt
                ? `${clockTime(canceledAt.created_at)}${canceledAt.remark ? ` · ${canceledAt.remark}` : ''}`
                : ''),
            ]),
          ]),
        ]);
      }

      const flow = state.meta.flow;
      const curIdx = o.status === '待接单' ? -1 : flow.indexOf(o.status);

      return h('div', { class: 'stepper' }, flow.map((s, i) => {
        const cls = i < curIdx ? 'done' : (i === curIdx ? 'cur' : '');
        const rec = byStatus.get(s);
        return h('div', { class: `step ${cls}`, key: s }, [
          h('div', { class: 'dot' }, i < curIdx
            ? [h('i', { class: 'fas fa-check' })]
            : String(i + 1)),
          h('div', { class: 'txt grow' }, [
            h('div', { class: 't' }, s),
            h('div', { class: 'time' }, rec
              ? `${clockTime(rec.created_at)}${rec.member_name ? ` · ${rec.member_name}` : ''}${rec.remark ? ` · ${rec.remark}` : ''}`
              : '待更新'),
            rec && rec.photo_url
              ? h('div', { class: 'photo' }, [h('img', { src: rec.photo_url, alt: `${s} 过程照片` })])
              : null,
          ]),
        ]);
      }));
    }

    return () => {
      if (loading.value) {
        return h('div', { class: 'loading' }, [h('i', { class: 'fas fa-spinner spin' }), ' 加载中']);
      }
      const o = order.value;
      if (!o) return h('div', { class: 'empty' }, '订单不存在');

      const actions = [];
      if (canTake.value) {
        actions.push(h('button', { class: 'btn btn-primary btn-block', onClick: take },
          [h('i', { class: 'fas fa-hand-paper' }), ' 接单']));
      }
      if (canUpdate.value) {
        actions.push(h('button', {
          class: 'btn btn-primary btn-block',
          onClick: () => emit('progress', o),
        }, [h('i', { class: 'fas fa-arrow-up' }), ' 更新进度']));
      }
      if (canCollaborate.value) {
        actions.push(h('button', { class: 'btn btn-ghost btn-sm', onClick: collaborate }, '加入协作'));
      }
      if (o.segment === '进行中') {
        actions.push(h('button', { class: 'btn btn-danger btn-sm', onClick: cancel }, '取消'));
      }

      return h('div', null, [
        h('div', { class: 'section' }, [
          h('div', { class: 'card', style: 'padding:16px' }, [
            h('div', { class: 'row between mb12' }, [
              h('span', { class: `st st-${o.status}` }, [
                h('i', { class: `fas ${STATUS_ICON[o.status] || 'fa-circle'}` }), ` ${o.status}`,
              ]),
              h('span', { class: 'muted fs-sm' }, `${o.meal_time} · ${o.people}人用餐`),
            ]),
            h('div', { class: 'bold fs-lg mb12' }, o.dishes.map((d) => d.name).join(' + ')),
            h('div', { class: 'row gap8 mb12 wrap' }, [
              h('span', { class: `avatar ${isOnline(o.creator.id) ? 'online' : ''}` }, o.creator.avatar_text),
              h('span', { class: 'fs-sm sec' }, `${o.creator.name} 下单`),
              h('i', { class: 'fas fa-arrow-right muted fs-sm' }),
              o.taker
                ? h('span', { class: `avatar ${isOnline(o.taker.id) ? 'online' : ''}` }, o.taker.avatar_text)
                : null,
              h('span', { class: 'fs-sm sec' }, o.taker ? `${o.taker.name} 接单` : '等待家人接单'),
            ]),
            (o.collaborators || []).length
              ? h('div', { class: 'row gap8 mb12 wrap' }, [
                h('span', { class: 'fs-sm muted' }, '协作：'),
                ...o.collaborators.map((c) => h('span', { class: 'dish-chip' }, [
                  h('span', { class: 'thumb' }, c.avatar_text), c.name,
                ])),
              ])
              : null,
            o.note
              ? h('div', { class: 'meta-line' }, [
                h('span', null, [h('i', { class: 'far fa-comment-dots' }), `备注：${o.note}`]),
              ])
              : null,
            o.eat_for
              ? h('div', { class: 'meta-line mt8' }, [
                h('span', null, [h('i', { class: 'fas fa-user-tag' }), `为 ${o.eat_for} 点`]),
              ])
              : null,
          ]),
        ]),

        h('div', { class: 'section', style: 'padding-top:0' }, [
          h('div', { class: 'card', style: 'padding:16px' }, [
            h('div', { class: 'semi mb12' }, '进度跟踪'),
            renderStepper(),
          ]),
        ]),

        isCreator.value && o.segment === '进行中'
          ? h('div', { class: 'section', style: 'padding-top:0' }, [
            h('div', { class: 'card', style: 'padding:16px' }, [
              h('div', { class: 'row between' }, [
                h('div', { class: 'semi' }, '指派家人'),
                h('button', {
                  class: 'btn btn-line btn-sm',
                  onClick: () => { assigning.value = !assigning.value; },
                }, assigning.value ? '收起' : '选择'),
              ]),
              assigning.value
                ? h('div', { class: 'opt-group mt12' }, state.members
                  .filter((m) => m.id !== o.creator.id)
                  .map((m) => h('button', {
                    class: `opt ${o.taker && o.taker.id === m.id ? 'active' : ''}`,
                    onClick: () => assign(m.id),
                  }, `${m.name}${isOnline(m.id) ? ' · 在线' : ''}`)))
                : null,
            ]),
          ])
          : null,

        actions.length
          ? h('div', { class: 'bottom-bar' }, actions)
          : null,
      ]);
    };
  },
};
