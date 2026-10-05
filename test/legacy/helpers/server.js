'use strict';
/**
 * 集成测试脚手架：每个测试文件用独立临时数据目录，
 * 启动真实 HTTP 服务并注入演示数据，测试结束清理。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

function startServer(tag, { realtime: withRealtime = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `jiayan-test-${tag}-`));
  process.env.JIAYAN_DATA_DIR = dir;
  process.env.JIAYAN_DB_FILE = path.join(dir, 'test.db');

  // 必须在设置环境变量之后加载，db.js 在加载时解析路径
  const { createApp } = require('../../../server/app');
  const { seed } = require('../../../server/seed');
  const { db } = require('../../../server/lib/db');

  seed({ force: true });

  const server = http.createServer(createApp());
  // 前端渲染测试需要 WebSocket 通道，否则 store.js 会退化到 3 秒轮询
  if (withRealtime) require('../../../server/lib/realtime').attach(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      const members = db.prepare('SELECT id, name FROM members ORDER BY id').all();
      const byName = {};
      for (const m of members) byName[m.name] = m.id;

      resolve({
        base,
        db,
        members: byName,
        familyId: db.prepare('SELECT id FROM families LIMIT 1').get().id,
        async close() {
          await new Promise((r) => server.close(r));
          try {
            db.close();
          } catch (_) { /* 已关闭 */ }
          fs.rmSync(dir, { recursive: true, force: true });
        },
        /** 以某成员身份请求 */
        async call(method, apiPath, { memberId, body } = {}) {
          const headers = { Accept: 'application/json' };
          if (memberId) headers['x-member-id'] = String(memberId);
          const init = { method, headers };
          if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
          }
          const res = await fetch(`${base}/api${apiPath}`, init);
          let payload = null;
          try {
            payload = await res.json();
          } catch (_) { /* 非 JSON */ }
          return { status: res.status, body: payload, data: payload && payload.data };
        },
      });
    });
  });
}

module.exports = { startServer };
