#!/usr/bin/env node
'use strict';
/**
 * 轻量代码检查：不引入额外依赖，覆盖三类问题
 * 1) 语法检查：后端 CommonJS 用 vm 编译，前端 ESM 用 --check 子进程
 * 2) 风格检查：制表符、行尾空格、超长行、调试语句残留
 * 3) 资源检查：前端引用的静态文件（/vendor /css /js）是否存在
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MAX_LINE = 160;
// 调试语句关键字（拼接构造，避免命中自身）
const DEBUG_STMT = new RegExp(`\\b${['debug', 'ger'].join('')}\\b`);
const errors = [];
const warnings = [];

function walk(dir, filter, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'data', 'vendor'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}

const rel = (f) => path.relative(ROOT, f);

/* ---------- 1. 语法检查 ---------- */

function checkBackendSyntax(file) {
  const src = fs.readFileSync(file, 'utf8');
  try {
    new vm.Script(src, { filename: file });
  } catch (err) {
    errors.push(`${rel(file)}: 语法错误 ${err.message}`);
  }
}

function checkEsmSyntax(file) {
  try {
    execFileSync(process.execPath, ['--input-type=module', '--check'], {
      input: fs.readFileSync(file, 'utf8'),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    const msg = (err.stderr || Buffer.from('')).toString().split('\n').slice(0, 4).join(' ').trim();
    errors.push(`${rel(file)}: ESM 语法错误 ${msg || err.message}`);
  }
}

/* ---------- 2. 风格检查 ---------- */

function checkStyle(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const no = i + 1;
    if (line.includes('\t')) errors.push(`${rel(file)}:${no}: 请用空格缩进，不要用制表符`);
    if (/\s+$/.test(line)) errors.push(`${rel(file)}:${no}: 行尾多余空格`);
    if (line.length > MAX_LINE) warnings.push(`${rel(file)}:${no}: 行长 ${line.length} 超过 ${MAX_LINE}`);
    if (DEBUG_STMT.test(line)) errors.push(`${rel(file)}:${no}: 残留调试语句`);
    // 启动入口 / 脚本 / 测试允许输出日志
    if (/console\.log\(/.test(line) && !/scripts[\\/]|test[\\/]|seed\.js|index\.js/.test(file)) {
      warnings.push(`${rel(file)}:${no}: 生产代码建议移除 console.log`);
    }
  });
  const last = lines[lines.length - 1];
  if (last !== '') errors.push(`${rel(file)}: 文件结尾缺少换行`);
}

/* ---------- 3. 静态资源引用检查 ---------- */

function checkAssets() {
  const files = walk(path.join(ROOT, 'public'), (f) => /\.(js|html|css)$/.test(f));
  // GitHub Pages 部署在 /<仓库名>/ 子路径下，站内资源必须用相对路径
  const absRe = /["'(](\/(?:vendor|css|js)\/[A-Za-z0-9._\-/]+)["')]/g;
  const relRe = /(?:src|href)=["']((?:\.\.?\/)?(?:vendor|css|js)\/[A-Za-z0-9._\-/]+)["']|from\s+['"](\.\.?\/[^'"]+)['"]/g;
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = absRe.exec(src)) !== null) {
      errors.push(`${rel(file)}: 站内资源请用相对路径（GitHub Pages 子路径下会 404）${m[1]}`);
    }
    while ((m = relRe.exec(src)) !== null) {
      const spec = m[1] || m[2];
      const target = path.resolve(path.dirname(file), spec);
      if (!fs.existsSync(target)) {
        errors.push(`${rel(file)}: 引用的静态资源不存在 ${spec}`);
      }
    }
  }
}

/* ---------- 4. 前端模块导入/导出一致性 ---------- */

/** 收集单个 ESM 文件的具名导出 */
function collectExports(src) {
  const names = new Set();
  // 覆盖 export const/let/var/function/class 以及 export async function / function*
  const re = /export\s+(?:async\s+)?(?:const|let|var|function\s*\*?|class)\s+([A-Za-z0-9_$]+)/g;
  let m;
  while ((m = re.exec(src)) !== null) names.add(m[1]);
  const braceRe = /export\s*\{([^}]+)\}/g;
  while ((m = braceRe.exec(src)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/** 校验 public/js 内部的具名导入都能在目标模块中找到 */
function checkEsmBindings() {
  const files = walk(path.join(ROOT, 'public', 'js'), (f) => f.endsWith('.js'));
  const exportsMap = new Map();
  for (const f of files) exportsMap.set(f, collectExports(fs.readFileSync(f, 'utf8')));

  const importRe = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = importRe.exec(src)) !== null) {
      const spec = m[2];
      if (/(^|\/)vendor\//.test(spec)) continue;  // 第三方库不解析
      const target = spec.startsWith('.')
        ? path.resolve(path.dirname(file), spec)
        : path.join(ROOT, 'public', spec.replace(/^\//, ''));
      if (!exportsMap.has(target)) {
        errors.push(`${rel(file)}: 导入的模块不存在 ${spec}`);
        continue;
      }
      const available = exportsMap.get(target);
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name && !available.has(name)) {
          errors.push(`${rel(file)}: ${spec} 未导出 ${name}`);
        }
      }
    }
  }
}

/* ---------- 执行 ---------- */

const serverFiles = walk(path.join(ROOT, 'server'), (f) => f.endsWith('.js'));
const scriptFiles = walk(path.join(ROOT, 'scripts'), (f) => f.endsWith('.js'));
const testFiles = fs.existsSync(path.join(ROOT, 'test'))
  ? walk(path.join(ROOT, 'test'), (f) => f.endsWith('.js'))
  : [];
const clientFiles = walk(path.join(ROOT, 'public', 'js'), (f) => f.endsWith('.js'));

for (const f of [...serverFiles, ...scriptFiles, ...testFiles]) {
  checkBackendSyntax(f);
  checkStyle(f);
}
for (const f of clientFiles) {
  checkEsmSyntax(f);
  checkStyle(f);
}
checkAssets();
checkEsmBindings();

const checked = serverFiles.length + scriptFiles.length + testFiles.length + clientFiles.length;
console.log(`[lint] 已检查 ${checked} 个文件`);
for (const w of warnings) console.log(`  warn  ${w}`);
for (const e of errors) console.log(`  error ${e}`);

if (errors.length) {
  console.log(`[lint] 失败：${errors.length} 个错误，${warnings.length} 个警告`);
  process.exit(1);
}
console.log(`[lint] 通过：0 个错误，${warnings.length} 个警告`);
