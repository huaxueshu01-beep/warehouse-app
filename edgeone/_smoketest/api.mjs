/* =========================================================
   EdgeOne Makers —— 后端主程序（Cloud Function）
   原 Node + SQLite 版本已改造为：Blob 存储（@edgeone/pages-blob）。
   EdgeOne 没有数据库，Blob 即数据库：
     - 每个物品 = items/<id>.json
     - 每笔出入库 = movements/<id>.json
     - 设置 = settings.json（单文档，数据量小）
   无需登录：所有人可直接使用。
   路由：此文件是 /api/* 的 catch-all（[[default]].js）。
   ========================================================= */

import express from 'express';
import { getStore } from '@edgeone/pages-blob';

const app = express();
// 照片是 base64，放宽体积上限（平台硬上限 6MB，这里留一点余量）
app.use(express.json({ limit: '5mb' }));

/* ---------- Blob 存储（强一致性，IRON RULE） ---------- */
const store = getStore({ name: 'warehouse', consistency: 'strong' });

/* 列出某前缀下所有 JSON 对象 */
async function listAll(prefix) {
  const { blobs } = await store.list({ prefix });
  const objs = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
  return objs.filter(Boolean);
}

/* 本地时间字符串 YYYY-MM-DD HH:MM（和前端保持一致） */
function nowLocal() {
  const d = new Date();
  d.setSeconds(0);
  d.setMilliseconds(0);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

/* 生成不重复的 id（时间戳 + 随机后缀） */
function genId() {
  return 'id-' + Date.now() + '-' + Math.round(Math.random() * 1e6);
}

/* ---------- 设置（自动备份开关等） ---------- */
async function getSettings() {
  const s = await store.get('settings.json', { type: 'json' });
  return s || { auto_backup: 'off', last_backup_ts: 0 };
}
async function setSettings(s) {
  await store.setJSON('settings.json', s);
}

/* 懒备份：按设置的时间间隔，在写入时顺带打一份快照到 backups/<ts>.json
   云函数无后台定时器，所以用“写入时检查是否到期”的方式实现自动备份。 */
async function maybeBackup() {
  const s = await getSettings();
  const freq = s.auto_backup || 'off';
  if (freq === 'off') return;
  const interval = freq === 'daily' ? 24 * 3600 * 1000 : freq === 'weekly' ? 7 * 24 * 3600 * 1000 : 0;
  if (!interval) return;
  const now = Date.now();
  if (now - (s.last_backup_ts || 0) < interval) return; // 还没到下一次备份时间
  const items = await listAll('items/');
  const movements = await listAll('movements/');
  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  await store.setJSON('backups/' + ts + '.json', { items, movements, ts });
  s.last_backup_ts = now;
  await setSettings(s);
}

/* ---------------- 健康检查 ---------------- */
app.get('/', (req, res) => {
  res.json({ ok: true, msg: 'warehouse api' });
});

/* ---------------- 读取全部数据（前端一次性拉取） ---------------- */
app.get('/state', async (req, res) => {
  const items = await listAll('items/');
  const movements = await listAll('movements/');
  res.json({ items, movements });
});

/* ---------------- 新增物品（同时记一笔入库） ---------------- */
app.post('/items', async (req, res) => {
  const d = req.body || {};
  if (!d.code || !d.warehouse) return res.status(400).json({ error: '编码和仓库必填' });
  const id = genId();
  const item = {
    id,
    code: d.code,
    warehouse: d.warehouse,
    name: d.name || '',
    weight: d.weight || '',
    weightUnit: d.weightUnit || '',
    qty: +(d.qty || 0),
    qtyUnit: d.qtyUnit || '',
    time: d.time || '',
    images: d.images || [],
    deleted: false,
  };
  await store.setJSON('items/' + id + '.json', item);
  const mov = {
    id: genId(),
    type: 'in',
    itemId: id,
    code: item.code,
    name: item.name,
    warehouse: item.warehouse,
    qty: item.qty,
    qtyUnit: item.qtyUnit,
    time: item.time,
  };
  await store.setJSON('movements/' + mov.id + '.json', mov);
  await maybeBackup();
  res.json({ ok: true, id });
});

/* ---------------- 编辑物品 ---------------- */
app.put('/items/:id', async (req, res) => {
  const d = req.body || {};
  const key = 'items/' + req.params.id + '.json';
  const existing = await store.get(key, { type: 'json' });
  if (!existing) return res.status(404).json({ error: '物品不存在' });
  const updated = {
    ...existing,
    code: d.code,
    warehouse: d.warehouse,
    name: d.name || '',
    weight: d.weight || '',
    weightUnit: d.weightUnit || '',
    qty: +(d.qty || 0),
    qtyUnit: d.qtyUnit || '',
    time: d.time || '',
    images: d.images || [],
  };
  await store.setJSON(key, updated);
  await maybeBackup();
  res.json({ ok: true });
});

/* ---------------- 取出（减库存 + 记一笔出库，取空自动进回收站） ---------------- */
app.post('/items/:id/takeout', async (req, res) => {
  const take = +(req.body && req.body.qty || 0);
  if (take <= 0) return res.status(400).json({ error: '取出数量须大于 0' });
  const key = 'items/' + req.params.id + '.json';
  const it = await store.get(key, { type: 'json' });
  if (!it) return res.status(404).json({ error: '物品不存在' });
  const cur = +(it.qty || 0);
  const realTake = Math.min(take, cur);
  const left = cur - realTake;
  it.qty = left;
  it.deleted = left === 0; // 取空自动进回收站
  await store.setJSON(key, it);
  const mov = {
    id: genId(),
    type: 'out',
    itemId: it.id,
    code: it.code,
    name: it.name,
    warehouse: it.warehouse,
    qty: realTake,
    qtyUnit: it.qtyUnit,
    time: nowLocal(),
  };
  await store.setJSON('movements/' + mov.id + '.json', mov);
  await maybeBackup();
  res.json({ ok: true });
});

/* ---------------- 软删除 / 恢复 ---------------- */
app.delete('/items/:id', async (req, res) => {
  const key = 'items/' + req.params.id + '.json';
  const it = await store.get(key, { type: 'json' });
  if (!it) return res.status(404).json({ error: '物品不存在' });
  it.deleted = true;
  await store.setJSON(key, it);
  await maybeBackup();
  res.json({ ok: true });
});
app.post('/items/:id/restore', async (req, res) => {
  const key = 'items/' + req.params.id + '.json';
  const it = await store.get(key, { type: 'json' });
  if (!it) return res.status(404).json({ error: '物品不存在' });
  it.deleted = false;
  await store.setJSON(key, it);
  await maybeBackup();
  res.json({ ok: true });
});

/* ---------------- 备份：导出 / 导入 ---------------- */
app.get('/export', async (req, res) => {
  const items = await listAll('items/');
  const movements = await listAll('movements/');
  res.json({ items, movements, exportedAt: new Date().toISOString() });
});
app.post('/import', async (req, res) => {
  const { items = [], movements = [] } = req.body || {};
  // 先清空现有数据，再整体写入（与 SQLite 版的 REPLACE 语义一致）
  const oldItems = await store.list({ prefix: 'items/' });
  await Promise.all(oldItems.blobs.map((b) => store.delete(b.key)));
  const oldMov = await store.list({ prefix: 'movements/' });
  await Promise.all(oldMov.blobs.map((b) => store.delete(b.key)));
  await Promise.all(
    items.map((it) => store.setJSON('items/' + it.id + '.json', { ...it, deleted: it.deleted ? true : false }))
  );
  await Promise.all(movements.map((m) => store.setJSON('movements/' + m.id + '.json', m)));
  await maybeBackup();
  res.json({ ok: true, items: items.length, movements: movements.length });
});

/* ---------------- 自动备份设置 ---------------- */
app.post('/auto-backup', async (req, res) => {
  const { freq } = req.body || {};
  const s = await getSettings();
  s.auto_backup = freq || 'off';
  await setSettings(s);
  res.json({ ok: true });
});
app.get('/auto-backup', async (req, res) => {
  const s = await getSettings();
  res.json({ freq: s.auto_backup || 'off' });
});

/* MUST export the app —— 不要 app.listen() */
export default app;
