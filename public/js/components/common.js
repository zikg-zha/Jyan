/** 通用组件：底部弹层、空态、图片上传 */
import { h, ref } from '../../vendor/vue.esm-browser.prod.js';
import { api } from '../api.js';
import { toast } from '../store.js';

/** 底部抽屉弹层 */
export const Sheet = {
  props: { title: String },
  emits: ['close'],
  setup(props, { slots, emit }) {
    return () => h('div', {
      class: 'mask',
      onClick: (e) => { if (e.target.classList.contains('mask')) emit('close'); },
    }, [
      h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, [
        props.title ? h('h3', { class: 'mb12' }, props.title) : null,
        slots.default ? slots.default() : null,
      ]),
    ]);
  },
};

/** 空态 */
export const Empty = {
  props: { icon: { type: String, default: 'fa-bowl-food' }, text: String },
  setup(props) {
    return () => h('div', { class: 'empty' }, [
      h('i', { class: `fas ${props.icon}` }),
      h('div', null, props.text || '暂无数据'),
    ]);
  },
};

/** 图片上传按钮：上传成功后回传 url */
export const ImageUpload = {
  props: { value: String, label: { type: String, default: '加图' } },
  emits: ['update:value'],
  setup(props, { emit }) {
    const inputRef = ref(null);
    const busy = ref(false);

    async function pick(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      busy.value = true;
      try {
        const data = await api.upload(file);
        emit('update:value', data.url);
      } catch (err) {
        toast(err.message);
      } finally {
        busy.value = false;
        if (inputRef.value) inputRef.value.value = '';
      }
    }

    return () => h('div', { class: 'row gap8' }, [
      h('div', {
        class: 'upload-box',
        role: 'button',
        tabindex: 0,
        onClick: () => inputRef.value && inputRef.value.click(),
        onKeydown: (e) => { if (e.key === 'Enter') inputRef.value.click(); },
      }, busy.value
        ? [h('i', { class: 'fas fa-spinner spin' })]
        : props.value
          ? [h('img', { src: props.value, alt: '已上传图片' })]
          : [h('i', { class: 'fas fa-camera' }), h('span', null, props.label)]),
      props.value
        ? h('button', {
          class: 'btn btn-line btn-sm',
          onClick: () => emit('update:value', ''),
        }, '移除')
        : null,
      h('input', {
        ref: inputRef,
        type: 'file',
        accept: 'image/*',
        class: 'sr-only',
        onChange: pick,
      }),
    ]);
  },
};

/** 状态图标映射 */
export const STATUS_ICON = {
  待接单: 'fa-hourglass-half',
  已接单: 'fa-hand-paper',
  采购中: 'fa-shopping-basket',
  准备中: 'fa-mortar-pestle',
  烹饪中: 'fa-fire',
  已完成: 'fa-check-circle',
  已取消: 'fa-ban',
};

export function relativeTime(text) {
  if (!text) return '';
  const t = new Date(String(text).replace(' ', 'T'));
  if (Number.isNaN(t.getTime())) return text;
  const diff = Date.now() - t.getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

export function clockTime(text) {
  if (!text) return '';
  const t = new Date(String(text).replace(' ', 'T'));
  if (Number.isNaN(t.getTime())) return text;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(t.getHours())}:${p(t.getMinutes())}`;
}
