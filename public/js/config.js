/**
 * Supabase 连接配置（部署前填写）
 * 位置：Supabase 控制台 → Project Settings → API（或 Data API / API Keys）
 *   SUPABASE_URL      Project URL，形如 https://xxxx.supabase.co
 *   SUPABASE_ANON_KEY anon public key（或 sb_publishable_ 开头的 Publishable key）
 *
 * 这两个值本来就是公开给浏览器用的，可以提交到 GitHub；
 * 数据安全由数据库的 RLS 与函数权限保证（见 supabase/schema.sql）。
 * 切勿填 service_role / sb_secret_ 开头的密钥，它能绕过所有权限。
 */
export const SUPABASE_URL = 'https://pbkvgyblpvqlccodccpu.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_LqgDm9SwfF1ZWnzE_velEw_DsqdyTNk';
