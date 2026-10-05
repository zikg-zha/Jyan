'use strict';
/** 数据库连接与初始化 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.JIAYAN_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const DB_FILE = process.env.JIAYAN_DB_FILE || path.join(DATA_DIR, 'jiayan.db');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/** 执行 schema.sql 完成结构迁移（幂等） */
function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(sql);
  return true;
}

module.exports = { db, migrate, DATA_DIR, DB_FILE, UPLOAD_DIR };
