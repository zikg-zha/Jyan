/** 数据访问层：Supabase RPC / Auth / Storage 封装，对组件保持原有接口 */
import { sb, configError } from './supabase.js';
import { META, IMAGE_TYPES, MAX_IMAGE_BYTES, resolveMealDate, toDateStr } from './domain.js';

const INVITE_KEY = 'jiayan.invite';

/** 记住上次登录用的家庭邀请码，方便下次免输入 */
export const session = {
  getInvite() {
    try {
      return localStorage.getItem(INVITE_KEY) || '';
    } catch (_) {
      return '';
    }
  },
  setInvite(code) {
    try {
      localStorage.setItem(INVITE_KEY, String(code || ''));
    } catch (_) { /* 隐私模式等场景忽略 */ }
  },
};

/** 业务错误，携带服务端返回的 data（如 409 冲突时的最新订单） */
export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/** 把 PostgREST 错误还原成 { message, status, data }；业务错误的状态码写在 hint（jiayan:409） */
function toApiError(err) {
  const m = /^jiayan:(\d{3})$/.exec((err && err.hint) || '');
  if (m) {
    let data = null;
    if (err.details) {
      try {
        data = JSON.parse(err.details);
      } catch (_) { /* 非 JSON 附加信息 */ }
    }
    return new ApiError(err.message, Number(m[1]), data);
  }
  const code = (err && err.code) || '';
  const text = String((err && err.message) || '');
  if (code === '23505') return new ApiError('数据重复，请检查后重试', 400, null);
  if (code === 'PGRST202' || code === '42883') {
    return new ApiError('数据库尚未初始化，请在 Supabase 执行 supabase/schema.sql', 500, null);
  }
  if (code === '42501') return new ApiError('没有权限，请重新登录', 401, null);
  if (/fetch|network|Failed to fetch|NetworkError|Load failed/i.test(text)) {
    return new ApiError('网络异常，请检查连接后重试', 0, null);
  }
  return new ApiError('服务异常，请稍后重试', 500, null);
}

function client() {
  if (!sb) throw new ApiError(configError || '尚未配置 Supabase', 0, null);
  return sb;
}

async function rpc(fn, args) {
  let res;
  try {
    res = await client().rpc(fn, args || {});
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError('网络异常，请检查连接后重试', 0, null);
  }
  if (res.error) throw toApiError(res.error);
  return res.data;
}

/** 每台设备一个匿名用户；登录时才创建 */
async function ensureAuth() {
  const { data } = await client().auth.getSession();
  if (data && data.session) return data.session;
  let res;
  try {
    res = await client().auth.signInAnonymously();
  } catch (_) {
    throw new ApiError('网络异常，请检查连接后重试', 0, null);
  }
  const err = res.error;
  if (!err) return res.data.session;
  if (err.code === 'anonymous_provider_disabled' || /anonymous sign-ins are disabled/i.test(err.message || '')) {
    throw new ApiError('服务端未开启匿名登录：请在 Supabase → Authentication → Sign In / Providers 打开 Anonymous sign-ins',
      0, null);
  }
  if (err.status === 404) {
    throw new ApiError('SUPABASE_URL 填写有误：应为项目根地址，形如 https://xxxx.supabase.co', 0, null);
  }
  if (err.status === 401 || err.status === 403) {
    throw new ApiError('SUPABASE_ANON_KEY 无效：请重新复制 anon / publishable key', 0, null);
  }
  if (err.status === 429) throw new ApiError('登录太频繁，请稍后再试', 429, null);
  if (!err.status) throw new ApiError('网络异常，请检查连接后重试', 0, null);
  throw new ApiError(`登录服务异常（${err.status}）：${err.message || '请稍后重试'}`, err.status, null);
}

let familyId = 0;  // 上传图片时作为存储目录

function remember(payload) {
  if (payload && payload.family) familyId = payload.family.id;
  return payload;
}

function randomName(ext) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}.${ext}`;
}

export const api = {
  meta: async () => META,

  async login(inviteCode, name, password) {
    await ensureAuth();
    const res = await rpc('login', { p_invite_code: inviteCode, p_name: name, p_password: password });
    if (!res || !res.ok) throw new ApiError((res && res.message) || '登录失败', 401, null);
    return remember(res.data);
  },
  /** 当前设备已绑定的成员；未登录返回 null */
  async me() {
    const { data } = await client().auth.getSession();
    if (!data || !data.session) return null;
    return remember(await rpc('me'));
  },
  async logout() {
    familyId = 0;
    if (sb) await rpc('logout').catch(() => {});
  },
  changePassword: (oldPassword, newPassword) =>
    rpc('change_password', { p_old: oldPassword, p_new: newPassword }),

  members: () => rpc('list_members'),
  addMember: (p) => rpc('add_member', {
    p_name: p.name, p_password: p.password,
    p_taboos: p.taboos || [], p_specialties: p.specialties || [], p_preference: p.preference || '',
  }),
  updateMember: (id, p) => rpc('update_member', {
    p_id: id,
    p_taboos: Array.isArray(p.taboos) ? p.taboos : null,
    p_specialties: Array.isArray(p.specialties) ? p.specialties : null,
    p_preference: p.preference === undefined ? null : String(p.preference),
  }),

  dishes: (params = {}) => rpc('list_dishes', {
    p_category: params.category || '全部', p_keyword: params.keyword || '',
  }),
  dish: (id) => rpc('get_dish', { p_id: id }),
  createDish: (payload) => rpc('create_dish', { p_payload: payload }),
  updateDish: (id, payload) => rpc('update_dish', { p_id: id, p_payload: payload }),
  deleteDish: (id) => rpc('delete_dish', { p_id: id }),
  tabooCheck: (dishIds, memberIds) =>
    rpc('taboo_check', { p_dish_ids: dishIds, p_member_ids: memberIds }),

  orders: (params = {}) => rpc('list_orders', {
    p_segment: params.segment || '进行中',
    p_scope: params.scope || '今日',
    p_relation: params.relation || '全部',
    p_creator_id: params.creator_id || null,
    p_taker_id: params.taker_id || null,
    p_date: params.date || null,
    p_today: toDateStr(new Date()),
  }),
  order: (id) => rpc('get_order', { p_id: id }),
  createOrder: (p) => rpc('create_order', {
    p_dish_ids: p.dish_ids,
    p_meal_time: p.meal_time,
    p_meal_date: resolveMealDate(p.meal_time),
    p_people: p.people,
    p_note: p.note || '',
    p_eat_for: p.eat_for || '',
    p_assignee_id: p.assignee_id || null,
  }),
  takeOrder: (id) => rpc('take_order', { p_id: id }),
  assignOrder: (id, memberId) => rpc('assign_order', { p_id: id, p_member_id: memberId }),
  collaborate: (id) => rpc('collaborate', { p_id: id }),
  updateStatus: (id, p) => rpc('update_status', {
    p_id: id, p_status: p.status, p_photo_url: p.photo_url || '', p_remark: p.remark || '',
    p_version: p.version || null,
  }),
  cancelOrder: (id, reason) => rpc('cancel_order', { p_id: id, p_reason: reason || '' }),

  notifications: (limit) => rpc('list_notifications', { p_limit: limit || 50 }),
  unreadCount: () => rpc('unread_count'),
  readNotification: (id) => rpc('read_notification', { p_id: id }),
  readAll: () => rpc('read_all_notifications'),

  stats: () => rpc('family_stats'),

  /** 图片上传到 Storage：<家庭 id>/<随机名>，返回公开地址 */
  async upload(file) {
    const ext = IMAGE_TYPES[file && file.type];
    if (!ext) throw new ApiError('仅支持 JPG / PNG / WebP / GIF 图片', 400, null);
    if (file.size > MAX_IMAGE_BYTES) throw new ApiError('图片过大，请压缩后上传', 400, null);
    if (!familyId) throw new ApiError('请先登录', 401, null);
    const path = `${familyId}/${randomName(ext)}`;
    const bucket = client().storage.from('jiayan');
    let res;
    try {
      res = await bucket.upload(path, file, { contentType: file.type, cacheControl: '604800', upsert: false });
    } catch (_) {
      throw new ApiError('网络异常，请检查连接后重试', 0, null);
    }
    if (res.error) throw new ApiError('图片上传失败，请重试', 400, null);
    return { url: bucket.getPublicUrl(path).data.publicUrl, size: file.size };
  },
};
