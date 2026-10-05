'use strict';
/** Express 应用装配（与 HTTP 监听解耦，便于测试） */
const express = require('express');
const path = require('path');
const { migrate, UPLOAD_DIR } = require('./lib/db');
const { CATEGORIES, DIFFICULTIES, FLOW, ALL_STATUS, STATUS } = require('./lib/domain');
const { fail } = require('./lib/helpers');

function createApp() {
  migrate();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false }));

  // 静态资源
  const PUBLIC_DIR = path.join(__dirname, '..', 'public');
  app.use(express.static(PUBLIC_DIR, { maxAge: '5m', index: false }));
  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

  // 健康检查
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      data: {
        status: 'healthy',
        service: '家宴 · 家庭点菜协作平台',
        time: new Date().toISOString(),
        uptime_s: Math.round(process.uptime()),
      },
    });
  });

  // 前端枚举字典
  app.get('/api/meta', (_req, res) => {
    res.json({
      ok: true,
      data: {
        categories: CATEGORIES,
        difficulties: DIFFICULTIES,
        flow: FLOW,
        statuses: ALL_STATUS,
        segments: ['进行中', '已完成', '已取消'],
        meal_times: ['今天午饭', '今天晚饭', '明天午饭', '明天晚饭', '周末午饭', '周末晚饭'],
        pending: STATUS.PENDING,
      },
    });
  });

  // 业务路由
  app.use('/api', require('./routes/members'));
  app.use('/api', require('./routes/dishes').router);
  app.use('/api', require('./routes/orders').router);
  app.use('/api', require('./routes/notifications'));
  app.use('/api', require('./routes/stats'));
  app.use('/api', require('./routes/uploads'));

  app.use('/api', (_req, res) => fail(res, 404, '接口不存在'));

  // SPA 入口
  app.get('*', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  // 统一错误处理
  app.use((err, _req, res, _next) => {
    console.error('[error]', err && err.message ? err.message : err);
    if (res.headersSent) return;
    const isConstraint = err && String(err.message || '').includes('UNIQUE constraint');
    res.status(isConstraint ? 400 : 500).json({
      ok: false,
      message: isConstraint ? '数据重复，请检查后重试' : '服务异常，请稍后重试',
    });
  });

  return app;
}

module.exports = { createApp };
