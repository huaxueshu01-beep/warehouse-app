import app from './api.mjs';
import http from 'node:http';

const server = http.createServer((req, res) => {
  app(req, res);
});
server.listen(0, async () => {
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const j = async (path, opts = {}) => {
    const r = await fetch(base + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    let body = null;
    try { body = await r.json(); } catch (e) {}
    return { status: r.status, body };
  };
  const log = (name, ok, extra = '') => console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '  ' + extra);

  try {
    let r = await j('/state');
    log('GET /state empty', r.status === 200 && r.body.items.length === 0 && r.body.movements.length === 0, JSON.stringify(r.body));

    r = await j('/items', { method: 'POST', body: JSON.stringify({
      code: 'A001', warehouse: '主仓', name: '螺丝', weight: '10', weightUnit: 'kg',
      qty: '5', qtyUnit: '个', time: '2026-10-04 10:00', images: ['data:image/png;base64,xxx'],
    }) });
    const id = r.body.id;
    log('POST /items', r.status === 200 && !!id, 'id=' + id);

    r = await j('/state');
    const it = r.body.items.find((x) => x.id === id);
    log('state after create', r.body.items.length === 1 && r.body.movements.length === 1 && it.qty === 5 && it.deleted === false && it.images.length === 1, JSON.stringify(it));

    r = await j('/items/' + id + '/takeout', { method: 'POST', body: JSON.stringify({ qty: 3 }) });
    log('takeout 3', r.status === 200);
    r = await j('/state');
    const it2 = r.body.items.find((x) => x.id === id);
    const outs = r.body.movements.filter((m) => m.type === 'out');
    log('after takeout', it2.qty === 2 && outs.length === 1 && outs[0].qty === 3, 'qty=' + it2.qty + ' outs=' + outs.length);

    r = await j('/items/' + id, { method: 'PUT', body: JSON.stringify({
      code: 'A001', warehouse: '主仓', name: '螺丝(改)', weight: '12', weightUnit: 'kg',
      qty: '2', qtyUnit: '个', time: '2026-10-04 10:00', images: [],
    }) });
    log('PUT edit', r.status === 200);
    r = await j('/state');
    const it3 = r.body.items.find((x) => x.id === id);
    log('edit preserved deleted', it3.name === '螺丝(改)' && it3.deleted === false && it3.images.length === 0);

    r = await j('/items/' + id + '/takeout', { method: 'POST', body: JSON.stringify({ qty: 99 }) });
    log('takeout all', r.status === 200);
    r = await j('/state');
    const it4 = r.body.items.find((x) => x.id === id);
    log('soft-deleted when empty', it4.qty === 0 && it4.deleted === true, 'qty=' + it4.qty + ' deleted=' + it4.deleted);

    r = await j('/items/' + id + '/restore', { method: 'POST' });
    log('restore', r.status === 200);
    r = await j('/state');
    const it5 = r.body.items.find((x) => x.id === id);
    log('restored', it5.deleted === false);

    r = await j('/items/' + id, { method: 'DELETE' });
    log('DELETE', r.status === 200);
    r = await j('/state');
    const it6 = r.body.items.find((x) => x.id === id);
    log('deleted flag set', it6.deleted === true);

    r = await j('/auto-backup');
    log('GET auto-backup default', r.body.freq === 'off', r.body.freq);
    r = await j('/auto-backup', { method: 'POST', body: JSON.stringify({ freq: 'daily' }) });
    r = await j('/auto-backup');
    log('POST auto-backup daily', r.body.freq === 'daily');

    r = await j('/export');
    log('export', r.status === 200 && r.body.items.length === 1 && !!r.body.exportedAt, 'items=' + r.body.items.length);

    r = await j('/import', { method: 'POST', body: JSON.stringify({
      items: [{ id: 'X1', code: 'B002', warehouse: '副仓', name: '螺母', qty: 8, qtyUnit: '个', time: '2026-10-05 09:00', images: [], deleted: false }],
      movements: [{ id: 'M1', type: 'in', itemId: 'X1', code: 'B002', name: '螺母', warehouse: '副仓', qty: 8, qtyUnit: '个', time: '2026-10-05 09:00' }],
    }) });
    log('import', r.status === 200 && r.body.items === 1 && r.body.movements === 1);
    r = await j('/state');
    log('after import state', r.body.items.length === 1 && r.body.items[0].id === 'X1' && r.body.movements.length === 1, JSON.stringify(r.body.items[0]));

    r = await j('/items', { method: 'POST', body: JSON.stringify({ code: '', warehouse: '' }) });
    log('create validation', r.status === 400, 'status=' + r.status);

    r = await j('/items/X1/takeout', { method: 'POST', body: JSON.stringify({ qty: 0 }) });
    log('takeout validation', r.status === 400);
  } catch (e) {
    console.log('ERROR', e);
  } finally {
    server.close();
  }
});
