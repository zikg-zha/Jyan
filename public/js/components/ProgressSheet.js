/** 更新做菜进度弹层（F-004）：按顺序推进 + 过程照片 + 备注 */
import { h, ref } from '../../vendor/vue.esm-browser.prod.js';
import { api, ApiError } from '../api.js';
import { state, toast } from '../store.js';
import { Sheet, ImageUpload, STATUS_ICON } from './common.js';

export const ProgressSheet = {
  props: { order: Object },
  emits: ['close', 'updated'],
  setup(props, { emit }) {
    const picked = ref(props.order.next_status || '');
    const photo = ref('');
    const remark = ref('');
    const busy = ref(false);
    const confirmCancel = ref(false);

    const flow = state.meta.flow;
    const curIdx = props.order.status === '待接单' ? -1 : flow.indexOf(props.order.status);

    async function submit() {
      if (!picked.value) {
        toast('请选择当前状态');
        return;
      }
      busy.value = true;
      try {
        const updated = await api.updateStatus(props.order.id, {
          status: picked.value,
          photo_url: photo.value,
          remark: remark.value.trim(),
          version: props.order.version,
        });
        toast(picked.value === '已完成' ? '已标记完成，家人会收到通知' : `已更新为 ${picked.value}`);
        emit('updated', updated);
        emit('close');
      } catch (err) {
        // 异地并发冲突：以服务端最新状态为准（R-001）
        if (err instanceof ApiError && err.status === 409 && err.data) {
          toast(err.message);
          emit('updated', err.data);
          emit('close');
        } else {
          toast(err.message);
        }
      } finally {
        busy.value = false;
      }
    }

    async function doCancel() {
      busy.value = true;
      try {
        const updated = await api.cancelOrder(props.order.id, remark.value.trim());
        toast('订单已取消，已通知相关家人');
        emit('updated', updated);
        emit('close');
      } catch (err) {
        toast(err.message);
      } finally {
        busy.value = false;
      }
    }

    return () => h(Sheet, { title: '更新做菜进度', onClose: () => emit('close') }, {
      default: () => [
        h('div', { class: 'fs-sm sec mb12' },
          props.order.dishes.map((d) => d.name).join(' + ')),

        h('div', { class: 'opt-group' }, flow.map((s, i) => {
          const passed = i <= curIdx;
          const isNext = i === curIdx + 1;
          return h('button', {
            key: s,
            class: `opt ${picked.value === s ? 'active' : ''} ${passed || !isNext ? 'disabled' : ''}`,
            disabled: passed || !isNext,
            onClick: () => { if (isNext) picked.value = s; },
          }, [
            h('i', { class: `fas ${STATUS_ICON[s] || 'fa-circle'}` }),
            ` ${s}`,
            passed ? h('span', { class: 'fs-sm muted' }, ' 已完成') : null,
            !passed && !isNext ? h('span', { class: 'fs-sm muted' }, ' 待前一步') : null,
          ]);
        })),

        h('div', { class: 'field mt12' }, [
          h('label', null, '过程照片（可选）'),
          h(ImageUpload, {
            value: photo.value,
            label: '拍一张',
            'onUpdate:value': (v) => { photo.value = v; },
          }),
        ]),

        h('div', { class: 'field' }, [
          h('label', { for: 'pg-remark' }, '备注（可选）'),
          h('input', {
            id: 'pg-remark',
            class: 'input',
            placeholder: '如：还差 10 分钟出锅',
            value: remark.value,
            onInput: (e) => { remark.value = e.target.value; },
          }),
        ]),

        h('div', { class: 'fs-sm muted mb12' }, '选择当前状态，下单人将在 5 秒内收到通知'),

        h('button', {
          class: 'btn btn-primary btn-block',
          disabled: busy.value,
          onClick: submit,
        }, busy.value ? '提交中…' : '确认更新'),

        confirmCancel.value
          ? h('div', { class: 'mt12' }, [
            h('div', { class: 'fs-sm mb8', style: 'color:var(--color-error)' },
              '取消后订单不可恢复，相关家人会收到通知。确认取消？'),
            h('div', { class: 'row gap8' }, [
              h('button', {
                class: 'btn btn-line btn-sm grow',
                onClick: () => { confirmCancel.value = false; },
              }, '再想想'),
              h('button', {
                class: 'btn btn-danger btn-sm grow',
                disabled: busy.value,
                onClick: doCancel,
              }, '确认取消订单'),
            ]),
          ])
          : h('button', {
            class: 'btn btn-ghost btn-block mt8',
            onClick: () => { confirmCancel.value = true; },
          }, '取消这个订单'),
      ],
    });
  },
};
