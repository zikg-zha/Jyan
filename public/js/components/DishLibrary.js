/** 菜品库列表 + 详情（F-001） */
import { h, ref, computed, onMounted, onUnmounted } from '../../vendor/vue.esm-browser.prod.js';
import { api } from '../api.js';
import { state, toast, onDishChange } from '../store.js';
import { Empty } from './common.js';

export const DishLibrary = {
  emits: ['open', 'create'],
  setup(props, { emit }) {
    const category = ref('全部');
    const keyword = ref('');
    const dishes = ref([]);
    const loading = ref(true);

    async function load() {
      try {
        dishes.value = await api.dishes({
          category: category.value,
          keyword: keyword.value.trim(),
        });
      } catch (err) {
        toast(err.message);
      } finally {
        loading.value = false;
      }
    }

    let off = null;
    onMounted(() => {
      load();
      off = onDishChange(() => load());
    });
    onUnmounted(() => { if (off) off(); });

    function setCategory(c) {
      category.value = c;
      load();
    }

    let debounce = null;
    function onSearch(v) {
      keyword.value = v;
      clearTimeout(debounce);
      debounce = setTimeout(load, 220);
    }

    return () => h('div', null, [
      h('div', { class: 'filter-bar' }, ['全部', ...state.meta.categories].map((c) => h('button', {
        class: `chip ${category.value === c ? 'active' : ''}`,
        onClick: () => setCategory(c),
      }, c))),

      h('div', { style: 'padding:0 16px' }, [
        h('input', {
          class: 'input',
          placeholder: '搜索菜品名称…',
          value: keyword.value,
          'aria-label': '搜索菜品名称',
          onInput: (e) => onSearch(e.target.value),
        }),
      ]),

      loading.value
        ? h('div', { class: 'loading' }, [h('i', { class: 'fas fa-spinner spin' }), ' 加载中'])
        : dishes.value.length
          ? h('div', { class: 'dish-grid' }, dishes.value.map((d) => h('div', {
            class: 'dish-card',
            key: d.id,
            role: 'button',
            tabindex: 0,
            onClick: () => emit('open', d),
            onKeydown: (e) => { if (e.key === 'Enter') emit('open', d); },
          }, [
            h('div', { class: 'cover' }, d.cover_url
              ? [h('img', { src: d.cover_url, alt: d.name })]
              : [h('i', { class: `fas ${d.icon || 'fa-utensils'}` })]),
            h('div', { class: 'info' }, [
              h('div', { class: 'name ellipsis' }, d.name),
              h('div', { class: 'sub' }, [
                h('span', { class: `tag tag-${d.category}` }, d.category),
                h('span', null, [h('i', { class: 'far fa-clock' }), `${d.duration}分`]),
                d.order_count
                  ? h('span', null, [h('i', { class: 'fas fa-fire' }), d.order_count])
                  : null,
              ]),
            ]),
          ])))
          : h(Empty, { icon: 'fa-search', text: '没有找到菜品，换个关键词或新建一道' }),

      h('div', { class: 'section', style: 'padding-top:0' }, [
        h('button', {
          class: 'btn btn-ghost btn-block',
          onClick: () => emit('create'),
        }, [h('i', { class: 'fas fa-plus' }), ' 新建菜品']),
      ]),
    ]);
  },
};

/** 菜品详情 */
export const DishDetail = {
  props: { dishId: Number },
  emits: ['order', 'edit', 'deleted'],
  setup(props, { emit }) {
    const dish = ref(null);
    const loading = ref(true);

    onMounted(async () => {
      try {
        dish.value = await api.dish(props.dishId);
      } catch (err) {
        toast(err.message);
      } finally {
        loading.value = false;
      }
    });

    async function remove() {
      if (!window.confirm(`确认删除菜品「${dish.value.name}」？`)) return;
      try {
        await api.deleteDish(props.dishId);
        toast('菜品已删除');
        emit('deleted');
      } catch (err) {
        toast(err.message);
      }
    }

    const ingredientText = computed(() => (dish.value ? dish.value.ingredients : [])
      .map((i) => `${i.name} ${i.amount || ''}${i.unit || ''}`.trim()));

    return () => {
      if (loading.value) {
        return h('div', { class: 'loading' }, [h('i', { class: 'fas fa-spinner spin' }), ' 加载中']);
      }
      const d = dish.value;
      if (!d) return h(Empty, { text: '菜品不存在' });

      return h('div', null, [
        h('div', { class: 'dish-card', style: 'border-radius:0;box-shadow:none' }, [
          h('div', { class: 'cover', style: 'height:180px' }, d.cover_url
            ? [h('img', { src: d.cover_url, alt: d.name })]
            : [h('i', { class: `fas ${d.icon || 'fa-utensils'}` })]),
        ]),

        h('div', { class: 'section' }, [
          h('div', { class: 'row between mb12' }, [
            h('span', { class: 'bold fs-xl' }, d.name),
            h('span', { class: `tag tag-${d.category}` }, d.category),
          ]),
          h('div', { class: 'meta-line mb16' }, [
            h('span', null, [h('i', { class: 'far fa-clock' }), `${d.duration} 分钟`]),
            h('span', null, [h('i', { class: 'fas fa-signal' }), d.difficulty]),
            h('span', null, [h('i', { class: 'fas fa-users' }), `基准 ${d.servings} 人份`]),
            h('span', null, [h('i', { class: 'fas fa-fire' }), `被点 ${d.order_count} 次`]),
          ]),

          h('div', { class: 'card mb16', style: 'padding:16px' }, [
            h('div', { class: 'semi mb12' }, [
              h('i', { class: 'fas fa-carrot', style: 'color:var(--color-warning)' }),
              ' 食材清单',
            ]),
            ingredientText.value.length
              ? h('div', { class: 'meta-line', style: 'gap:8px 20px' },
                ingredientText.value.map((t) => h('span', null, t)))
              : h('div', { class: 'fs-sm muted' }, '未登记食材'),
          ]),

          h('div', { class: 'card', style: 'padding:16px' }, [
            h('div', { class: 'semi mb12' }, [
              h('i', { class: 'fas fa-list-ol', style: 'color:var(--color-primary)' }),
              ` 图文做法（${d.steps.length} 步）`,
            ]),
            ...d.steps.map((s, i) => h('div', {
              class: 'step done',
              style: i === d.steps.length - 1 ? '' : 'padding-bottom:16px',
              key: i,
            }, [
              h('div', { class: 'dot' }, String(i + 1)),
              h('div', { class: 'txt grow' }, [
                h('div', { class: 't' }, s.title || `步骤 ${i + 1}`),
                h('div', { class: 'fs-sm sec' }, s.desc),
                s.photo
                  ? h('div', { class: 'photo' }, [h('img', { src: s.photo, alt: s.title })])
                  : null,
              ]),
            ])),
          ]),
        ]),

        h('div', { class: 'bottom-bar' }, [
          h('button', {
            class: 'btn btn-line btn-icon',
            'aria-label': '编辑菜品',
            onClick: () => emit('edit', d),
          }, [h('i', { class: 'far fa-edit' })]),
          h('button', {
            class: 'btn btn-danger btn-icon',
            'aria-label': '删除菜品',
            onClick: remove,
          }, [h('i', { class: 'far fa-trash-alt' })]),
          h('button', {
            class: 'btn btn-primary btn-block',
            onClick: () => emit('order', d),
          }, [h('i', { class: 'fas fa-plus' }), ' 点这道菜']),
        ]),
      ]);
    };
  },
};
