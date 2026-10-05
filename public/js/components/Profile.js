/** 我的：成员资料 + 贡献榜 + 成员管理（F-007 F-009） */
import { h, ref, onMounted } from '../../vendor/vue.esm-browser.prod.js';
import { api } from '../api.js';
import { state, toast, refreshMembers, isOnline, logout } from '../store.js';
import { Sheet, Empty } from './common.js';

export const Profile = {
  setup() {
    const stats = ref(null);
    const loading = ref(true);
    const editing = ref(false);
    const inviting = ref(false);
    const changingPwd = ref(false);

    // 资料编辑表单
    const taboosText = ref('');
    const specialtiesText = ref('');
    const preference = ref('');
    // 邀请表单
    const newName = ref('');
    const newPassword = ref('');
    // 修改密码表单
    const oldPwd = ref('');
    const newPwd = ref('');

    async function load() {
      try {
        stats.value = await api.stats();
      } catch (err) {
        toast(err.message);
      } finally {
        loading.value = false;
      }
      refreshMembers();
    }
    onMounted(load);

    function openEdit() {
      taboosText.value = (state.member.taboos || []).join('、');
      specialtiesText.value = (state.member.specialties || []).join('、');
      preference.value = state.member.preference || '';
      editing.value = true;
    }

    function splitList(text) {
      return String(text || '')
        .split(/[、,，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }

    async function saveProfile() {
      try {
        const updated = await api.updateMember(state.member.id, {
          taboos: splitList(taboosText.value),
          specialties: splitList(specialtiesText.value),
          preference: preference.value.trim(),
        });
        state.member = updated;
        editing.value = false;
        toast('资料已更新');
        refreshMembers();
      } catch (err) {
        toast(err.message);
      }
    }

    async function invite() {
      if (!newName.value.trim()) {
        toast('请填写家人称呼');
        return;
      }
      if (newPassword.value.length < 6) {
        toast('初始密码至少 6 位');
        return;
      }
      try {
        await api.addMember({ name: newName.value.trim(), password: newPassword.value });
        toast(`已邀请 ${newName.value.trim()} 加入家庭`);
        newName.value = '';
        newPassword.value = '';
        inviting.value = false;
        refreshMembers();
        load();
      } catch (err) {
        toast(err.message);
      }
    }

    async function changePassword() {
      if (!oldPwd.value || newPwd.value.length < 6) {
        toast('请填写原密码，新密码至少 6 位');
        return;
      }
      try {
        await api.changePassword(oldPwd.value, newPwd.value);
        oldPwd.value = '';
        newPwd.value = '';
        changingPwd.value = false;
        toast('密码已修改，其他设备需要重新登录');
      } catch (err) {
        toast(err.message);
      }
    }

    function rankClass(i) {
      return i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
    }

    return () => {
      const me = state.member;
      const s = stats.value;
      const topDish = s && s.popular.length ? s.popular[0] : null;
      const myCook = s && s.contributors.find((c) => c.id === me.id);

      return h('div', null, [
        h('div', { class: 'section' }, [
          h('div', { class: 'card', style: 'padding:16px' }, [
            h('div', { class: 'row gap12' }, [
              h('span', { class: `avatar lg ${isOnline(me.id) ? 'online' : ''}` }, me.avatar_text),
              h('div', { class: 'grow' }, [
                h('div', { class: 'bold fs-lg' }, me.name),
                h('div', { class: 'fs-sm muted' },
                  (me.specialties || []).length ? `擅长：${me.specialties.join('、')}` : '还没登记擅长菜品'),
                (me.taboos || []).length
                  ? h('div', { class: 'fs-sm', style: 'color:var(--color-warning)' },
                    `忌口：${me.taboos.join('、')}`)
                  : null,
                me.preference
                  ? h('div', { class: 'fs-sm muted' }, `偏好：${me.preference}`)
                  : null,
              ]),
              h('button', { class: 'btn btn-ghost btn-sm', onClick: openEdit }, '编辑'),
            ]),
            h('div', { class: 'row between mt12' }, [
              h('span', { class: 'fs-sm muted' },
                `${state.family ? state.family.name : ''} · 邀请码 ${state.family ? state.family.invite_code : ''}`),
              h('div', { class: 'row gap8' }, [
                h('button', {
                  class: 'btn btn-line btn-sm',
                  onClick: () => { changingPwd.value = true; },
                }, '改密码'),
                h('button', { class: 'btn btn-line btn-sm', onClick: () => logout() }, '退出'),
              ]),
            ]),
          ]),
        ]),

        loading.value
          ? h('div', { class: 'loading' }, [h('i', { class: 'fas fa-spinner spin' })])
          : s
            ? h('div', null, [
              h('div', { class: 'stat-grid', style: 'padding-top:0' }, [
                h('div', { class: 'stat-box' }, [
                  h('div', { class: 'num' }, String(myCook ? myCook.cook_count : 0)),
                  h('div', { class: 'fs-sm muted' }, '我的做饭次数'),
                ]),
                h('div', { class: 'stat-box' }, [
                  h('div', { class: 'num' }, String(topDish ? topDish.order_count : 0)),
                  h('div', { class: 'fs-sm muted' },
                    topDish ? `最热菜·${topDish.name}` : '暂无热门菜'),
                ]),
                h('div', { class: 'stat-box' }, [
                  h('div', { class: 'num' }, String(s.summary.done_orders)),
                  h('div', { class: 'fs-sm muted' }, `已完成订单 · 闭环率 ${s.summary.close_rate}%`),
                ]),
                h('div', { class: 'stat-box' }, [
                  h('div', { class: 'num' }, String(s.summary.dish_total)),
                  h('div', { class: 'fs-sm muted' }, '菜品库沉淀'),
                ]),
              ]),

              h('div', { class: 'section', style: 'padding-top:0' }, [
                h('div', { class: 'card' }, [
                  h('div', { class: 'section', style: 'padding:14px 16px 4px' }, [
                    h('div', { class: 'semi' }, [
                      h('i', { class: 'fas fa-trophy', style: 'color:#FAAD14' }),
                      ' 做饭贡献榜',
                    ]),
                  ]),
                  s.contributors.filter((c) => c.cook_count > 0).length
                    ? h('div', null, s.contributors
                      .filter((c) => c.cook_count > 0)
                      .map((c, i) => h('div', { class: 'rank-item', key: c.id }, [
                        h('span', { class: `rank-no ${rankClass(i)}` }, String(i + 1)),
                        h('span', { class: `avatar ${isOnline(c.id) ? 'online' : ''}` }, c.avatar_text),
                        h('div', { class: 'grow' }, [
                          h('div', { class: 'semi' }, c.name),
                          h('div', {
                            class: 'bar',
                            style: `width:${c.percent}%`,
                          }),
                        ]),
                        h('span', { class: 'semi' }, String(c.cook_count)),
                      ])))
                    : h(Empty, { icon: 'fa-trophy', text: '还没有做饭记录' }),
                ]),
              ]),

              h('div', { class: 'section', style: 'padding-top:0' }, [
                h('div', { class: 'card' }, [
                  h('div', { class: 'section', style: 'padding:14px 16px 4px' }, [
                    h('div', { class: 'semi' }, [
                      h('i', { class: 'fas fa-fire', style: 'color:var(--color-primary)' }),
                      ' 最受欢迎菜品',
                    ]),
                  ]),
                  s.popular.length
                    ? h('div', null, s.popular.slice(0, 6).map((d, i) => h('div', {
                      class: 'rank-item', key: d.id,
                    }, [
                      h('span', { class: `rank-no ${rankClass(i)}` }, String(i + 1)),
                      h('span', { class: `tag tag-${d.category}` }, d.category),
                      h('div', { class: 'grow semi' }, d.name),
                      h('span', { class: 'fs-sm muted' }, `被点 ${d.order_count} 次`),
                    ])))
                    : h(Empty, { icon: 'fa-fire', text: '还没有点菜记录' }),
                ]),
              ]),

              s.pairs.length
                ? h('div', { class: 'section', style: 'padding-top:0' }, [
                  h('div', { class: 'card' }, [
                    h('div', { class: 'section', style: 'padding:14px 16px 4px' }, [
                      h('div', { class: 'semi' }, [
                        h('i', { class: 'fas fa-heart', style: 'color:var(--color-error)' }),
                        ' 谁给谁做过菜',
                      ]),
                    ]),
                    ...s.pairs.slice(0, 8).map((p, i) => h('div', {
                      class: 'rank-item', key: i,
                    }, [
                      h('div', { class: 'grow' }, [
                        h('div', { class: 'semi fs-sm' },
                          `${p.taker_name} → ${p.creator_name}`),
                        h('div', { class: 'fs-sm muted ellipsis' }, p.dishes || ''),
                      ]),
                      h('span', { class: 'fs-sm semi' }, `${p.times} 次`),
                    ])),
                  ]),
                ])
                : null,

              h('div', { class: 'section', style: 'padding-top:0' }, [
                h('div', { class: 'card' }, [
                  h('div', { class: 'section', style: 'padding:14px 16px 4px' }, [
                    h('div', { class: 'row between' }, [
                      h('div', { class: 'semi' }, [
                        h('i', { class: 'fas fa-users', style: 'color:var(--color-primary)' }),
                        ` 家庭成员 (${state.members.length}/10)`,
                      ]),
                      h('button', {
                        class: 'btn btn-ghost btn-sm',
                        onClick: () => { inviting.value = true; },
                      }, [h('i', { class: 'fas fa-user-plus' }), ' 邀请']),
                    ]),
                  ]),
                  ...state.members.map((m) => h('div', { class: 'member-item', key: m.id }, [
                    h('span', { class: `avatar ${isOnline(m.id) ? 'online' : ''}` }, m.avatar_text),
                    h('div', { class: 'grow' }, [
                      h('div', { class: 'semi' }, [
                        m.name,
                        h('span', {
                          class: 'fs-sm',
                          style: isOnline(m.id)
                            ? 'color:var(--color-success)'
                            : 'color:var(--color-text-tertiary)',
                        }, isOnline(m.id) ? ' · 在线' : ' · 离线'),
                      ]),
                      h('div', { class: 'fs-sm muted' }, [
                        (m.specialties || []).length ? `擅长 ${m.specialties.join('、')}` : '无擅长记录',
                        ' · ',
                        (m.taboos || []).length ? `忌口 ${m.taboos.join('、')}` : '无忌口',
                      ]),
                    ]),
                  ])),
                ]),
              ]),
            ])
            : null,

        editing.value
          ? h(Sheet, { title: '编辑我的资料', onClose: () => { editing.value = false; } }, {
            default: () => [
              h('div', { class: 'field' }, [
                h('label', { for: 'p-taboo' }, '忌口食材（用、或空格分隔）'),
                h('input', {
                  id: 'p-taboo', class: 'input', placeholder: '如：海鲜、香菜',
                  value: taboosText.value,
                  onInput: (e) => { taboosText.value = e.target.value; },
                }),
              ]),
              h('div', { class: 'field' }, [
                h('label', { for: 'p-spec' }, '擅长菜品'),
                h('input', {
                  id: 'p-spec', class: 'input', placeholder: '如：红烧肉、酸菜鱼',
                  value: specialtiesText.value,
                  onInput: (e) => { specialtiesText.value = e.target.value; },
                }),
              ]),
              h('div', { class: 'field' }, [
                h('label', { for: 'p-pref' }, '点菜偏好'),
                h('input', {
                  id: 'p-pref', class: 'input', placeholder: '如：清淡为主',
                  value: preference.value,
                  onInput: (e) => { preference.value = e.target.value; },
                }),
              ]),
              h('button', { class: 'btn btn-primary btn-block', onClick: saveProfile }, '保存'),
            ],
          })
          : null,

        inviting.value
          ? h(Sheet, { title: '邀请家人加入', onClose: () => { inviting.value = false; } }, {
            default: () => [
              h('div', { class: 'fs-sm muted mb12' },
                `家庭邀请码：${state.family ? state.family.invite_code : '-'} · 家庭成员上限 10 人`),
              h('div', { class: 'field' }, [
                h('label', { for: 'i-name' }, '家人称呼'),
                h('input', {
                  id: 'i-name', class: 'input', placeholder: '如：姑姑',
                  value: newName.value,
                  onInput: (e) => { newName.value = e.target.value; },
                }),
              ]),
              h('div', { class: 'field' }, [
                h('label', { for: 'i-pwd' }, '初始密码'),
                h('input', {
                  id: 'i-pwd', class: 'input', value: newPassword.value, placeholder: '至少 6 位，告诉家人后可自行修改',
                  onInput: (e) => { newPassword.value = e.target.value; },
                }),
              ]),
              h('button', { class: 'btn btn-primary btn-block', onClick: invite }, '确认邀请'),
            ],
          })
          : null,

        changingPwd.value
          ? h(Sheet, { title: '修改密码', onClose: () => { changingPwd.value = false; } }, {
            default: () => [
              h('div', { class: 'field' }, [
                h('label', { for: 'c-old' }, '原密码'),
                h('input', {
                  id: 'c-old', class: 'input', type: 'password', autocomplete: 'current-password',
                  value: oldPwd.value,
                  onInput: (e) => { oldPwd.value = e.target.value; },
                }),
              ]),
              h('div', { class: 'field' }, [
                h('label', { for: 'c-new' }, '新密码（至少 6 位）'),
                h('input', {
                  id: 'c-new', class: 'input', type: 'password', autocomplete: 'new-password',
                  value: newPwd.value,
                  onInput: (e) => { newPwd.value = e.target.value; },
                }),
              ]),
              h('button', { class: 'btn btn-primary btn-block', onClick: changePassword }, '确认修改'),
            ],
          })
          : null,
      ]);
    };
  },
};
