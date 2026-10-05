'use strict';
/** 把 public/js（可选 vendor）镜像到临时目录，并写入测试用 Supabase 配置，供 Node 以 ESM 导入 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'public');

const TEST_CONFIG = "export const SUPABASE_URL = 'https://demo.supabase.co';\n"
  + "export const SUPABASE_ANON_KEY = 'sb_publishable_test';\n";

function mirrorFrontend({ vendor = false, config = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jiayan-fe-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
  fs.cpSync(path.join(PUBLIC_DIR, 'js'), path.join(dir, 'js'), { recursive: true });
  if (vendor) {
    const src = path.join(PUBLIC_DIR, 'vendor');
    if (!fs.existsSync(path.join(src, 'vue.esm-browser.prod.js'))) {
      throw new Error('缺少 public/vendor，请先执行 npm run build');
    }
    fs.cpSync(src, path.join(dir, 'vendor'), { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'js', 'config.js'), config
    ? `export const SUPABASE_URL = ${JSON.stringify(config.url)};\n`
      + `export const SUPABASE_ANON_KEY = ${JSON.stringify(config.key)};\n`
    : TEST_CONFIG);
  return {
    dir,
    load: (rel) => import(pathToFileURL(path.join(dir, 'js', rel)).href),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

module.exports = { mirrorFrontend };
