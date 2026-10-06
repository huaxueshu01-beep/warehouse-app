/* =========================================================
   server.js —— 后端主程序
   职责：
     1) 提供静态页面（public/index.html）
     2) 提供一套 REST 接口，前端用 fetch 调用
     3) 无需登录：所有人可直接使用（已按需求移除账号登录）
   小白说明：看不懂的地方跟着注释读即可，逻辑很直白。
   ========================================================= */
const express = require('express');
const db = require('./db');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '25mb' }));          // 照片是 base64，放宽体积上限
app.use(express.static(path.join(__dirname, 'public')));

// 数据库行 -> 前端对象（字段名转换 + images 解析）
function rowToItem(r) {
  return {
    id: r.id, code: r.code, warehouse: r.warehouse, name: r.name,
    weight: r.weight, weightUnit: r.weight_unit, qty: r.qty, qtyUnit: r.qty_unit,
    time: r.time, images: r.images ? JSON.parse(r.images) : [], deleted: !!r.deleted
  };
}

// 本地时间字符串 YYYY-MM-DD HH:MM（和前端保持一致）
function nowLocal() {
  const d = new Date();
  d.setSeconds(0); d.setMilliseconds(0);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

/* ---------------- 读取全部数据（前端一次性拉取） ---------------- */
app.get('/api/state',  (req, res) => {
  const items = db.prepare('SELECT * FROM items').all().map(rowToItem);
  const movements = db.prepare('SELECT * FROM movements').all().map(m => ({
    id: m.id, type: m.type, itemId: m.item_id, code: m.code, name: m.name,
    warehouse: m.warehouse, qty: m.qty, qtyUnit: m.qty_unit, time: m.time
  }));
  res.json({ items, movements });
});

/* ---------------- 新增物品（同时记一笔入库） ---------------- */
app.post('/api/items',  (req, res) => {
  const d = req.body || {};
  if (!d.code || !d.warehouse) return res.status(400).json({ error: '编码和仓库必填' });
  const info = db.prepare(
    `INSERT INTO items (code,warehouse,name,weight,weight_unit,qty,qty_unit,time,images)
     VALUES (?,?,?,?,?,?,?,?,?)`).run(
      d.code, d.warehouse, d.name || '', d.weight || '', d.weightUnit || '',
      +(d.qty || 0), d.qtyUnit || '', d.time || '', JSON.stringify(d.images || []));
  const id = info.lastInsertRowid;
  db.prepare(
    `INSERT INTO movements (type,item_id,code,name,warehouse,qty,qty_unit,time)
     VALUES ('in',?,?,?,?,?,?,?)`).run(
      id, d.code, d.name || '', d.warehouse, +(d.qty || 0), d.qtyUnit || '', d.time || '');
  res.json({ ok: true, id });
});

/* ---------------- 编辑物品 ---------------- */
app.put('/api/items/:id',  (req, res) => {
  const d = req.body || {};
  db.prepare(
    `UPDATE items SET code=?,warehouse=?,name=?,weight=?,weight_unit=?,qty=?,qty_unit=?,time=?,images=?,updated_at=datetime('now')
     WHERE id=?`).run(
      d.code, d.warehouse, d.name || '', d.weight || '', d.weightUnit || '',
      +(d.qty || 0), d.qtyUnit || '', d.time || '', JSON.stringify(d.images || []), req.params.id);
  res.json({ ok: true });
});

/* ---------------- 取出（减库存 + 记一笔出库，取空自动进回收站） ---------------- */
app.post('/api/items/:id/takeout',  (req, res) => {
  const take = +(req.body && req.body.qty || 0);
  if (take <= 0) return res.status(400).json({ error: '取出数量须大于 0' });
  const it = db.prepare('SELECT * FROM items WHERE id=?').get(req.params.id);
  if (!it) return res.status(404).json({ error: '物品不存在' });
  const cur = +(it.qty || 0);
  const realTake = Math.min(take, cur);
  const left = cur - realTake;
  db.prepare('UPDATE items SET qty=?, deleted=?, updated_at=datetime(\'now\') WHERE id=?')
    .run(left, left === 0 ? 1 : 0, it.id);
  db.prepare(
    `INSERT INTO movements (type,item_id,code,name,warehouse,qty,qty_unit,time)
     VALUES ('out',?,?,?,?,?,?,?)`).run(
      it.id, it.code, it.name, it.warehouse, realTake, it.qty_unit, nowLocal());
  res.json({ ok: true });
});

/* ---------------- 软删除 / 恢复 ---------------- */
app.delete('/api/items/:id',  (req, res) => {
  db.prepare('UPDATE items SET deleted=1, updated_at=datetime(\'now\') WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
app.post('/api/items/:id/restore',  (req, res) => {
  db.prepare('UPDATE items SET deleted=0, updated_at=datetime(\'now\') WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------------- 备份：导出 / 导入 ---------------- */
app.get('/api/export',  (req, res) => {
  const items = db.prepare('SELECT * FROM items').all().map(rowToItem);
  const movements = db.prepare('SELECT * FROM movements').all();
  res.json({ items, movements, exportedAt: new Date().toISOString() });
});
app.post('/api/import',  (req, res) => {
  const { items = [], movements = [] } = req.body || {};
  const insItem = db.prepare(
    `INSERT OR REPLACE INTO items (id,code,warehouse,name,weight,weight_unit,qty,qty_unit,time,images,deleted)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insMov = db.prepare(
    `INSERT OR REPLACE INTO movements (id,type,item_id,code,name,warehouse,qty,qty_unit,time)
     VALUES (?,?,?,?,?,?,?,?,?)`);
  const tx = db.transaction(() => {
    items.forEach(it => insItem.run(it.id, it.code, it.warehouse, it.name, it.weight,
      it.weightUnit, it.qty, it.qtyUnit, it.time, JSON.stringify(it.images || []), it.deleted ? 1 : 0));
    movements.forEach(m => insMov.run(m.id, m.type, m.itemId, m.code, m.name, m.warehouse, m.qty, m.qtyUnit, m.time));
  });
  tx();
  res.json({ ok: true, items: items.length, movements: movements.length });
});

/* ---------------- 自动备份设置 + 定时器 ---------------- */
app.post('/api/auto-backup',  (req, res) => {
  const { freq } = req.body || {};
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('auto_backup',?)").run(freq || 'off');
  res.json({ ok: true });
});
app.get('/api/auto-backup',  (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key='auto_backup'").get();
  res.json({ freq: row ? row.value : 'off' });
});

const BACKUP_DIR = path.join(__dirname, 'backups');
fs.mkdirSync(BACKUP_DIR, { recursive: true });
function doBackup() {
  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  fs.copyFileSync(path.join(__dirname, 'warehouse.db'), path.join(BACKUP_DIR, 'warehouse-' + ts + '.db'));
}
function checkAutoBackup() {
  const row = db.prepare("SELECT value FROM settings WHERE key='auto_backup'").get();
  const freq = row ? row.value : 'off';
  if (freq === 'off') return;
  const lastRow = db.prepare("SELECT value FROM settings WHERE key='last_backup_ts'").get();
  const lastTs = lastRow ? +lastRow.value : 0;
  const now = Date.now();
  const interval = freq === 'daily' ? 24 * 3600 * 1000 : 7 * 24 * 3600 * 1000;
  if (now - lastTs < interval) return;       // 还没到下一次备份时间
  doBackup();
  db.prepare("INSERT OR REPLACE INTO settings VALUES ('last_backup_ts',?)").run(String(now));
}
setInterval(checkAutoBackup, 60 * 60 * 1000);  // 每小时检查一次
checkAutoBackup();

/* ---------------- 启动 ---------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('仓库系统已启动： http://localhost:' + PORT));
