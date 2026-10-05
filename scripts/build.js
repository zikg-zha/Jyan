#!/usr/bin/env node
'use strict';
/**
 * 构建：前端免打包（Vue ESM + 原生模块），构建步骤 = 同步静态依赖 + 产物自检
 * 1) 从 node_modules 同步 Vue / supabase-js / FontAwesome 到 public/vendor（不依赖外网 CDN）
 * 2) 校验入口文件、组件引用、样式令牌、Supabase 配置是否齐备
 * 产物目录 public/ 即 GitHub Pages 发布内容
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VENDOR = path.join(ROOT, 'public', 'vendor');
const problems = [];
const warnings = [];
const done = [];

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  done.push(`${path.relative(ROOT, to)} (${(fs.statSync(to).size / 1024).toFixed(0)} KB)`);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  let count = 0;
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory()) count += copyDir(src, dst);
    else {
      fs.copyFileSync(src, dst);
      count += 1;
    }
  }
  return count;
}

/* ---------- 1. 同步静态依赖 ---------- */

const VENDOR_FILES = [
  ['vue/dist/vue.esm-browser.prod.js', 'vue.esm-browser.prod.js'],
  ['@supabase/supabase-js/dist/umd/supabase.js', 'supabase.js'],
];

for (const [rel, out] of VENDOR_FILES) {
  const src = path.join(ROOT, 'node_modules', rel);
  if (!fs.existsSync(src)) {
    problems.push(`缺少依赖文件 node_modules/${rel}，请先执行 npm install`);
    continue;
  }
  copyFile(src, path.join(VENDOR, out));
}

// 旧版实时通道已换成 Supabase Realtime
fs.rmSync(path.join(VENDOR, 'socket.io.esm.min.js'), { force: true });

const FA_SRC = path.join(ROOT, 'node_modules', '@fortawesome', 'fontawesome-free');
if (fs.existsSync(FA_SRC)) {
  const cssSrc = path.join(FA_SRC, 'css', 'all.min.css');
  if (fs.existsSync(cssSrc)) copyFile(cssSrc, path.join(VENDOR, 'fontawesome', 'css', 'all.min.css'));
  const fontSrc = path.join(FA_SRC, 'webfonts');
  if (fs.existsSync(fontSrc)) {
    const n = copyDir(fontSrc, path.join(VENDOR, 'fontawesome', 'webfonts'));
    done.push(`public/vendor/fontawesome/webfonts (${n} 个字体文件)`);
  }
} else {
  problems.push('缺少 @fortawesome/fontawesome-free，请先执行 npm install');
}

/* ---------- 2. 产物自检 ---------- */

const REQUIRED = [
  'public/index.html',
  'public/css/app.css',
  'public/js/main.js',
  'public/js/api.js',
  'public/js/store.js',
  'public/js/config.js',
  'public/js/supabase.js',
  'public/vendor/vue.esm-browser.prod.js',
  'public/vendor/supabase.js',
  'public/vendor/fontawesome/css/all.min.css',
  'supabase/schema.sql',
  'supabase/seed.sql',
];
for (const rel of REQUIRED) {
  if (!fs.existsSync(path.join(ROOT, rel))) problems.push(`缺少必需产物 ${rel}`);
}

// 组件导入闭环检查
const COMPONENT_DIR = path.join(ROOT, 'public', 'js', 'components');
const components = fs.readdirSync(COMPONENT_DIR).filter((f) => f.endsWith('.js'));
const mainSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'main.js'), 'utf8');
for (const f of components) {
  if (f === 'common.js') continue;  // 由其他组件间接引用
  if (!mainSrc.includes(`components/${f}`)) {
    problems.push(`组件 ${f} 未被 main.js 引用`);
  }
}

// 设计令牌检查（与原型一致）
const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'app.css'), 'utf8');
for (const token of ['--color-primary: #FA6400', '--appbar-h', '--tabbar-h']) {
  if (!css.includes(token)) problems.push(`app.css 缺少设计令牌 ${token}`);
}
for (const st of ['待接单', '已接单', '采购中', '准备中', '烹饪中', '已完成', '已取消']) {
  if (!css.includes(`.st-${st}`)) problems.push(`app.css 缺少状态样式 .st-${st}`);
}

// Supabase 配置：空值只提醒；出现 service_role / secret key 直接失败，防止发布到公网
const configSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'config.js'), 'utf8');
const url = (/SUPABASE_URL\s*=\s*'([^']*)'/.exec(configSrc) || [])[1] || '';
const key = (/SUPABASE_ANON_KEY\s*=\s*'([^']*)'/.exec(configSrc) || [])[1] || '';
if (!url || !key) warnings.push('public/js/config.js 尚未填写 SUPABASE_URL / SUPABASE_ANON_KEY，页面会提示未配置');
if (/^sb_secret_/.test(key)) problems.push('public/js/config.js 填的是 sb_secret_ 密钥，禁止发布');
if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(key)) {
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    if (payload.role === 'service_role') problems.push('public/js/config.js 填的是 service_role 密钥，禁止发布');
  } catch (_) { /* 非 JWT */ }
}

/* ---------- 输出 ---------- */

console.log('[build] 静态依赖同步：');
for (const d of done) console.log(`  ✓ ${d}`);
for (const w of warnings) console.log(`  ! ${w}`);

if (problems.length) {
  console.log('[build] 失败：');
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}
console.log(`[build] 通过：${components.length} 个前端组件、${REQUIRED.length} 项必需产物齐备`);
