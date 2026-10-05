/** 点菜下单（F-002）+ 忌口提醒（F-008） */
import { h, ref, computed, onMounted } from '../../vendor/vue.esm-browser.prod.js';
import { api } from '../api.js';
import { state, toast, isOnline } from '../store.js';
import { Sheet, Empty } from './common.js';

export const OrderCreate = {
  props: { presetDishId: Number },
  emits: ['submitted'],
  setup(props, { emit }) {
    const dishes = ref([]);
    const keyword = ref('');
    const picked = ref([]);           // dish id 集合
    const mealTime = ref('今天晚饭');
    const people = ref(3);
    const eatForIds = ref([]);        // 为谁点（忌口比对）
    const note = ref('');
    const assigneeId = ref(0);
    const busy = ref(false);
    const loading = ref(true);
    const warnings = ref([]);         // 忌口命中
    const showWarn = ref(false);
    const pendingConfirm = ref(false);

    async function loadDishes() {
      try {
        dishes.value = await api.dishes({ keyword: keyword.value });
      } catch (err) {
        toast(err.message);
      } finally {
        loading.value = false;
      }
    }

    onMounted(async () => {
      await loadDishes();
      if (props.presetDishId) picked.value = [props.presetDishId];
      // 默认按在线家人数预填用餐人数
      const online = state.members.filter((m) => isOnline(m.id)).length;
      people.value = Math.max(2, online || 3);
      if (state.member) eatForIds.value = [state.member.id];
    });

    const filtered = computed(() => {
      const kw = keyword.value.trim();
      if (!kw) return dishes.value;
      return dishes.value.filter((d) => d.name.includes(kw));
    });

    /** 勾选菜品后即时比对忌口，命中则提醒（不阻止） */
    async function toggle(dish) {
      const i = picked.value.indexOf(dish.id);
      if (i > -1) {
        picked.value = picked.value.filter((x) => x !== dish.id);
        return;
      }
      picked.value = [...picked.value, dish.id];
      await checkTaboo([dish.id]);
    }

    async function checkTaboo(dishIds) {
      if (!eatForIds.value.length) return [];
      try {
        const data = await api.tabooCheck(dishIds, eatForIds.value);
        if (data.warnings.length) {
          warnings.value = data.warnings;
          showWarn.value = true;
        }
        return data.warnings;
      } catch (_) {
        return [];
      }
    }

    function toggleEatFor(memberId) {
      const i = eatForIds.value.indexOf(memberId);
      eatForIds.value = i > -1
        ? eatForIds.value.filter((x) => x !== memberId)
        : [...eatForIds.value, memberId];
      if (picked.value.length) checkTaboo(picked.value);
    }

    async function submit() {
      if (!picked.value.length) {
        toast('请至少选择一道菜');
        return;
      }
      // 提交前再校验一次忌口，命中时提醒后允许继续
      if (!pendingConfirm.value) {
        const hits = await checkTaboo(picked.value);
        if (hits.length) {
          pendingConfirm.value = true;
          return;
        }
      }
      await doSubmit();
    }

    async function doSubmit() {
      busy.value = true;
      try {
        const eatForNames = state.members
          .filter((m) => eatForIds.value.includes(m.id))
          .map((m) => m.name)
          .join('、');
        const order = await api.createOrder({
          dish_ids: picked.value,
          meal_time: mealTime.value,
          people: people.value,
          note: note.value.trim(),
          eat_for: eatForNames,
          assignee_id: assigneeId.value || undefined,
        });
        toast('点菜单已提交，全家已可见');
        picked.value = [];
        note.value = '';
        assigneeId.value = 0;
        pendingConfirm.value = false;
        emit('submitted', order);
      } catch (err) {
        toast(err.message);
      } finally {
        busy.value = false;
      }
    }

    function renderDishRow(d) {
      const on = picked.value.includes(d.id);
      return h('div', {
        class: `selectable-dish ${on ? 'active' : ''}`,
        key: d.id,
        role: 'checkbox',
        'aria-checked': on,
        tabindex: 0,
        onClick: () => toggle(d),
        onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(d); } },
      }, [
        h('span', { class: 'thumb' }, d.cover_url
          ? [h('img', { src: d.cover_url, alt: d.name })]
          : [h('i', { class: `fas ${d.icon || 'fa-utensils'}` })]),
        h('div', { class: 'grow' }, [
          h('div', { class: 'semi' }, d.name),
          h('div', { class: 'fs-sm muted' },
            `${d.category} · ${d.duration}分钟 · ${d.difficulty}`),
        ]),
        h('span', { class: 'check' }, [h('i', { class: 'fas fa-check' })]),
      ]);
    }

    return () => h('div', null, [
      h('div', { class: 'section' }, [
        h('div', { class: 'field' }, [
          h('label', { for: 'pick-search' }, [
            '选择想吃的菜 ',
            h('span', { class: 'muted fs-sm' }, `（已选 ${picked.value.length} 道）`),
          ]),
          h('input', {
            id: 'pick-search',
            class: 'input mb12',
            placeholder: '搜索菜品…',
            value: keyword.value,
            onInput: (e) => { keyword.value = e.target.value; },
          }),
          loading.value
            ? h('div', { class: 'loading' }, [h('i', { class: 'fas fa-spinner spin' })])
            : filtered.value.length
              ? h('div', { class: 'pick-scroll' }, filtered.value.map(renderDishRow))
              : h(Empty, { icon: 'fa-search', text: '没有找到菜品' }),
        ]),

        h('div', { class: 'field' }, [
          h('label', null, '用餐时间'),
          h('div', { class: 'opt-group' }, state.meta.meal_times.map((t) => h('button', {
            class: `opt ${mealTime.value === t ? 'active' : ''}`,
            onClick: () => { mealTime.value = t; },
          }, t))),
        ]),

        h('div', { class: 'field' }, [
          h('label', null, '用餐人数'),
          h('div', { class: 'opt-group' }, [2, 3, 4, 5, 6].map((n) => h('button', {
            class: `opt ${people.value === n ? 'active' : ''}`,
            onClick: () => { people.value = n; },
          }, `${n} 人`))),
        ]),

        h('div', { class: 'field' }, [
          h('label', null, '为谁点（用于忌口提醒，可多选）'),
          h('div', { class: 'opt-group' }, state.members.map((m) => h('button', {
            class: `opt ${eatForIds.value.includes(m.id) ? 'active' : ''}`,
            onClick: () => toggleEatFor(m.id),
          }, `${m.name}${m.taboos.length ? `(忌${m.taboos.join('、')})` : ''}`))),
        ]),

        h('div', { class: 'field' }, [
          h('label', null, '指派家人（可选，不指派则等家人接单）'),
          h('div', { class: 'opt-group' }, [
            h('button', {
              class: `opt ${assigneeId.value === 0 ? 'active' : ''}`,
              onClick: () => { assigneeId.value = 0; },
            }, '不指派'),
            ...state.members
              .filter((m) => m.id !== state.member.id)
              .map((m) => h('button', {
                class: `opt ${assigneeId.value === m.id ? 'active' : ''}`,
                onClick: () => { assigneeId.value = m.id; },
              }, `${m.name}${isOnline(m.id) ? ' · 在线' : ''}`)),
          ]),
        ]),

        h('div', { class: 'field' }, [
          h('label', { for: 'order-note' }, '备注'),
          h('textarea', {
            id: 'order-note',
            class: 'textarea',
            placeholder: '如：少盐、多点辣、鱼要新鲜…',
            value: note.value,
            onInput: (e) => { note.value = e.target.value; },
          }),
        ]),
      ]),

      h('div', { class: 'bottom-bar' }, [
        h('button', {
          class: 'btn btn-primary btn-block',
          disabled: busy.value,
          onClick: submit,
        }, busy.value
          ? [h('i', { class: 'fas fa-spinner spin' }), ' 提交中']
          : [h('i', { class: 'fas fa-paper-plane' }), ' 提交点菜单']),
      ]),

      // 忌口提醒弹层：提醒但不阻止
      showWarn.value
        ? h(Sheet, {
          onClose: () => { showWarn.value = false; pendingConfirm.value = false; },
        }, {
          default: () => [
            h('h3', null, [
              h('i', { class: 'fas fa-exclamation-triangle', style: 'color:var(--color-warning)' }),
              ' 忌口提醒',
            ]),
            ...warnings.value.map((w) => h('div', { class: 'warn-box' }, [
              h('i', { class: 'fas fa-info-circle' }),
              h('div', null, w.message),
            ])),
            h('div', { class: 'row gap12' }, [
              h('button', {
                class: 'btn btn-line btn-block',
                onClick: () => {
                  // 换一道：移除命中的菜品
                  const bad = new Set(warnings.value.map((w) => w.dish_id));
                  picked.value = picked.value.filter((id) => !bad.has(id));
                  showWarn.value = false;
                  pendingConfirm.value = false;
                },
              }, '换一道'),
              h('button', {
                class: 'btn btn-primary btn-block',
                onClick: async () => {
                  showWarn.value = false;
                  if (pendingConfirm.value) await doSubmit();
                },
              }, pendingConfirm.value ? '仍然提交' : '仍然选择'),
            ]),
          ],
        })
        : null,
    ]);
  },
};
