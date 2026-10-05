#!/usr/bin/env node
'use strict';
/**
 * 本地预览：用静态服务器模拟 GitHub Pages（只托管 public/，后端全部在 Supabase）
 * 用法：npm run preview        → http://127.0.0.1:5173/jiayan/
 *       HOST=0.0.0.0 npm run preview  允许同一局域网的手机访问
 * BASE 默认 /jiayan/，用来验证部署到 /<仓库名>/ 子路径时资源路径是否正确
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';
const BASE_NAME = String(process.env.BASE === undefined ? 'jiayan' : process.env.BASE).replace(/^\/+|\/+$/g, '');
const BASE = BASE_NAME ? `/${BASE_NAME}/` : '/';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (BASE !== '/' && (url.pathname === '/' || url.pathname === BASE.slice(0, -1))) {
    res.writeHead(302, { Location: BASE });
    res.end();
    return;
  }
  if (!url.pathname.startsWith(BASE)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  let rel;
  try {
    rel = decodeURIComponent(url.pathname.slice(BASE.length)) || 'index.html';
  } catch (_) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }
  const file = path.resolve(ROOT, rel);
  // 防目录穿越
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[preview] 静态预览 http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}${BASE}`);
});
