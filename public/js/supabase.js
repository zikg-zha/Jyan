/** Supabase 客户端（UMD 全局 window.supabase 由 index.html 引入） */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

/** 控制台里常复制到 .../rest/v1/，supabase-js 需要的是项目根地址，这里统一去掉 */
export const PROJECT_URL = String(SUPABASE_URL || '').trim()
  .replace(/\/+$/, '')
  .replace(/\/(rest|auth|storage|realtime)\/v1$/i, '');

/** 检测到 service_role / secret key 时拒绝启动，避免把万能密钥发布到公网 */
function isSecretKey(key) {
  if (/^sb_secret_/.test(key)) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role === 'service_role';
  } catch (_) {
    return false;
  }
}

function checkConfig() {
  if (!PROJECT_URL || !SUPABASE_ANON_KEY) {
    return '尚未配置 Supabase：请在 js/config.js 填写 SUPABASE_URL 和 SUPABASE_ANON_KEY';
  }
  if (!/^https:\/\/[^/]+$/.test(PROJECT_URL)) {
    return 'SUPABASE_URL 格式不正确，应形如 https://xxxx.supabase.co';
  }
  if (isSecretKey(SUPABASE_ANON_KEY)) {
    return 'js/config.js 里填的是 service_role / secret 密钥，请立即在 Supabase 控制台轮换该密钥，并改用 anon 公钥';
  }
  if (!globalThis.supabase || typeof globalThis.supabase.createClient !== 'function') {
    return 'Supabase 客户端脚本加载失败，请刷新重试';
  }
  return '';
}

export const configError = checkConfig();

export const sb = configError
  ? null
  : globalThis.supabase.createClient(PROJECT_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'jiayan.auth' },
  });
