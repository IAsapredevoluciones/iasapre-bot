// resumen.js - Contadores mensuales por ejecutivo (se inyecta en /admin)
import { installExtras as installBase } from './extras.js';
import * as db from './database.js';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const SB_URL = process.env.SUPABASE_URL || '';
const SB_KEY = process.env.SUPABASE_KEY || '';
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function parseC(c) {
let o = {};
try { o = typeof c === 'string' ? JSON.parse(c) : (c || {}); } catch (e) { o = {}; }
return o && typeof o === 'object' ? o : {};
}
export function canon(n) {
const s = String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const rules = [[/edda/, 'Edda Hernandez'], [/fuhrer/, 'Jocelyn Fuhrer'], [/abarca/, 'Jocelyn Abarca'], [/alan/, 'Alan Flores'], [/camila ramos/, 'Camila Ramos'], [/paola/, 'Paola Renteria'], [/jeannette/, 'Jeannette Vasquez'], [/mittcy/, 'Mittcy Urquiola'], [/carmen gloria/, 'Carmen Gloria Troncoso'], [/maria jose/, 'Maria Jose Villagran'], [/jennifer|jenny/, 'Jennifer Soto'], [/manriquez/, 'Alejandra Manriquez'], [/alejandra|^ale /, 'Alejandra Espinoza'], [/rene/, 'Rene Berho'], [/cecilia/, 'Cecilia Cataldo'], [/catherine|cathy/, 'Catherine Morales'], [/pamela/, 'Pamela Garrido'], [/alberto/, 'Alberto Leyton'], [/brisa/, 'Brisa Gajardo'], [/paulina/, 'Paulina Araus']];
for (const r of rules) { if (r[0].test(s)) return r[1]; }
return String(n || 'Sin nombre').trim();
}
export function buildSummary(rows) {
const g = new Map();
for (const r of rows) {
const ej = canon(r.ejecutivo);
const label = String(r.mes || '?') + ' ' + String(r.fecha || '').slice(0, 4);
const key = ej + '|' + label;
if (!g.has(key)) g.set(key, { ej, label, ord: String(r.fecha || '').slice(0, 7), normal: 0, wsp: 0, cont: 0, mult: 1, mf: '' });
const e = g.get(key);
if (String(r.fecha || '').slice(0, 7) > e.ord) e.ord = String(r.fecha || '').slice(0, 7);
const o = parseC(r.comprobantes);
if (o.mult && String(o.multFecha || '') >= e.mf) { e.mult = Number(o.mult) || 1; e.mf = String(o.multFecha || ''); }
if (o.final === 'Aprobado') {
if (r.causal === 'Whatsapp Invalido') e.wsp++;
else if (r.causal === 'Falta de contactabilidad') e.cont++;
else e.normal++;
}
}
return [...g.values()].sort((a, b) => (a.ord < b.ord ? 1 : a.ord > b.ord ? -1 : a.ej.localeCompare(b.ej)));
}
function html(list) {
let h = '<h3>Resumen mensual por ejecutivo (solo cuentan las de Estado final = Aprobado)</h3><table><tr><th>Ejecutivo</th><th>Mes</th><th>Multiplicador de bolsa</th><th>Normales aprobadas (limite 4 x mult.)</th><th>WhatsApp inexistente aprobadas</th><th>Falta de contactabilidad aprobadas</th></tr>';
for (const e of list) {
const lim = 4 * e.mult;
const red = e.normal >= lim;
h += '<tr><td>' + esc(e.ej) + '</td><td>' + esc(e.label) + '</td><td><form method="get" action="/admin/mult"><input type="hidden" name="key" value="' + esc(ADMIN_KEY) + '"><input type="hidden" name="ej" value="' + esc(e.ej) + '"><input type="hidden" name="mes" value="' + esc(e.label) + '"><select name="v" onchange="this.form.submit()">' + [1, 2, 3, 4, 5].map((n) => '<option value="' + n + '"' + (n === e.mult ? ' selected' : '') + '>x' + n + '</option>').join('') + '</select></form></td><td style="' + (red ? 'background:#ff0000;color:#fff;font-weight:bold' : '') + '">' + e.normal + ' / ' + lim + '</td><td>' + e.wsp + '</td><td>' + e.cont + '</td></tr>';
}
return h + '</table><br>';
}
async function patch(row, fields) {
const o = parseC(row.comprobantes);
Object.assign(o, fields);
const r = await fetch(SB_URL + '/rest/v1/devoluciones?id=eq.' + encodeURIComponent(row.id), { method: 'PATCH', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ comprobantes: JSON.stringify(o) }) });
if (!r.ok) throw new Error('Supabase ' + r.status + ' ' + (await r.text()));
}
export function installExtras(app) {
app.get('/admin/mult', async (req, res) => {
if (!ADMIN_KEY || req.query.key !== ADMIN_KEY) return res.status(401).send('Clave incorrecta');
const v = Number(req.query.v);
if (![1, 2, 3, 4, 5].includes(v)) return res.status(400).send('Valor invalido');
try {
const rows = await db.getAllReturns();
const mine = rows.filter((r) => canon(r.ejecutivo) === String(req.query.ej) && (String(r.mes || '?') + ' ' + String(r.fecha || '').slice(0, 4)) === String(req.query.mes));
const stamp = new Date().toISOString();
for (const r of mine) { await patch(r, { mult: v, multFecha: stamp }); }
res.redirect('/admin?key=' + encodeURIComponent(ADMIN_KEY) + '&f=TODAS');
} catch (e) { res.status(500).send('Error: ' + esc(e.message)); }
});
app.use('/admin', (req, res, next) => {
if (req.method !== 'GET' || req.originalUrl.split('?')[0] !== '/admin' || !ADMIN_KEY || req.query.key !== ADMIN_KEY) return next();
const orig = res.send.bind(res);
res.send = (body) => {
db.getAllReturns().then((rows) => {
const out = String(body).replace('<h2>Devoluciones IAsapre</h2>', '<h2>Devoluciones IAsapre</h2>' + html(buildSummary(rows)));
orig(out);
}).catch(() => orig(body));
return res;
};
next();
});
installBase(app);
}
