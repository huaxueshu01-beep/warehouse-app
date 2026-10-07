/* =========================================================
   Cloudflare Worker —— 仓库系统后端 + 静态资源托管
   数据层用 D1（serverless SQLite），与最早 Node 版表结构几乎一致，
   逻辑可 1:1 搬过来；前端 public/index.html 由 Workers Static Assets 托管。
   无需登录：所有人可直接使用。

   路由：
     - /api/* 由本 Worker 处理
     - 其余请求回退到静态资源（public/ 下的 index.html 等）
   ========================================================= */

/* 每个建表语句单独执行，避免 D1 的 db.exec() 把多语句模板字符串截断 */
const SCHEMA_STMTS = [
  `CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, code TEXT, warehouse TEXT, name TEXT, weight TEXT, weight_unit TEXT, qty REAL, qty_unit TEXT, time TEXT, images TEXT, deleted INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS movements (id TEXT PRIMARY KEY, type TEXT, item_id TEXT, code TEXT, name TEXT, warehouse TEXT, qty REAL, qty_unit TEXT, time TEXT)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS backups (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, data TEXT)`,
];

/* 确保表存在（幂等，每个冷启动第一次请求时执行） */
async function ensureSchema(db) {
  for (const sql of SCHEMA_STMTS) await db.exec(sql);
}

/* 标准 JSON 响应 */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/* 本地时间字符串 YYYY-MM-DD HH:MM（和前端保持一致） */
function nowLocal() {
  const d = new Date();
  d.setSeconds(0);
  d.setMilliseconds(0);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

/* 数据库行 -> 前端对象（字段名转换 + images 解析） */
function rowToItem(r) {
  return {
    id: r.id,
    code: r.code,
    warehouse: r.warehouse,
    name: r.name,
    weight: r.weight,
    weightUnit: r.weight_unit,
    qty: r.qty,
    qtyUnit: r.qty_unit,
    time: r.time,
    images: r.images ? JSON.parse(r.images) : [],
    deleted: !!r.deleted,
  };
}
function rowToMovement(m) {
  return {
    id: m.id,
    type: m.type,
    itemId: m.item_id,
    code: m.code,
    name: m.name,
    warehouse: m.warehouse,
    qty: m.qty,
    qtyUnit: m.qty_unit,
    time: m.time,
  };
}

/* ---------- 业务函数（与前端契约一一对应） ---------- */

async function getState(db) {
  const items = (await db.prepare('SELECT * FROM items').all()).results.map(rowToItem);
  const movements = (await db.prepare('SELECT * FROM movements').all()).results.map(rowToMovement);
  return { items, movements };
}

async function createItem(db, d) {
  if (!d.code || !d.warehouse) return json({ error: '编码和仓库必填' }, 400);
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO items (id,code,warehouse,name,weight,weight_unit,qty,qty_unit,time,images,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(id, d.code, d.warehouse, d.name || '', d.weight || '', d.weightUnit || '',
      +(d.qty || 0), d.qtyUnit || '', d.time || '', JSON.stringify(d.images || []), nowLocal())
    .run();
  const movId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO movements (id,type,item_id,code,name,warehouse,qty,qty_unit,time)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .bind(movId, 'in', id, d.code, d.name || '', d.warehouse, +(d.qty || 0), d.qtyUnit || '', d.time || '')
    .run();
  await maybeBackup(db);
  return json({ ok: true, id });
}

async function editItem(db, id, d) {
  const existing = (await db.prepare('SELECT * FROM items WHERE id=?').bind(id).all()).results[0];
  if (!existing) return json({ error: '物品不存在' }, 404);
  await db
    .prepare(
      `UPDATE items SET code=?,warehouse=?,name=?,weight=?,weight_unit=?,qty=?,qty_unit=?,time=?,images=?,updated_at=?
       WHERE id=?`
    )
    .bind(d.code, d.warehouse, d.name || '', d.weight || '', d.weightUnit || '',
      +(d.qty || 0), d.qtyUnit || '', d.time || '', JSON.stringify(d.images || []), nowLocal(), id)
    .run();
  await maybeBackup(db);
  return json({ ok: true });
}

async function takeOut(db, id, take) {
  if (!(take > 0)) return json({ error: '取出数量须大于 0' }, 400);
  const it = (await db.prepare('SELECT * FROM items WHERE id=?').bind(id).all()).results[0];
  if (!it) return json({ error: '物品不存在' }, 404);
  const cur = +(it.qty || 0);
  const realTake = Math.min(take, cur);
  const left = cur - realTake;
  await db.prepare('UPDATE items SET qty=?, deleted=? WHERE id=?').bind(left, left === 0 ? 1 : 0, id).run();
  const movId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO movements (id,type,item_id,code,name,warehouse,qty,qty_unit,time)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .bind(movId, 'out', id, it.code, it.name, it.warehouse, realTake, it.qty_unit, nowLocal())
    .run();
  await maybeBackup(db);
  return json({ ok: true });
}

async function softDelete(db, id) {
  const it = (await db.prepare('SELECT * FROM items WHERE id=?').bind(id).all()).results[0];
  if (!it) return json({ error: '物品不存在' }, 404);
  await db.prepare('UPDATE items SET deleted=1 WHERE id=?').bind(id).run();
  await maybeBackup(db);
  return json({ ok: true });
}

async function restore(db, id) {
  const it = (await db.prepare('SELECT * FROM items WHERE id=?').bind(id).all()).results[0];
  if (!it) return json({ error: '物品不存在' }, 404);
  await db.prepare('UPDATE items SET deleted=0 WHERE id=?').bind(id).run();
  await maybeBackup(db);
  return json({ ok: true });
}

async function exportData(db) {
  const items = (await db.prepare('SELECT * FROM items').all()).results.map(rowToItem);
  const movements = (await db.prepare('SELECT * FROM movements').all()).results.map(rowToMovement);
  return json({ items, movements, exportedAt: new Date().toISOString() });
}

async function importData(db, items = [], movements = []) {
  await db.prepare('DELETE FROM items').run();
  await db.prepare('DELETE FROM movements').run();
  for (const it of items) {
    await db
      .prepare(
        `INSERT INTO items (id,code,warehouse,name,weight,weight_unit,qty,qty_unit,time,images,deleted)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(it.id, it.code, it.warehouse, it.name, it.weight, it.weightUnit, it.qty, it.qtyUnit, it.time,
        JSON.stringify(it.images || []), it.deleted ? 1 : 0)
      .run();
  }
  for (const m of movements) {
    await db
      .prepare(
        `INSERT INTO movements (id,type,item_id,code,name,warehouse,qty,qty_unit,time)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .bind(m.id, m.type, m.itemId, m.code, m.name, m.warehouse, m.qty, m.qtyUnit, m.time)
      .run();
  }
  await maybeBackup(db);
  return json({ ok: true, items: items.length, movements: movements.length });
}

async function getAutoBackup(db) {
  const row = (await db.prepare("SELECT value FROM settings WHERE key='auto_backup'").all()).results[0];
  return json({ freq: row ? row.value : 'off' });
}
async function setAutoBackup(db, freq) {
  await db
    .prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('auto_backup',?)")
    .bind(freq || 'off')
    .run();
  return json({ ok: true });
}

/* 懒备份：云函数无后台定时器，按设置间隔在写入时顺带打快照到 backups 表 */
async function maybeBackup(db) {
  const s = (await db.prepare("SELECT value FROM settings WHERE key='auto_backup'").all()).results[0];
  const freq = s ? s.value : 'off';
  if (freq === 'off') return;
  const interval = freq === 'daily' ? 24 * 3600 * 1000 : freq === 'weekly' ? 7 * 24 * 3600 * 1000 : 0;
  if (!interval) return;
  const last = (await db.prepare("SELECT value FROM settings WHERE key='last_backup_ts'").all()).results[0];
  const lastTs = last ? +last.value : 0;
  const now = Date.now();
  if (now - lastTs < interval) return; // 还没到下一次备份时间
  const items = (await db.prepare('SELECT * FROM items').all()).results.map(rowToItem);
  const movements = (await db.prepare('SELECT * FROM movements').all()).results.map(rowToMovement);
  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  await db.prepare('INSERT INTO backups (ts,data) VALUES (?,?)').bind(ts, JSON.stringify({ items, movements, ts })).run();
  await db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('last_backup_ts',?)").bind(String(now)).run();
}

/* ---------- 入口：Worker 的 fetch 处理器 ---------- */
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // 非 /api 请求 → 交给静态资源（前端 index.html 等）
      if (!path.startsWith('/api')) {
        const resp = await env.ASSETS.fetch(request);
        if (resp.status === 404 && request.method === 'GET') {
          // SPA 兜底：未知路径回退到首页
          return env.ASSETS.fetch(new Request(new URL('/index.html', url)));
        }
        return resp;
      }

      const db = env.DB;
      if (!db) {
        console.error('D1 binding "DB" not found. env keys =', Object.keys(env || {}));
        return json({
          error: 'D1 binding not found',
          message: '未找到 D1 绑定 DB。请在 Worker 项目 Settings → Variables and Bindings → D1 database bindings 添加：变量名 DB → 选 warehouse，然后 Redeploy。',
          envKeys: Object.keys(env || {}),
        }, 500);
      }
      await ensureSchema(db);

      const method = request.method;
      const seg = path.replace(/^\/api\/?/, '').split('/').filter(Boolean); // ['items','123','takeout']

      // 健康检查 / 根
      if (seg.length === 0) return json({ ok: true, msg: 'warehouse api', db: 'ok' });

      // GET /api/state
      if (seg.length === 1 && seg[0] === 'state' && method === 'GET') return json(await getState(db));

      // POST /api/items
      if (seg.length === 1 && seg[0] === 'items' && method === 'POST') {
        return await createItem(db, await request.json());
      }

      // PUT /api/items/:id
      if (seg.length === 2 && seg[0] === 'items' && method === 'PUT') {
        return await editItem(db, seg[1], await request.json());
      }

      // POST /api/items/:id/takeout
      if (seg.length === 3 && seg[0] === 'items' && seg[2] === 'takeout' && method === 'POST') {
        const b = await request.json().catch(() => ({}));
        return await takeOut(db, seg[1], +(b && b.qty || 0));
      }

      // DELETE /api/items/:id
      if (seg.length === 2 && seg[0] === 'items' && method === 'DELETE') return await softDelete(db, seg[1]);

      // POST /api/items/:id/restore
      if (seg.length === 3 && seg[0] === 'items' && seg[2] === 'restore' && method === 'POST') {
        return await restore(db, seg[1]);
      }

      // GET /api/export
      if (seg.length === 1 && seg[0] === 'export' && method === 'GET') return await exportData(db);

      // POST /api/import
      if (seg.length === 1 && seg[0] === 'import' && method === 'POST') {
        const b = await request.json();
        return await importData(db, b.items || [], b.movements || []);
      }

      // GET/POST /api/auto-backup
      if (seg.length === 1 && seg[0] === 'auto-backup' && method === 'GET') return await getAutoBackup(db);
      if (seg.length === 1 && seg[0] === 'auto-backup' && method === 'POST') {
        const b = await request.json().catch(() => ({}));
        return await setAutoBackup(db, b.freq);
      }

      return json({ error: 'Not Found' }, 404);
    } catch (e) {
      console.error('fetch error:', e && (e.stack || e.message || String(e)));
      return json({
        error: '服务器错误',
        message: (e && e.message) || String(e),
        stack: (e && e.stack) || '',
      }, 500);
    }
  },
};
