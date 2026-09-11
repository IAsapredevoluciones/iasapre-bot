// ============================================================
// BOT WHATSAPP IASAPRE - v3.0 (WhatsApp Cloud API oficial de Meta)
// Sin Baileys, sin QR, sin sesion que se corrompa. Webhook + Graph API.
// ============================================================

import express from 'express';
import cors from 'cors';
import * as db from './database.js';

// ==========================================
// 0. CONFIG
// ==========================================
const GRAPH_API_VERSION = 'v21.0';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'iasapre_verify_token';
const ADMIN_PHONE = process.env.ADMIN_PHONE || '56985380357';

if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.warn('Falta WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID en las variables de entorno. El bot no podra enviar mensajes hasta que se configuren.');
}

// ==========================================
// 1. SERVIDOR WEB (webhook + API)
// ==========================================
const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

app.get('/api/returns', async (req, res) => {
    try {
        const rows = await db.getAllReturns();
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', bot: 'Cloud API activo', phoneNumberId: PHONE_NUMBER_ID || null });
});

app.get('/politica-privacidad', (req, res) => {
    res.type('html').send('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Politica de Privacidad - IAsapre</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:Arial,sans-serif;max-width:700px;margin:40px auto;padding:0 20px;line-height:1.6;color:#222}h1{color:#0a6}</style></head><body><h1>Politica de Privacidad - IAsapre</h1><p>Ultima actualizacion: 11 de septiembre de 2026</p><p>IAsapre ofrece un servicio de asesoria gratuita para comparar y evaluar planes de salud (Isapre) en Chile, incluyendo comunicacion por WhatsApp.</p><h2>Informacion que recopilamos</h2><p>Recopilamos los datos que nos entregas voluntariamente al contactarnos: nombre, telefono, correo electronico, edad, region, prevision de salud actual y otra informacion relevante para la asesoria.</p><h2>Uso de la informacion</h2><p>Usamos tu informacion unicamente para contactarte, entregarte asesoria sobre planes de salud y dar seguimiento a tu solicitud. No vendemos ni compartimos tus datos con terceros no relacionados con el servicio.</p><h2>WhatsApp Business API</h2><p>Utilizamos la API oficial de WhatsApp Business (Meta) para comunicarnos contigo. Los mensajes se procesan conforme a las politicas de Meta y se almacenan de forma segura para dar curso a tu solicitud.</p><h2>Confidencialidad</h2><p>Tus datos son tratados de forma confidencial y solo son accedidos por personal autorizado de IAsapre.</p><h2>Tus derechos</h2><p>Puedes solicitar la eliminacion o correccion de tus datos personales escribiendo a contacto@iasapre.cl.</p><h2>Contacto</h2><p>Para cualquier consulta sobre esta politica, escribenos a contacto@iasapre.cl.</p></body></html>');
});


// Verificacion del webhook (Meta llama esto una vez al configurar la suscripcion)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('Webhook verificado por Meta.');
            return res.status(200).send(challenge);
        }
    console.log('Verificacion de webhook rechazada (token no coincide).');
    return res.sendStatus(403);
});

// Recepcion de mensajes entrantes
app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    try {
        const body = req.body;
        if (!body || body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
            const value = change.value || {};
            const messages = value.messages || [];
            for (const msg of messages) {
                if (hasProcessed(msg.id)) continue;
                markProcessed(msg.id);
                handleIncomingMessage(msg).catch((e) => {
                    console.error('Error manejando mensaje entrante:', e);
                });
            }
        }
    }
    } catch (e) {
        console.error('Error procesando webhook:', e);
    }
});

app.listen(port, () => {
    console.log('Servidor web en http://localhost:' + port);
});

// ==========================================
// 2. UTILIDADES DE ENVIO / DESCARGA (GRAPH API)
// =========================================
async function sendText(to, text) {
    const res = await fetch('https://graph.facebook.com/' + GRAPH_API_VERSION + '/' + PHONE_NUMBER_ID + '/messages', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + WHATSAPP_TOKEN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'text',
            text: { body: text }
        })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        console.error('ERROR enviando mensaje a ' + to + ': ' + JSON.stringify(data));
        throw new Error((data.error && data.error.message) || 'Error enviando mensaje');
    }
    console.log('Mensaje enviado a ' + to + '. id=' + (data.messages && data.messages[0] && data.messages[0].id));
    return data;
}

async function downloadMedia(mediaId) {
    const metaRes = await fetch('https://graph.facebook.com/' + GRAPH_API_VERSION + '/' + mediaId, {
        headers: { 'Authorization': 'Bearer ' + WHATSAPP_TOKEN }
    });
    const meta = await metaRes.json();
    if (!metaRes.ok) throw new Error((meta.error && meta.error.message) || 'Error obteniendo metadata de media');

const fileRes = await fetch(meta.url, {
    headers: { 'Authorization': 'Bearer ' + WHATSAPP_TOKEN }
});
    if (!fileRes.ok) throw new Error('Error descargando archivo de media (status ' + fileRes.status + ')');

const arrayBuffer = await fileRes.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), mimeType: meta.mime_type || 'application/octet-stream' };
}

// Dedup simple de mensajes (Meta puede reenviar el mismo webhook)
const processedIds = new Set();
function hasProcessed(id) {
    return id ? processedIds.has(id) : false;
}
function markProcessed(id) {
    if (!id) return;
    processedIds.add(id);
    if (processedIds.size > 500) {
        const keep = Array.from(processedIds).slice(-200);
        processedIds.clear();
        keep.forEach((x) => processedIds.add(x));
    }
}

// =========================================
// 3. LOGICA DEL BOT (sesiones y validaciones)
// ==========================================
const sessions = new Map();

const STEPS = {
    MENU: 0,
    GREETING: 1,
    MES: 2,
    LEAD_NOMBRE: 3,
    LEAD_TELEFONO: 4,
    HORAS: 5,
    PROOF_CONTACTO: 6,
    CAUSAL: 7,
    PERMANENCIA: 8,
    PROOF_CAUSAL: 9,
    DECLARACIONES: 10,
    PROY_NOMBRE: 11,
    PROY_MES: 12,
    PROY_CANTIDAD: 13,
    PROY_SEMANAS: 14,
    PROY_CONFIRM: 15
};

// Valor de cada bolsa proyectada: 1ra = 250.000, 2da = 225.000, 3ra = 200.000
const BOLSA_VALUES = [250000, 225000, 200000];
const WEEK_OPTIONS = ['Primer fin de semana', 'Segundo fin de semana', 'Tercer fin de semana', 'Cuarto fin de semana'];
const RAFAEL_PHONE = process.env.PROYECCION_ADMIN_PHONE || '56950004932';

function formatCLP(n) {
    return '$' + n.toLocaleString('es-CL');
}

const validMeses = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];

const validCausales = [
    'Falta de anualidad',
    'Whatsapp Invalido',
    'Preexistencia no afiliable',
    'Pre o post natal',
    'Renta inferior a $900.000'
    ];

function formatOptions(opts) {
    return opts.map((o, i) => (i + 1) + '. ' + o).join('\n');
}

function parseOption(text, opts) {
    const num = parseInt(text, 10);
    if (!isNaN(num) && num > 0 && num <= opts.length) {
        return opts[num - 1];
    }
    const lower = text.toLowerCase();
    for (let i = 0; i < opts.length; i++) {
        if (opts[i].toLowerCase() === lower) return opts[i];
    }
    return null;
}

function isValidName(text) {
    const t = text.trim();
    if (t.length < 3) return false;
    if (!/^[a-zA-Z\s.'-]+$/.test(t)) return false;
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length < 2) return false;
    return true;
}

function nameErrorMessage(text, fieldLabel) {
    const t = text.trim();
    if (/[0-9]/.test(t)) {
        return '"' + text + '" no es valido: no puede contener numeros. Escribe ' + fieldLabel + ' usando solo letras.';
    }
    if (t.length < 3) {
        return '"' + text + '" no es valido: es muy corto. Escribe ' + fieldLabel + ' completo (nombre y apellido).';
    }
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length < 2) {
        return '"' + text + '" no es valido: parece un solo nombre. Escribe ' + fieldLabel + ' completo (nombre y apellido).';
    }
    return '"' + text + '" no es valido. Escribe ' + fieldLabel + ' usando solo letras y espacios.';
}

function validatePhone(text) {
    const t = text.trim();
    const digits = t.replace(/[^0-9]/g, '');
    if (!/^[0-9+()\s-]+$/.test(t)) {
        return '"' + text + '" no es valido: un telefono solo puede tener numeros y opcionalmente +, espacios o guiones. Ej: +56912345678';
    }
    if (digits.length < 8 || digits.length > 13) {
        return '"' + text + '" no es valido: debe tener entre 8 y 13 digitos. Ej: +56912345678';
    }
    return null;
}

function getMessageText(msg) {
    if (msg.type === 'text') return (msg.text && msg.text.body) || '';
    if (msg.type === 'image') return (msg.image && msg.image.caption) || '';
    if (msg.type === 'document') return (msg.document && msg.document.caption) || '';
    if (msg.type === 'video') return (msg.video && msg.video.caption) || '';
    return '';
}

function messageHasMedia(msg) {
    return msg.type === 'image' || msg.type === 'video' || msg.type === 'document';
}

function getMediaId(msg) {
    if (msg.type === 'image') return msg.image && msg.image.id;
    if (msg.type === 'video') return msg.video && msg.video.id;
    if (msg.type === 'document') return msg.document && msg.document.id;
    return null;
}

async function handleIncomingMessage(msg) {
    const from = msg.from;
    console.log('Mensaje de ' + from + ' tipo=' + msg.type);

try {
    const text = (getMessageText(msg) || '').trim();
    const isMedia = messageHasMedia(msg);

    if (!sessions.has(from) || text.toLowerCase() === 'hola' || text.toLowerCase() === 'reiniciar') {
        sessions.set(from, { step: STEPS.MENU, data: {} });
        await sendText(from, 'Hola! Soy el asistente de IAsapre.\n\nQue necesitas hacer?\nResponde con el numero:\n' + formatOptions(['Registrar devolucion', 'Proyeccion de bolsa']));
        return;
    }

    const session = sessions.get(from);

    if (session.step === STEPS.MENU) {
        const menuMatch = parseOption(text, ['Registrar devolucion', 'Proyeccion de bolsa']);
        if (!menuMatch) {
            await sendText(from, '"' + text + '" no es valido. Responde solo con el numero:\n' + formatOptions(['Registrar devolucion', 'Proyeccion de bolsa']));
            return;
        }
        if (menuMatch === 'Registrar devolucion') {
            session.step = STEPS.GREETING;
            await sendText(from, 'Por favor, indicame tu *nombre completo* (Ejecutivo):');
        } else {
            session.step = STEPS.PROY_NOMBRE;
            await sendText(from, 'Indicame tu *nombre completo* (Ejecutivo):');
        }
    }
    else if (session.step === STEPS.GREETING) {
        if (!isValidName(text)) {
            await sendText(from, nameErrorMessage(text, 'tu nombre completo (Ejecutivo)'));
            return;
        }
        session.data.ejecutivo = text;
        session.step = STEPS.MES;
        await sendText(from, 'Gracias, ' + text + '. A que *mes* corresponde esta devolucion?\nResponde con el numero:\n' + formatOptions(validMeses));
    }
    else if (session.step === STEPS.MES) {
        const mesMatch = parseOption(text, validMeses);
        if (!mesMatch) {
            await sendText(from, '"' + text + '" no es valido: no corresponde a ninguna opcion de mes. Responde solo con el numero de la lista:\n' + formatOptions(validMeses));
            return;
        }
        session.data.mes = mesMatch;
        session.data.bolsa = 'N/A';
        session.step = STEPS.LEAD_NOMBRE;
        await sendText(from, 'Indicame el *nombre completo del lead*:');
    }
    else if (session.step === STEPS.LEAD_NOMBRE) {
        if (!isValidName(text)) {
            await sendText(from, nameErrorMessage(text, 'el nombre completo del lead'));
            return;
        }
        session.data.leadNombre = text;
        session.step = STEPS.LEAD_TELEFONO;
        await sendText(from, 'Indicame el *numero de telefono* del lead:');
    }
    else if (session.step === STEPS.LEAD_TELEFONO) {
        const phoneError = validatePhone(text);
        if (phoneError) {
            await sendText(from, phoneError);
            return;
        }
        session.data.leadTelefono = text;
        session.step = STEPS.HORAS;
        await sendText(from, 'Cuantas *horas* pasaron desde que recibiste el lead hasta que lo contactaste? (Solo el numero, ej: 12):');
    }
    else if (session.step === STEPS.HORAS) {
        const horas = parseInt(text, 10);
        if (isNaN(horas) || String(horas) !== text.trim() || horas < 0 || horas > 999) {
            await sendText(from, '"' + text + '" no es valido: debes responder solo con un numero entero entre 0 y 999 (las horas), sin letras ni simbolos. Ej: 12');
            return;
        }
        session.data.horasContacto = horas;
        session.step = STEPS.PROOF_CONTACTO;
        await sendText(from, 'Envia una *imagen* (captura) que acredite el contacto dentro de ese tiempo:');
    }
    else if (session.step === STEPS.PROOF_CONTACTO) {
        if (!isMedia) {
            await sendText(from, 'No recibi una imagen. Envia el archivo adjunto.');
            return;
        }
        try {
            const mediaId = getMediaId(msg);
            const { buffer, mimeType } = await downloadMedia(mediaId);
            const ext1 = (mimeType.split('/')[1] || 'jpg').split(';')[0];
            const name1 = 'contacto_' + from + '_' + Date.now() + '.' + ext1;
            const url1 = await db.uploadFile(name1, buffer, mimeType);
            session.data.urlContacto = url1;
        } catch (dlErr) {
            console.error('Error descargando media:', dlErr.message);
        }
        session.step = STEPS.CAUSAL;
        await sendText(from, 'Imagen recibida. Cual es la *causal*?\nResponde con el numero:\n' + formatOptions(validCausales));
    }
    else if (session.step === STEPS.CAUSAL) {
        const causalMatch = parseOption(text, validCausales);
        if (!causalMatch) {
            await sendText(from, '"' + text + '" no es valido: no corresponde a ninguna causal de la lista. Responde solo con el numero de la lista:\n' + formatOptions(validCausales));
            return;
        }
        session.data.causal = causalMatch;
        if (causalMatch === 'Falta de anualidad') {
            session.step = STEPS.PERMANENCIA;
            await sendText(from, 'Ingresa los meses de *permanencia* del afiliado (ej: 8):');
        } else {
            session.step = STEPS.PROOF_CAUSAL;
            await sendText(from, 'Envia el documento o captura que *acredite* esta causal (y mensaje de cierre si aplica):');
        }
    }
    else if (session.step === STEPS.PERMANENCIA) {
        const mesesP = parseInt(text, 10);
        if (isNaN(mesesP) || String(mesesP) !== text.trim() || mesesP < 0 || mesesP > 600) {
            await sendText(from, '"' + text + '" no es valido: debes responder solo con un numero entero (los meses de permanencia), sin letras ni simbolos. Ej: 8');
            return;
        }
        session.data.mesesPermanencia = mesesP;
        session.step = STEPS.PROOF_CAUSAL;
        await sendText(from, 'Envia el documento o captura que *acredite* esta causal (y mensaje de cierre):');
    }
    else if (session.step === STEPS.PROOF_CAUSAL) {
        if (!isMedia) {
            await sendText(from, 'Por favor envia el archivo adjunto.');
            return;
        }
        try {
            const mediaId = getMediaId(msg);
            const { buffer, mimeType } = await downloadMedia(mediaId);
            const ext2 = (mimeType.split('/')[1] || 'jpg').split(';')[0];
            const name2 = 'causal_' + from + '_' + Date.now() + '.' + ext2;
            const url2 = await db.uploadFile(name2, buffer, mimeType);
            session.data.urlCausal = url2;
        } catch (dlErr2) {
            console.error('Error descargando media:', dlErr2.message);
        }
        session.step = STEPS.DECLARACIONES;
        await sendText(from,
                       'Para finalizar, escribe *ACEPTO* para confirmar:\n' +
                       '1. Contacte al cotizante en < 24h.\n' +
                       '2. La informacion es veraz.\n' +
                       '3. Envie mensaje de cierre.\n' +
                       '4. No volvere a contactar a este lead.\n' +
                       '5. No usare los datos para otros fines.'
                       );
    }
    else if (session.step === STEPS.DECLARACIONES) {
        if (text.toLowerCase() !== 'acepto') {
            await sendText(from, '"' + text + '" no es valido: para finalizar debes escribir exactamente *ACEPTO*, confirmando las 5 declaraciones anteriores.');
            return;
        }
        await sendText(from, 'Procesando tu solicitud...');
        await evaluateAndSave(session.data, from);
        sessions.delete(from);
    }
    else if (session.step === STEPS.PROY_NOMBRE) {
        if (!isValidName(text)) {
            await sendText(from, nameErrorMessage(text, 'tu nombre completo (Ejecutivo)'));
            return;
        }
        session.data.ejecutivo = text;
        session.step = STEPS.PROY_MES;
        await sendText(from, 'Gracias, ' + text + '. Para que *mes* estas proyectando?\nResponde con el numero:\n' + formatOptions(validMeses));
    }
    else if (session.step === STEPS.PROY_MES) {
        const mesMatch = parseOption(text, validMeses);
        if (!mesMatch) {
            await sendText(from, '"' + text + '" no es valido: no corresponde a ninguna opcion de mes. Responde solo con el numero de la lista:\n' + formatOptions(validMeses));
            return;
        }
        session.data.mes = mesMatch;
        session.step = STEPS.PROY_CANTIDAD;
        const opcionesBolsas = BOLSA_VALUES.map((v, i) => {
            const acumulado = BOLSA_VALUES.slice(0, i + 1).map(formatCLP).join(' + ');
            return (i + 1) + ' bolsa' + (i > 0 ? 's' : '') + ' (' + acumulado + ')';
        });
        await sendText(from, 'Cuantas *bolsas* proyectas para ' + mesMatch + '?\nResponde con el numero:\n' + formatOptions(opcionesBolsas));
    }
    else if (session.step === STEPS.PROY_CANTIDAD) {
        const cantidad = parseInt(text, 10);
        if (isNaN(cantidad) || String(cantidad) !== text.trim() || cantidad < 1 || cantidad > BOLSA_VALUES.length) {
            await sendText(from, '"' + text + '" no es valido: responde solo con un numero entre 1 y ' + BOLSA_VALUES.length + ' (cantidad de bolsas).');
            return;
        }
        session.data.cantidadBolsas = cantidad;
        session.data.valorTotal = BOLSA_VALUES.slice(0, cantidad).reduce((a, b) => a + b, 0);
        session.step = STEPS.PROY_SEMANAS;
        await sendText(from, 'En que fin(es) de semana del mes esperas recibir los datos? Puedes elegir mas de uno separando con comas (ej: 1,3).\n' + formatOptions(WEEK_OPTIONS));
    }
    else if (session.step === STEPS.PROY_SEMANAS) {
        const partes = text.split(',').map((p) => p.trim()).filter(Boolean);
        const seleccionadas = [];
        let invalida = null;
        for (const p of partes) {
            const match = parseOption(p, WEEK_OPTIONS);
            if (!match) { invalida = p; break; }
            if (!seleccionadas.includes(match)) seleccionadas.push(match);
        }
        if (!partes.length || invalida) {
            await sendText(from, '"' + (invalida || text) + '" no es valido: responde con uno o mas numeros de la lista separados por coma (ej: 1,3).\n' + formatOptions(WEEK_OPTIONS));
            return;
        }
        session.data.semanas = seleccionadas;
        session.step = STEPS.PROY_CONFIRM;
        await sendText(from,
                       'Resumen de tu proyeccion:\n' +
                       '*Ejecutivo:* ' + session.data.ejecutivo + '\n' +
                       '*Mes:* ' + session.data.mes + '\n' +
                       '*Bolsas:* ' + session.data.cantidadBolsas + ' (' + formatCLP(session.data.valorTotal) + ')\n' +
                       '*Fin(es) de semana:* ' + seleccionadas.join(', ') + '\n\n' +
                       'Escribe *CONFIRMAR* para enviar esta proyeccion, o "reiniciar" para empezar de nuevo.'
                       );
    }
    else if (session.step === STEPS.PROY_CONFIRM) {
        if (text.toLowerCase() !== 'confirmar') {
            await sendText(from, '"' + text + '" no es valido: escribe *CONFIRMAR* para enviar la proyeccion, o "reiniciar" para empezar de nuevo.');
            return;
        }
        await sendText(from, 'Procesando tu proyeccion...');
        await evaluateAndSaveProjection(session.data, from);
        sessions.delete(from);
    }
} catch (e) {
    console.error('Error procesando mensaje:', e);
    try {
        await sendText(from, 'Error: ' + (e.message || 'desconocido') + '\nEscribe "reiniciar" para volver a empezar.');
    } catch (_) {}
}
}

// ============================================
// 4. EVALUACION Y GUARDADO
// ===========================================
async function evaluateAndSave(data, from) {
    let estado = 'PREAPROBADA';
    let motivo = 'Cumple con los criterios del protocolo IAsapre. Sujeto a revision por el equipo interno.';

if (data.horasContacto > 24) {
    estado = 'RECHAZADA';
    motivo = 'Contacto en ' + data.horasContacto + ' horas (Maximo 24h).';
} else if (data.causal === 'Falta de anualidad' && data.mesesPermanencia >= 10) {
    estado = 'RECHAZADA';
    motivo = 'Permanencia de ' + data.mesesPermanencia + ' meses (Maximo 9).';
} else if (data.causal === 'Whatsapp Invalido') {
    estado = 'REEMPLAZO';
    motivo = 'Numero invalido. Sera reemplazado (NO consume devolucion).';
}

if (estado !== 'REEMPLAZO') {
    const count = await db.getCountForBolsa(data.ejecutivo, data.bolsa);
    if (count >= 5) {
        estado = 'RECHAZADA';
        motivo = 'Limite de 5 devoluciones alcanzado.';
    }
}

const id = 'RET-' + Math.random().toString(36).substr(2, 9).toUpperCase();
    const fecha = new Date().toISOString();

try {
    await db.saveReturn({
        id, fecha,
        ejecutivo: data.ejecutivo,
        mes: data.mes,
        bolsa: data.bolsa || 'N/A',
        leadNombre: data.leadNombre,
        leadTelefono: data.leadTelefono,
        causal: data.causal,
        horasContacto: data.horasContacto,
        mesesPermanencia: data.mesesPermanencia || null,
        estado, motivo,
        comprobantes: JSON.stringify({
            contacto: data.urlContacto || null,
            causal: data.urlCausal || null
        })
    });

    await sendText(from, 'Devolucion ingresada (ID: ' + id + ').\n\nGracias por informarlo. Se revisara y tendras una respuesta en un maximo de 5 dias habiles.\n\nAnte cualquier duda, escribe a Nicolas Larrain: +56985380357 o nico@iasapre.cl');

    const adjuntos = [];
    if (data.urlContacto) adjuntos.push('Contacto: ' + data.urlContacto);
    if (data.urlCausal) adjuntos.push('Causal: ' + data.urlCausal);
    const adjStr = adjuntos.length > 0 ? '\n*Adjuntos:*\n' + adjuntos.join('\n') : '';

    await sendText(ADMIN_PHONE,
                   '*NUEVA DEVOLUCION*\n\n' +
                   '*ID:* ' + id + '\n' +
                   '*Ejecutivo:* ' + data.ejecutivo + '\n' +
                   '*Lead:* ' + data.leadNombre + ' (' + data.leadTelefono + ')\n' +
                   '*Mes:* ' + data.mes + '\n' +
                   '*Causal:* ' + data.causal + '\n' +
                   '*Horas:* ' + data.horasContacto + 'h\n' +
                   '*Permanencia:* ' + (data.mesesPermanencia || 'N/A') + '\n\n' +
                   '*Evaluacion:* ' + estado + '\n' +
                   '*Motivo:* ' + motivo + adjStr
                   );
} catch (err) {
    console.error('Error guardando:', err);
    await sendText(from, 'Error al guardar. Escribe "reiniciar" para intentar de nuevo.');
}
}

// ============================================
// 5. PROYECCION DE BOLSA - EVALUACION Y GUARDADO
// ===========================================
async function evaluateAndSaveProjection(data, from) {
    const id = 'PROY-' + Math.random().toString(36).substr(2, 9).toUpperCase();
    const fecha = new Date().toISOString();

try {
    await db.saveProjection({
        id, fecha,
        ejecutivo: data.ejecutivo,
        mes: data.mes,
        cantidadBolsas: data.cantidadBolsas,
        valorTotal: data.valorTotal,
        semanas: data.semanas.join(', ')
    });

    await sendText(from, 'Proyeccion registrada (ID: ' + id + ').\n\nGracias, ' + data.ejecutivo + '. Tu proyeccion de ' + data.cantidadBolsas + ' bolsa(s) para ' + data.mes + ' (' + formatCLP(data.valorTotal) + ') fue enviada correctamente.');

    await sendText(RAFAEL_PHONE,
                   '*NUEVA PROYECCION DE BOLSA*\n\n' +
                   '*ID:* ' + id + '\n' +
                   '*Ejecutivo:* ' + data.ejecutivo + '\n' +
                   '*Mes:* ' + data.mes + '\n' +
                   '*Bolsas:* ' + data.cantidadBolsas + '\n' +
                   '*Valor total:* ' + formatCLP(data.valorTotal) + '\n' +
                   '*Fin(es) de semana:* ' + data.semanas.join(', ')
                   );
} catch (err) {
    console.error('Error guardando proyeccion:', err);
    await sendText(from, 'Error al guardar. Escribe "reiniciar" para intentar de nuevo.');
}
}
