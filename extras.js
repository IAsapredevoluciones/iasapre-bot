// extras.js - Panel /admin y registro de estados de entrega (complemento del bot)
import * as db from './database.js';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const failed = [];
const delivery = new Map();
function esc(s) {
return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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
app.get('/admin/set', async (req, res) => {
if (!auth(req, res)) return;
const estado = String(req.query.estado || '').toUpperCase();
if (!['APROBADA', 'RECHAZADA', 'PREAPROBADA'].includes(estado)) return res.status(400).send('Estado invalido');
try {
await db.updateReturnStatus(String(req.query.id), estado, String(req.query.motivo || 'Revisado por admin'));
res.redirect('/admin?key=' + encodeURIComponent(ADMIN_KEY) + '&f=' + encodeURIComponent(req.query.f || 'PREAPROBADA'));
} catch (e) { res.status(500).send('Error: ' + esc(e.message)); }
});
app.get('/admin', async (req, res) => {
if (!auth(req, res)) return;
const f = String(req.query.f || 'PREAPROBADA').toUpperCase();
try {
const rows = await db.getAllReturns();
const cnt = {};
rows.forEach((r) => { cnt[r.estado] = (cnt[r.estado] || 0) + 1; });
const list = rows.filter((r) => f === 'TODAS' || r.estado === f);
const k = encodeURIComponent(ADMIN_KEY);
let h = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin Devoluciones</title><style>body{font-family:Arial;margin:16px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #ccc;padding:5px;text-align:left}th{background:#1f4e78;color:#fff}.b{display:inline-block;margin:2px;padding:4px 8px;background:#eee;border-radius:4px;text-decoration:none;color:#000}.ok{background:#c6efce}.no{background:#ffc7ce}</style></head><body><h2>Devoluciones IAsapre</h2><p>';
['PREAPROBADA', 'APROBADA', 'RECHAZADA', 'REEMPLAZO', 'TODAS'].forEach((e) => { h += '<a class="b" href="/admin?key=' + k + '&f=' + e + '">' + e + ' (' + (e === 'TODAS' ? rows.length : (cnt[e] || 0)) + ')</a>'; });
h += '</p><table><tr><th>Fecha</th><th>ID</th><th>Ejecutivo</th><th>Lead</th><th>Causal</th><th>Horas</th><th>Perm.</th><th>Estado</th><th>Adjuntos</th><th>Accion</th></tr>';
list.forEach((r) => {
const base = '/admin/set?key=' + k + '&id=' + encodeURIComponent(r.id) + '&f=' + f;
h += '<tr><td>' + esc(String(r.fecha || '').slice(0, 16).replace('T', ' ')) + '</td><td>' + esc(r.id) + '</td><td>' + esc(r.ejecutivo) + '</td><td>' + esc(r.leadnombre) + ' ' + esc(r.leadtelefono) + '</td><td>' + esc(r.causal) + '</td><td>' + esc(r.horascontacto) + '</td><td>' + esc(r.mesespermanencia) + '</td><td>' + esc(r.estado) + '</td><td>' + links(r.comprobantes) + '</td><td><a class="b ok" href="' + base + '&estado=APROBADA">Aprobar</a><a class="b no" href="' + base + '&estado=RECHAZADA">Rechazar</a></td></tr>';
});
h += '</table><h3>Entregas de WhatsApp fallidas (desde el ultimo reinicio)</h3>';
h += failed.length ? '<ul>' + failed.slice(0, 50).map((x) => '<li>' + esc(x.t) + ' a ' + esc(x.to) + ': ' + esc(x.err) + '</li>').join('') + '</ul>' : '<p>Ninguna registrada.</p>';
h += '</body></html>';
res.type('html').send(h);
} catch (e) { res.status(500).send('Error: ' + esc(e.message)); }
});
}
