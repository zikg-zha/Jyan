/** 登录页：家庭邀请码 + 成员名 + 密码 */
import { h, ref } from '../../vendor/vue.esm-browser.prod.js';
import { api, session } from '../api.js';
import { applyLogin, toast } from '../store.js';

export const Login = {
  setup() {
    const invite = ref(session.getInvite());
    const name = ref('');
    const password = ref('');
    const busy = ref(false);
    const quickNames = ['妈妈', '爸爸', '哥哥', '妹妹', '爷爷'];

    async function submit() {
      if (!invite.value.trim() || !name.value.trim() || !password.value) {
        toast('请填写家庭邀请码、成员名和密码');
        return;
      }
      busy.value = true;
      try {
        const data = await api.login(invite.value.trim(), name.value.trim(), password.value);
        session.setInvite(data.family.invite_code);
        applyLogin(data);
        toast(`欢迎回来，${data.member.name}`);
      } catch (err) {
        toast(err.message);
      } finally {
        busy.value = false;
      }
    }

    const onEnter = (e) => { if (e.key === 'Enter') submit(); };

    return () => h('div', { class: 'login-wrap' }, [
      h('div', { class: 'login-logo' }, [h('i', { class: 'fas fa-utensils' })]),
      h('div', { class: 'center mb16' }, [
        h('div', { class: 'bold', style: 'font-size:22px' }, '家宴'),
        h('div', { class: 'fs-sm muted' }, '一家人的点菜协作平台'),
      ]),
      h('div', { class: 'card section' }, [
        h('div', { class: 'field' }, [
          h('label', { for: 'login-invite' }, '家庭邀请码'),
          h('input', {
            id: 'login-invite',
            class: 'input',
            value: invite.value,
            placeholder: '向家人索取，如 A1B2C3D4',
            autocomplete: 'off',
            autocapitalize: 'characters',
            onInput: (e) => { invite.value = e.target.value; },
            onKeyup: onEnter,
          }),
        ]),
        h('div', { class: 'field' }, [
          h('label', { for: 'login-name' }, '成员名'),
          h('input', {
            id: 'login-name',
            class: 'input',
            value: name.value,
            placeholder: '如：妈妈',
            autocomplete: 'username',
            onInput: (e) => { name.value = e.target.value; },
            onKeyup: onEnter,
          }),
        ]),
        h('div', { class: 'field' }, [
          h('label', { for: 'login-pwd' }, '密码'),
          h('input', {
            id: 'login-pwd',
            class: 'input',
            type: 'password',
            value: password.value,
            placeholder: '请输入密码',
            autocomplete: 'current-password',
            onInput: (e) => { password.value = e.target.value; },
            onKeyup: onEnter,
          }),
        ]),
        h('button', {
          class: 'btn btn-primary btn-block',
          disabled: busy.value,
          onClick: submit,
        }, busy.value ? [h('i', { class: 'fas fa-spinner spin' }), ' 登录中'] : '进入家宴'),
        h('div', { class: 'field mt12' }, [
          h('label', null, '快速填写成员名'),
          h('div', { class: 'quick-login' }, quickNames.map((n) => h('button', {
            class: `opt ${name.value === n ? 'active' : ''}`,
            onClick: () => { name.value = n; },
          }, n))),
        ]),
      ]),
      h('div', { class: 'center fs-sm muted mt12' }, '邀请码可在家人的「我的」页面查看'),
    ]);
  },
};
