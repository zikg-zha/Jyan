'use strict';
/** HTTP + WebSocket 服务入口 */
const http = require('http');
const os = require('os');
const { createApp } = require('./app');
const realtime = require('./lib/realtime');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = createApp();
const server = http.createServer(app);
realtime.attach(server);

function lanIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return '127.0.0.1';
}

server.listen(PORT, HOST, () => {
  console.log(`[家宴] 服务已启动  http://${lanIp()}:${PORT}/`);
  console.log(`[家宴] 健康检查    http://${lanIp()}:${PORT}/api/health`);
});

function shutdown(signal) {
  console.log(`[家宴] 收到 ${signal}，正在关闭…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { server, app };
