/** 菜品新建 / 编辑（F-001）：食材动态列表 + 图文分步做法（≥3 步） */
import { h, ref, onMounted } from '../../vendor/vue.esm-browser.prod.js';
import { api } from '../api.js';
import { state, toast } from '../store.js';
import { ImageUpload } from './common.js';

const ICON_CHOICES = [
  ['fa-drumstick-bite', '肉禽'], ['fa-fish', '鱼虾'], ['fa-bacon', '五花'],
  ['fa-leaf', '青菜'], ['fa-seedling', '凉拌'], ['fa-mug-hot', '汤品'],
  ['fa-bowl-rice', '米饭'], ['fa-bowl-food', '面食'], ['fa-egg', '蛋类'],
  ['fa-pepper-hot', '辣味'], ['fa-utensils', '其他'],
];

export const DishEditor = {
  props: { dishId: Number },
  emits: ['saved', 'cancel'],
  setup(props, { emit }) {
    const isEdit = !!props.dishId;
    const name = ref('');
    const category = ref('荤菜');
    const difficulty = ref('简单');
    const duration = ref(30);
    const servings = ref(2);
    const coverUrl = ref('');
    const icon = ref('fa-utensils');
    const ingredients = ref([{ name: '', amount: '', unit: '' }]);
    const steps = ref([
      { title: '', desc: '', photo: '' },
      { title: '', desc: '', photo: '' },
      { title: '', desc: '', photo: '' },
    ]);
    const busy = ref(false);
    const loading = ref(isEdit);
    const errorMsg = ref('');

    onMounted(async () => {
      if (!isEdit) return;
      try {
        const d = await api.dish(props.dishId);
        name.value = d.name;
        category.value = d.category;
        difficulty.value = d.difficulty;
        duration.value = d.duration;
        servings.value = d.servings;
        coverUrl.value = d.cover_url;
        icon.value = d.icon;
        ingredients.value = d.ingredients.length
          ? d.ingredients.map((i) => ({ ...i }))
          : [{ name: '', amount: '', unit: '' }];
        steps.value = d.steps.length >= 3
          ? d.steps.map((s) => ({ ...s }))
          : [...d.steps, ...Array(3 - d.steps.length).fill(null)]
            .map((s) => (s ? { ...s } : { title: '', desc: '', photo: '' }));
      } catch (err) {
        toast(err.message);
      } finally {
        loading.value = false;
      }
    });

    function addIngredient() {
      ingredients.value = [...ingredients.value, { name: '', amount: '', unit: '' }];
    }
    function removeIngredient(idx) {
      ingredients.value = ingredients.value.filter((_, i) => i !== idx);
      if (!ingredients.value.length) addIngredient();
    }
    function addStep() {
      steps.value = [...steps.value, { title: '', desc: '', photo: '' }];
    }
    function removeStep(idx) {
      if (steps.value.length <= 3) {
        toast('做法至少需要 3 步');
        return;
      }
      steps.value = steps.value.filter((_, i) => i !== idx);
    }

    async function save() {
      errorMsg.value = '';
      if (!name.value.trim()) {
        errorMsg.value = '请填写菜品名称和分类';
        toast(errorMsg.value);
        return;
      }
      const validSteps = steps.value.filter((s) => s.desc.trim() || s.title.trim());
      if (validSteps.length < 3) {
        errorMsg.value = '做法至少需要 3 步';
        toast(errorMsg.value);
        return;
      }

      busy.value = true;
      const payload = {
        name: name.value.trim(),
        category: category.value,
        difficulty: difficulty.value,
        duration: Number(duration.value) || 30,
        servings: Number(servings.value) || 2,
        cover_url: coverUrl.value,
        icon: icon.value,
        ingredients: ingredients.value.filter((i) => i.name.trim()),
        steps: validSteps,
      };
      try {
        const saved = isEdit
          ? await api.updateDish(props.dishId, payload)
          : await api.createDish(payload);
        toast(isEdit ? '菜品已更新' : `菜品「${saved.name}」已保存，点菜时可选`);
        emit('saved', saved);
      } catch (err) {
        errorMsg.value = err.message;
        toast(err.message);
      } finally {
        busy.value = false;
      }
    }

    function renderIngredients() {
      return ingredients.value.map((ing, idx) => h('div', { class: 'dyn-row', key: idx }, [
        h('input', {
          class: 'input', style: 'flex:2', placeholder: '食材名', value: ing.name,
          'aria-label': `食材 ${idx + 1} 名称`,
          onInput: (e) => { ing.name = e.target.value; },
        }),
        h('input', {
          class: 'input', style: 'flex:1', placeholder: '用量', value: ing.amount,
          'aria-label': `食材 ${idx + 1} 用量`,
          onInput: (e) => { ing.amount = e.target.value; },
        }),
        h('input', {
          class: 'input', style: 'flex:1', placeholder: '单位', value: ing.unit,
          'aria-label': `食材 ${idx + 1} 单位`,
          onInput: (e) => { ing.unit = e.target.value; },
        }),
        h('button', {
          class: 'btn btn-line btn-sm', style: 'flex:none',
          'aria-label': `删除食材 ${idx + 1}`,
          onClick: () => removeIngredient(idx),
        }, [h('i', { class: 'fas fa-minus' })]),
      ]));
    }

    function renderSteps() {
      return steps.value.map((s, idx) => h('div', { class: 'step-editor', key: idx }, [
        h('div', { class: 'hd' }, [
          h('span', { class: 'semi' }, `步骤 ${idx + 1}`),
          h('button', {
            class: 'btn btn-line btn-sm',
            'aria-label': `删除步骤 ${idx + 1}`,
            onClick: () => removeStep(idx),
          }, [h('i', { class: 'fas fa-trash-alt' })]),
        ]),
        h('input', {
          class: 'input mb8', placeholder: '小标题，如：备料', value: s.title,
          'aria-label': `步骤 ${idx + 1} 标题`,
          onInput: (e) => { s.title = e.target.value; },
        }),
        h('textarea', {
          class: 'textarea mb8', placeholder: '做法说明', value: s.desc,
          'aria-label': `步骤 ${idx + 1} 说明`,
          onInput: (e) => { s.desc = e.target.value; },
        }),
        h(ImageUpload, {
          value: s.photo,
          label: '配图',
          'onUpdate:value': (url) => { s.photo = url; },
        }),
      ]));
    }

    return () => {
      if (loading.value) {
        return h('div', { class: 'loading' }, [h('i', { class: 'fas fa-spinner spin' }), ' 加载中']);
      }
      return h('div', null, [
        h('div', { class: 'section' }, [
          errorMsg.value
            ? h('div', { class: 'warn-box' }, [
              h('i', { class: 'fas fa-exclamation-circle' }),
              h('div', null, errorMsg.value),
            ])
            : null,

          h('div', { class: 'field' }, [
            h('label', { for: 'dish-name' }, '菜品名称 *'),
            h('input', {
              id: 'dish-name', class: 'input', placeholder: '如：宫保鸡丁',
              value: name.value,
              onInput: (e) => { name.value = e.target.value; },
            }),
          ]),

          h('div', { class: 'field' }, [
            h('label', null, '分类 *'),
            h('div', { class: 'opt-group' }, state.meta.categories.map((c) => h('button', {
              class: `opt ${category.value === c ? 'active' : ''}`,
              onClick: () => { category.value = c; },
            }, c))),
          ]),

          h('div', { class: 'field' }, [
            h('label', null, '封面图'),
            h(ImageUpload, {
              value: coverUrl.value,
              label: '封面',
              'onUpdate:value': (url) => { coverUrl.value = url; },
            }),
          ]),

          h('div', { class: 'field' }, [
            h('label', null, '图标（无封面图时展示）'),
            h('div', { class: 'opt-group' }, ICON_CHOICES.map(([ic, label]) => h('button', {
              class: `opt ${icon.value === ic ? 'active' : ''}`,
              onClick: () => { icon.value = ic; },
            }, [h('i', { class: `fas ${ic}` }), ` ${label}`]))),
          ]),

          h('div', { class: 'field' }, [
            h('label', null, '难度'),
            h('div', { class: 'opt-group' }, state.meta.difficulties.map((d) => h('button', {
              class: `opt ${difficulty.value === d ? 'active' : ''}`,
              onClick: () => { difficulty.value = d; },
            }, d))),
          ]),

          h('div', { class: 'row gap12' }, [
            h('div', { class: 'field grow' }, [
              h('label', { for: 'dish-duration' }, '耗时（分钟）'),
              h('input', {
                id: 'dish-duration', class: 'input', type: 'number', min: 1,
                value: duration.value,
                onInput: (e) => { duration.value = e.target.value; },
              }),
            ]),
            h('div', { class: 'field grow' }, [
              h('label', { for: 'dish-servings' }, '基准份数'),
              h('input', {
                id: 'dish-servings', class: 'input', type: 'number', min: 1,
                value: servings.value,
                onInput: (e) => { servings.value = e.target.value; },
              }),
            ]),
          ]),

          h('div', { class: 'field' }, [
            h('div', { class: 'row between mb8' }, [
              h('label', { style: 'margin:0' }, '食材清单'),
              h('button', { class: 'btn btn-ghost btn-sm', onClick: addIngredient },
                [h('i', { class: 'fas fa-plus' }), ' 加一行']),
            ]),
            ...renderIngredients(),
          ]),

          h('div', { class: 'field' }, [
            h('div', { class: 'row between mb8' }, [
              h('label', { style: 'margin:0' }, '图文做法（至少 3 步）'),
              h('button', { class: 'btn btn-ghost btn-sm', onClick: addStep },
                [h('i', { class: 'fas fa-plus' }), ' 加一步']),
            ]),
            ...renderSteps(),
          ]),
        ]),

        h('div', { class: 'bottom-bar' }, [
          h('button', {
            class: 'btn btn-line', style: 'flex:none',
            onClick: () => emit('cancel'),
          }, '取消'),
          h('button', {
            class: 'btn btn-primary btn-block',
            disabled: busy.value,
            onClick: save,
          }, busy.value
            ? [h('i', { class: 'fas fa-spinner spin' }), ' 保存中']
            : [h('i', { class: 'fas fa-save' }), isEdit ? ' 保存修改' : ' 保存菜品']),
        ]),
      ]);
    };
  },
};
