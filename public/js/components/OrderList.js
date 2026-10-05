/** 订单列表与筛选（F-006） */
import { h, ref, computed, onMounted, onUnmounted } from '../../vendor/vue.esm-browser.prod.js';
import { api } from '../api.js';
import { state, toast, onOrderChange, isOnline } from '../store.js';
import { Empty, STATUS_ICON } from './common.js';

export const OrderList = {
  emits: ['open', 'take', 'progress'],
  setup(props, { emit }) {
    const segment = ref('进行中');
    const scope = ref('今日');
    const relation = ref('全部');
    const creatorId = ref(0);
    const takerId = ref(0);
    const items = ref([]);
    const loading = ref(true);
    const elapsed = ref(null);
    const showFilter = ref(false);

    async function load(showTiming = false) {
      loading.value = items.value.length === 0;
      try {
        const data = await api.orders({
          segment: segment.value,
          scope: scope.value,
          relation: relation.value,
          creator_id: creatorId.value || undefined,
          taker_id: takerId.value || undefined,
        });
        items.value = data.items;
        elapsed.value = data.elapsed_ms;
        if (showTiming) {
          toast(`筛选完成 ${data.elapsed_ms}ms · ${data.items.length} 个订单`);
        }
      } catch (err) {
        toast(err.message);
      } finally {
        loading.value = false;
      }
    }

    function setSegment(seg) {
      segment.value = seg;
      load(true);
    }
    function setScope(v) {
      scope.value = v;
      load(true);
    }
    function setRelation(v) {
      relation.value = v;
      load();
    }

    let off = null;
    onMounted(() => {
      load();
      // 实时事件：新订单/状态变更后刷新列表，保证异地同步
      off = onOrderChange(() => load());
    });
    onUnmounted(() => { if (off) off(); });

    async function take(order, e) {
      e.stopPropagation();
      try {
        const res = await api.takeOrder(order.id);
        toast(res.joined_as_collaborator
          ? '该订单已被接单，已把你加入协作'
          : `已接单！已通知下单人 ${order.creator.name}`);
        load();
      } catch (err) {
        toast(err.message);
        load();
      }
    }

    const canTake = (o) => o.status === '待接单';
    const canUpdate = (o) => {
      if (o.segment !== '进行中' || o.status === '待接单') return false;
      const me = state.member.id;
      return o.taker && (o.taker.id === me || o.creator.id === me
        || (o.collaborators || []).some((c) => c.id === me));
    };

    function renderCard(o) {
      const chips = o.dishes.map((d) => h('span', { class: 'dish-chip' }, [
        h('span', { class: 'thumb' }, [h('i', { class: `fas ${d.icon || 'fa-utensils'}` })]),
        d.name,
      ]));

      const takerNode = o.taker
        ? [
          h('span', { class: `avatar ${isOnline(o.taker.id) ? 'online' : ''}` }, o.taker.avatar_text),
          h('span', { class: 'fs-sm sec' }, o.taker.name),
        ]
        : [h('span', { class: 'fs-sm', style: 'color:var(--color-primary)' }, '待接单')];

      let action = null;
      if (canTake(o)) {
        action = h('button', {
          class: 'btn btn-primary btn-sm',
          onClick: (e) => take(o, e),
        }, [h('i', { class: 'fas fa-hand-paper' }), ' 接单']);
      } else if (canUpdate(o)) {
        action = h('button', {
          class: 'btn btn-ghost btn-sm',
          onClick: (e) => { e.stopPropagation(); emit('progress', o); },
        }, '更新进度');
      }

      return h('div', {
        class: 'card order-card',
        key: o.id,
        role: 'button',
        tabindex: 0,
        onClick: () => emit('open', o),
        onKeydown: (e) => { if (e.key === 'Enter') emit('open', o); },
      }, [
        h('div', { class: 'row between' }, [
          h('span', { class: `st st-${o.status}` }, [
            h('i', { class: `fas ${STATUS_ICON[o.status] || 'fa-circle'}` }),
            ` ${o.status}`,
          ]),
          h('span', { class: 'muted fs-sm' }, [
            h('i', { class: 'far fa-clock' }), ` ${o.meal_time}`,
          ]),
        ]),
        h('div', { class: 'dishes' }, chips),
        h('div', { class: 'row between gap8' }, [
          h('div', { class: 'row gap8 grow', style: 'min-width:0' }, [
            h('span', { class: `avatar ${isOnline(o.creator.id) ? 'online' : ''}` }, o.creator.avatar_text),
            h('span', { class: 'fs-sm sec' }, `${o.creator.name}点`),
            h('i', { class: 'fas fa-arrow-right muted fs-sm' }),
            ...takerNode,
            (o.collaborators || []).length
              ? h('span', { class: 'fs-sm muted' }, `+${o.collaborators.length}协作`)
              : null,
          ]),
          action,
        ]),
        h('div', { class: 'meta-line mt8' }, [
          h('span', null, [h('i', { class: 'fas fa-users' }), `${o.people} 人用餐`]),
          o.note ? h('span', null, [h('i', { class: 'far fa-comment-dots' }), o.note]) : null,
        ]),
      ]);
    }

    const memberOptions = computed(() => state.members);

    return () => h('div', null, [
      h('div', { class: 'seg', role: 'tablist' }, state.meta.segments.map((seg) => h('button', {
        class: segment.value === seg ? 'active' : '',
        role: 'tab',
        'aria-selected': segment.value === seg,
        onClick: () => setSegment(seg),
      }, seg))),

      h('div', { class: 'filter-bar' }, [
        h('button', {
          class: `chip ${scope.value === '今日' ? 'active' : ''}`,
          onClick: () => setScope('今日'),
        }, '今日'),
        h('button', {
          class: `chip ${scope.value === '全部' ? 'active' : ''}`,
          onClick: () => setScope('全部'),
        }, '全部时间'),
        h('button', {
          class: `chip ${relation.value === '我下单的' ? 'active' : ''}`,
          onClick: () => setRelation(relation.value === '我下单的' ? '全部' : '我下单的'),
        }, '我下单的'),
        h('button', {
          class: `chip ${relation.value === '我接单的' ? 'active' : ''}`,
          onClick: () => setRelation(relation.value === '我接单的' ? '全部' : '我接单的'),
        }, '我接单的'),
        h('button', {
          class: `chip ${creatorId.value || takerId.value ? 'active' : ''}`,
          onClick: () => { showFilter.value = !showFilter.value; },
        }, [h('i', { class: 'fas fa-sliders-h' }), ' 更多']),
      ]),

      showFilter.value
        ? h('div', { class: 'section card', style: 'margin:0 16px 12px' }, [
          h('div', { class: 'field' }, [
            h('label', { for: 'f-creator' }, '下单人'),
            h('select', {
              id: 'f-creator',
              class: 'select',
              onChange: (e) => { creatorId.value = Number(e.target.value); load(); },
            }, [
              h('option', { value: 0 }, '全部'),
              ...memberOptions.value.map((m) => h('option', {
                value: m.id, selected: creatorId.value === m.id,
              }, m.name)),
            ]),
          ]),
          h('div', { class: 'field', style: 'margin-bottom:0' }, [
            h('label', { for: 'f-taker' }, '接单人'),
            h('select', {
              id: 'f-taker',
              class: 'select',
              onChange: (e) => { takerId.value = Number(e.target.value); load(); },
            }, [
              h('option', { value: 0 }, '全部'),
              ...memberOptions.value.map((m) => h('option', {
                value: m.id, selected: takerId.value === m.id,
              }, m.name)),
            ]),
          ]),
        ])
        : null,

      elapsed.value !== null && items.value.length
        ? h('div', { class: 'fs-sm muted', style: 'padding:0 16px 8px' },
          `共 ${items.value.length} 个订单 · 筛选耗时 ${elapsed.value}ms`)
        : null,

      loading.value
        ? h('div', { class: 'loading' }, [h('i', { class: 'fas fa-spinner spin' }), ' 加载中'])
        : items.value.length
          ? h('div', null, items.value.map(renderCard))
          : h(Empty, { text: '暂无订单，去点一道菜吧' }),
    ]);
  },
};
