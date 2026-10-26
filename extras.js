// extras.js - Panel /admin y registro de estados de entrega (complemento del bot)
import * as db from './database.js';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const failed = [];
const delivery = new Map();
const SB_URL = process.env.SUPABASE_URL || '';
const SB_KEY = process.env.SUPABASE_KEY || '';
const OPTS = ['No definido', 'Aprobado', 'Pendiente antecedente', 'Rechazado'];
const COLORS = { 'No definido': '#eee', 'Aprobado': '#c6efce', 'Pendiente antecedente': '#ffeb9c', 'Rechazado': '#ffc7ce' };
const SEED = { NCPIB7H6O: 'Aprobado', '4WIL834XS': 'Aprobado', '81FWVYJFL': 'Aprobado', '4V4BJV6X0': 'Aprobado', R4ITPEZRT: 'Aprobado', CPB0Z2NVZ: 'Aprobado', STPMBQGDT: 'Aprobado', JVB6RWSTE: 'Aprobado', X8ZUEA5AU: 'Aprobado', EU2F9B66F: 'Aprobado', E2ASUK9BO: 'Aprobado', '0ZVEAONRH': 'Aprobado', '2H23H9N8N': 'Aprobado', '8W2I6V2OW': 'Aprobado', DMD09TWSJ: 'Aprobado', N44V2G25L: 'Aprobado', Q5GL64Y55: 'Aprobado', KKZ44P1R0: 'Aprobado', '5GI8MWLV8': 'Aprobado', KV50JFBEK: 'Aprobado', B1JXMNU3N: 'Aprobado', '815HM826F': 'Aprobado', Z7OOCWQH9: 'Aprobado', '19MU5KJ2D': 'Aprobado', '7FNY8VQ0I': 'Aprobado', '3ZX0ZC1TI': 'Aprobado', Q5N0DEX72: 'Aprobado', G6FY2NJP9: 'Aprobado', H2Y8S1RK9: 'Pendiente antecedente' };
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function parseC(c) {
  let o = {};
  try { o = typeof c === 'string' ? JSON.parse(c) : (c || {}); } catch (e) { o = {}; }
  return o && typeof o === 'object' ? o : {};
}
async function saveFinal(id, val, row) {
  const o = parseC(row.comprobantes);
  o.final = val;
  o.finalFecha = new Date().toISOString();
  const r = await fetch(SB_URL + '/rest/v1/devoluciones?id=eq.' + encodeURIComponent(id), { method: 'PATCH', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ comprobantes: JSON.stringify(o) }) });
  if (!r.ok) throw new Error('Supabase ' + r.status + ' ' + (await r.text()));
  row.comprobantes = JSON.stringify(o);
}
function links(c) {
  let o = {};
  try { o = typeof c === 'string' ? JSON.parse(c) : (c || {}); } catch (e) { o = {}; }
  let h = '';
  if (o.contacto) h += '<a href="' + esc(o.contacto) + '" target="_blank">contacto</a> ';
  if (o.causal) h += '<a href="' + esc(o.causal) + '" target="_blank">causal</a>';
  return h || '<b style="color:#c00">SIN ADJUNTOS</b>';
}
export function installExtras(app) {
  app.use('/webhook', (req, res, next) => {
    try {
      const b = req.body || {};
      for (const en of b.entry || []) {
        for (const ch of en.changes || []) {
          for (const st of (ch.value && ch.value.statuses) || []) {
            const rec = { t: new Date().toISOString(), to: st.recipient_id, status: st.status, id: st.id, err: (st.errors || []).map((e) => e.code + ' ' + (e.title || e.message || '')).join('; ') };
            delivery.set(st.id, rec);
            if (st.status === 'failed') {
              failed.unshift(rec);
              if (failed.length > 200) failed.pop();
              console.error('ENTREGA FALLIDA a ' + st.recipient_id + ': ' + rec.err + ' (id ' + st.id + ')');
            } else {
              console.log('ENTREGA ' + st.status + ' a ' + st.recipient_id + ' (id ' + st.id + ')');
            }
          }
        }
      }
    } catch (e) { console.error('extras status error', e); }
    next();
  });
  function auth(req, res) {
    if (!ADMIN_KEY) { res.status(503).send('Falta variable ADMIN_KEY en Render'); return false; }
    if (req.query.key !== ADMIN_KEY) { res.status(401).send('Clave incorrecta'); return false; }
    return true;
  }
  app.get('/admin/final', async (req, res) => {
    if (!auth(req, res)) return;
    const v = String(req.query.v || '');
    if (!OPTS.includes(v)) return res.status(400).send('Valor invalido');
    try {
      const rows = await db.getAllReturns();
      const row = rows.find((x) => x.id === String(req.query.id));
      if (!row) return res.status(404).send('No existe');
      await saveFinal(row.id, v, row);
      res.redirect('/admin?key=' + encodeURIComponent(ADMIN_KEY) + '&f=' + encodeURIComponent(req.query.f || 'SIN DEFINIR') + '#r' + row.id);
    } catch (e) { res.status(500).send('Error: ' + esc(e.message)); }
  });
  app.get('/admin', async (req, res) => {
    if (!auth(req, res)) return;
    const f = String(req.query.f || 'SIN DEFINIR').toUpperCase();
    try {
      const rows = await db.getAllReturns();
      for (const r of rows) {
        const o = parseC(r.comprobantes);
        const key = String(r.id).replace('RET-', '');
        if (!o.final && SEED[key]) { try { await saveFinal(r.id, SEED[key], r); } catch (e) { console.error('seed', e.message); } }
      }
      const fin = (r) => parseC(r.comprobantes).final || 'No definido';
      const cnt = {};
      rows.forEach((r) => { cnt[fin(r)] = (cnt[fin(r)] || 0) + 1; });
      const list = rows.filter((r) => f === 'TODAS' || fin(r).toUpperCase() === (f === 'SIN DEFINIR' ? 'NO DEFINIDO' : f));
      const k = encodeURIComponent(ADMIN_KEY);
      let h = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin Devoluciones</title><style>body{font-family:Arial;margin:16px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #ccc;padding:5px;text-align:left}th{background:#1f4e78;color:#fff}.b{display:inline-block;margin:2px;padding:4px 8px;background:#eee;border-radius:4px;text-decoration:none;color:#000}</style></head><body><h2>Devoluciones IAsapre</h2><p>';
      [['SIN DEFINIR', 'No definido'], ['APROBADO', 'Aprobado'], ['PENDIENTE ANTECEDENTE', 'Pendiente antecedente'], ['RECHAZADO', 'Rechazado'], ['TODAS', '']].forEach((e) => { h += '<a class="b" href="/admin?key=' + k + '&f=' + encodeURIComponent(e[0]) + '">' + e[0] + ' (' + (e[0] === 'TODAS' ? rows.length : (cnt[e[1]] || 0)) + ')</a>'; });
      h += '</p><table><tr><th>Fecha</th><th>ID</th><th>Ejecutivo</th><th>Lead</th><th>Causal</th><th>Horas</th><th>Perm.</th><th>Bot</th><th>Adjuntos</th><th>ESTADO FINAL</th></tr>';
      list.forEach((r) => {
        const cur = fin(r);
        h += '<tr id="r' + esc(r.id) + '"><td>' + esc(String(r.fecha || '').slice(0, 16).replace('T', ' ')) + '</td><td>' + esc(r.id) + '</td><td>' + esc(r.ejecutivo) + '</td><td>' + esc(r.leadnombre) + ' ' + esc(r.leadtelefono) + '</td><td>' + esc(r.causal) + '</td><td>' + esc(r.horascontacto) + '</td><td>' + esc(r.mesespermanencia) + '</td><td>' + esc(r.estado) + '</td><td>' + links(r.comprobantes) + '</td><td style="background:' + COLORS[cur] + '"><form method="get" action="/admin/final"><input type="hidden" name="key" value="' + esc(ADMIN_KEY) + '"><input type="hidden" name="id" value="' + esc(r.id) + '"><input type="hidden" name="f" value="' + esc(f) + '"><select name="v" onchange="this.form.submit()">' + OPTS.map((o) => '<option' + (o === cur ? ' selected' : '') + '>' + o + '</option>').join('') + '</select></form></td></tr>';
      });
      h += '</table><h3>Entregas de WhatsApp fallidas (desde el ultimo reinicio)</h3>';
      h += failed.length ? '<ul>' + failed.slice(0, 50).map((x) => '<li>' + esc(x.t) + ' a ' + esc(x.to) + ': ' + esc(x.err) + '</li>').join('') + '</ul>' : '<p>Ninguna registrada.</p>';
      h += '</body></html>';
      res.type('html').send(h);
    } catch (e) { res.status(500).send('Error: ' + esc(e.message)); }
  });
}
