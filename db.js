/* =========================================================
   db.js —— 数据库初始化（SQLite，文件落在 warehouse.db）
   小白说明：这里只负责“建表”和“准备默认管理员”，
   真正的增删改查在 server.js 里。
   ========================================================= */
const Database = require('better-sqlite3');
const db = new Database('warehouse.db');
db.pragma('journal_mode = WAL');   // 写入性能更好，多人同时用更稳

// 建表（IF NOT EXISTS 保证只建一次）
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT,                 -- 物品编号
    warehouse   TEXT,                 -- 仓库（自由文字）
    name        TEXT,                 -- 名称 / 类别
    weight      TEXT,                 -- 重量（数值存成文字，简单）
    weight_unit TEXT,
    qty         REAL,                 -- 数量
    qty_unit    TEXT,
    time        TEXT,                 -- 入库时间，YYYY-MM-DD HH:MM
    images      TEXT,                 -- 照片，JSON 数组（base64）
    deleted     INTEGER DEFAULT 0,    -- 软删除标记：0 在库，1 在回收站
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS movements (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT,                 -- 'in' 入库 / 'out' 出库
    item_id     INTEGER,
    code        TEXT,
    name        TEXT,
    warehouse   TEXT,
    qty         REAL,
    qty_unit    TEXT,
    time        TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

module.exports = db;
