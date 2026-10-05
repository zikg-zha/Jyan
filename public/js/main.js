/** 应用根组件：导航栈 + 底部 Tab + 全局 Toast */
import { createApp, h, ref, computed, onMounted } from '../vendor/vue.esm-browser.prod.js';
import { state, toast, bootstrap, requestPush } from './store.js';
import { Login } from './components/Login.js';
import { OrderList } from './components/OrderList.js';
import { OrderDetail } from './components/OrderDetail.js';
import { OrderCreate } from './components/OrderCreate.js';
import { DishLibrary, DishDetail } from './components/DishLibrary.js';
import { DishEditor } from './components/DishEditor.js';
import { Messages } from './components/Messages.js';
import { Profile } from './components/Profile.js';
import { ProgressSheet } from './components/ProgressSheet.js';

const TABS = [
  { key: 'orders', title: '订单', icon: 'fa-receipt' },
  { key: 'dishes', title: '菜品库', icon: 'fa-book-open' },
  { key: 'create', title: '点菜', icon: 'fa-plus-circle' },
  { key: 'messages', title: '消息', icon: 'fa-bell' },
  { key: 'profile', title: '我的', icon: 'fa-user' },
];

const TITLES = {
  orders: '家宴 · 订单',
  dishes: '菜品库',
  create: '点菜',
  messages: '消息',
  profile: '我的',
  'order-detail': '订单详情',
  'dish-detail': '菜品详情',
  'dish-editor': '菜品编辑',
};

const App = {
  setup() {
    // 导航栈：栈底始终是一个 Tab 页
    const stack = ref([{ page: 'orders' }]);
    const current = computed(() => stack.value[stack.value.length - 1]);
    const progressOrder = ref(null);
    const pushAsked = ref(false);

    function push(entry) {
      stack.value = [...stack.value, entry];
    }
    function back() {
      if (stack.value.length > 1) stack.value = stack.value.slice(0, -1);
    }
    function goTab(key) {
      stack.value = [{ page: key }];
    }

    onMounted(async () => {
      await bootstrap();
      // 首次进入引导开启推送，未授权时保留站内消息
      if (state.member && !state.pushGranted) pushAsked.value = true;
    });

    function openOrder(idOrOrder) {
      const id = typeof idOrOrder === 'object' ? idOrOrder.id : Number(idOrOrder);
      if (!id) return;
      push({ page: 'order-detail', orderId: id });
    }

    function openProgress(order) {
      progressOrder.value = order;
    }

    function renderTabbar() {
      return h('nav', { class: 'tabbar' }, TABS.map((t) => h('button', {
        key: t.key,
        class: `tab ${current.value.page === t.key ? 'active' : ''}`,
        'aria-label': t.title,
        onClick: () => goTab(t.key),
      }, [
        h('i', { class: `fas ${t.icon}` }),
        h('span', null, t.title),
        t.key === 'messages' && state.unread > 0
          ? h('span', { class: 'badge-dot' }, state.unread > 99 ? '99+' : String(state.unread))
          : null,
      ])));
    }

    function renderBody() {
      const cur = current.value;
      switch (cur.page) {
        case 'orders':
          return h(OrderList, {
            onOpen: openOrder,
            onProgress: openProgress,
          });
        case 'dishes':
          return h(DishLibrary, {
            onOpen: (d) => push({ page: 'dish-detail', dishId: d.id }),
            onCreate: () => push({ page: 'dish-editor', dishId: 0 }),
          });
        case 'create':
          return h(OrderCreate, {
            presetDishId: cur.presetDishId || 0,
            onSubmitted: (order) => {
              stack.value = [{ page: 'orders' }, { page: 'order-detail', orderId: order.id }];
            },
          });
        case 'messages':
          return h(Messages, { onOpenOrder: openOrder });
        case 'profile':
          return h(Profile);
        case 'order-detail':
          return h(OrderDetail, {
            orderId: cur.orderId,
            onProgress: openProgress,
            onBack: back,
          });
        case 'dish-detail':
          return h(DishDetail, {
            dishId: cur.dishId,
            onOrder: (d) => { stack.value = [{ page: 'create', presetDishId: d.id }]; },
            onEdit: (d) => push({ page: 'dish-editor', dishId: d.id }),
            onDeleted: () => { back(); toast('菜品已删除'); },
          });
        case 'dish-editor':
          return h(DishEditor, {
            dishId: cur.dishId || 0,
            onSaved: (d) => {
              stack.value = [{ page: 'dishes' }, { page: 'dish-detail', dishId: d.id }];
            },
            onCancel: back,
          });
        default:
          return h('div', { class: 'empty' }, '页面不存在');
      }
    }
    return () => {
      if (state.configError) {
        return h('div', { class: 'shell' }, [
          h('div', { class: 'empty' }, [
            h('i', { class: 'fas fa-plug' }),
            h('div', null, state.configError),
          ]),
        ]);
      }
      if (!state.ready) {
        return h('div', { class: 'shell' }, [
          h('div', { class: 'loading' }, [h('i', { class: 'fas fa-spinner spin' }), ' 正在进入家宴']),
        ]);
      }
      if (!state.member) {
        return h('div', { class: 'shell' }, [
          h(Login),
          state.toast ? h('div', { class: 'toast' }, state.toast) : null,
        ]);
      }

      const cur = current.value;
      const isTab = TABS.some((t) => t.key === cur.page);

      return h('div', { class: 'shell' }, [
        h('header', { class: 'appbar' }, [
          h('div', { class: 'appbar-left' }, [
            isTab
              ? null
              : h('button', {
                class: 'icon-btn back', 'aria-label': '返回', onClick: back,
              }, [h('i', { class: 'fas fa-chevron-left' })]),
            h('span', { class: 'title' }, TITLES[cur.page] || '家宴'),
          ]),
          h('div', { class: 'appbar-right' }, [
            h('span', {
              class: `net-dot ${state.connected ? '' : 'off'}`,
              title: state.connected ? '实时同步已连接' : '实时通道断开，已切换 3 秒轮询',
              'aria-label': state.connected ? '实时同步已连接' : '实时通道断开，已切换轮询',
            }),
            h('button', {
              class: 'icon-btn',
              'aria-label': '消息',
              onClick: () => goTab('messages'),
            }, [
              h('i', { class: 'far fa-bell' }),
              state.unread > 0
                ? h('span', { class: 'badge-dot' }, state.unread > 99 ? '99+' : String(state.unread))
                : null,
            ]),
          ]),
        ]),

        h('main', { class: `screen-body ${isTab ? 'with-tabbar' : ''}` }, [
          pushAsked.value && !state.pushGranted && isTab
            ? h('div', { class: 'section', style: 'padding-bottom:0' }, [
              h('div', { class: 'warn-box' }, [
                h('i', { class: 'far fa-bell' }),
                h('div', { class: 'grow' }, [
                  h('div', { class: 'fs-sm' }, '开启进度通知，做菜状态变更时第一时间提醒你。'),
                  h('div', { class: 'row gap8 mt8' }, [
                    h('button', {
                      class: 'btn btn-primary btn-sm',
                      onClick: async () => { await requestPush(); pushAsked.value = false; },
                    }, '允许通知'),
                    h('button', {
                      class: 'btn btn-ghost btn-sm',
                      onClick: () => { pushAsked.value = false; },
                    }, '暂不开启'),
                  ]),
                ]),
              ]),
            ])
            : null,
          renderBody(),
        ]),

        isTab ? renderTabbar() : null,

        progressOrder.value
          ? h(ProgressSheet, {
            order: progressOrder.value,
            onClose: () => { progressOrder.value = null; },
            onUpdated: () => { progressOrder.value = null; },
          })
          : null,

        state.toast ? h('div', { class: 'toast' }, state.toast) : null,
      ]);
    };
  },
};

createApp(App).mount('#app');
