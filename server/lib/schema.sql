-- 家宴 · 家庭点菜协作平台 数据模型
-- 数据以「家庭」为维度隔离（PRD 6.3）

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 家庭
CREATE TABLE IF NOT EXISTS families (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  invite_code TEXT    NOT NULL UNIQUE,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 家庭成员（F-007，2-10 人）
CREATE TABLE IF NOT EXISTS members (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  avatar_text TEXT    NOT NULL,
  password    TEXT    NOT NULL,
  role        TEXT    NOT NULL DEFAULT 'member',  -- admin | member
  taboos      TEXT    NOT NULL DEFAULT '[]',      -- JSON 数组：忌口食材
  specialties TEXT    NOT NULL DEFAULT '[]',      -- JSON 数组：擅长菜品
  preference  TEXT    NOT NULL DEFAULT '',        -- 点菜偏好
  last_seen   TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (family_id, name)
);

-- 菜品库（F-001）
CREATE TABLE IF NOT EXISTS dishes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  category    TEXT    NOT NULL,                   -- 荤菜|素菜|汤|主食|凉菜
  difficulty  TEXT    NOT NULL DEFAULT '简单',    -- 简单|中等|困难
  duration    INTEGER NOT NULL DEFAULT 30,        -- 分钟
  servings    INTEGER NOT NULL DEFAULT 2,         -- 基准份数
  cover_url   TEXT    NOT NULL DEFAULT '',
  icon        TEXT    NOT NULL DEFAULT 'fa-utensils',
  ingredients TEXT    NOT NULL DEFAULT '[]',      -- JSON: [{name,amount,unit}]
  steps       TEXT    NOT NULL DEFAULT '[]',      -- JSON: [{title,desc,photo}] 至少 3 步
  order_count INTEGER NOT NULL DEFAULT 0,         -- 被点次数
  created_by  INTEGER REFERENCES members(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (family_id, name)                        -- 菜品名家庭内唯一
);

-- 订单（F-002 / F-003 / F-004）
CREATE TABLE IF NOT EXISTS orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id     INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  creator_id    INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  taker_id      INTEGER REFERENCES members(id) ON DELETE SET NULL,
  status        TEXT    NOT NULL DEFAULT '待接单',
  meal_time     TEXT    NOT NULL,                 -- 今天晚饭 / 明天午饭 …
  meal_date     TEXT    NOT NULL,                 -- YYYY-MM-DD 用于今日筛选
  people        INTEGER NOT NULL DEFAULT 2,
  eat_for       TEXT    NOT NULL DEFAULT '',      -- 为谁点（忌口提醒用）
  note          TEXT    NOT NULL DEFAULT '',
  version       INTEGER NOT NULL DEFAULT 1,       -- 乐观锁，防异地并发冲突 R-001
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  completed_at  TEXT
);

-- 订单菜品明细
CREATE TABLE IF NOT EXISTS order_dishes (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  dish_id  INTEGER REFERENCES dishes(id) ON DELETE SET NULL,
  name     TEXT    NOT NULL,
  icon     TEXT    NOT NULL DEFAULT 'fa-utensils'
);

-- 订单协作人（一单多人 F-003）
CREATE TABLE IF NOT EXISTS order_collaborators (
  order_id  INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  joined_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (order_id, member_id)
);

-- 进度轨迹（F-004，含过程照片）
CREATE TABLE IF NOT EXISTS order_progress (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status     TEXT    NOT NULL,
  member_id  INTEGER REFERENCES members(id) ON DELETE SET NULL,
  photo_url  TEXT    NOT NULL DEFAULT '',
  remark     TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 站内消息（F-005）
CREATE TABLE IF NOT EXISTS notifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id    INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  member_id    INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  order_id     INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  type         TEXT    NOT NULL,                  -- new_order|taken|status|done|assigned|cancel
  title        TEXT    NOT NULL,
  body         TEXT    NOT NULL DEFAULT '',
  icon         TEXT    NOT NULL DEFAULT 'fa-bell',
  icon_color   TEXT    NOT NULL DEFAULT '#FA6400',
  is_read      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 索引：支撑「今日进行中」筛选 ≤500ms（PRD 6.1）
CREATE INDEX IF NOT EXISTS idx_orders_family_status ON orders(family_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_family_date   ON orders(family_id, meal_date);
CREATE INDEX IF NOT EXISTS idx_orders_creator       ON orders(family_id, creator_id);
CREATE INDEX IF NOT EXISTS idx_orders_taker         ON orders(family_id, taker_id);
CREATE INDEX IF NOT EXISTS idx_orders_created       ON orders(family_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dishes_family_cat    ON dishes(family_id, category);
CREATE INDEX IF NOT EXISTS idx_dishes_family_name   ON dishes(family_id, name);
CREATE INDEX IF NOT EXISTS idx_order_dishes_order   ON order_dishes(order_id);
CREATE INDEX IF NOT EXISTS idx_progress_order       ON order_progress(order_id, id);
CREATE INDEX IF NOT EXISTS idx_notif_member         ON notifications(member_id, is_read, id DESC);
