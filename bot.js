// ============================================================
// BOT WHATSAPP IASAPRE - v3.0 (WhatsApp Cloud API oficial de Meta)
// Sin Baileys, sin QR, sin sesión que se corrompa. Webhook + Graph API.
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
    console.warn('⚠️ Falta WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID en las variables de entorno. El bot no podrá enviar mensajes hasta que se configuren.');
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

// Verificación del webhook (Meta llama esto una vez al configurar la suscripción)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Webhook verificado por Meta.');
        return res.status(200).send(challenge);
    }
    console.log('❌ Verificación de webhook rechazada (token no coincide).');
    return res.sendStatus(403);
});

// Recepción de mensajes entrantes
app.post('/webhook', async (req, res) => {
    // Meta espera una respuesta 200 rápida; si no, reintenta la entrega.
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
    console.log('🚀 Servidor web en http://localhost:' + port);
});

// ==========================================
// 2. UTILIDADES DE ENVÍO / DESCARGA (GRAPH API)
// ==========================================
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
        console.error('   -> ERROR enviando mensaje a ' + to + ': ' + JSON.stringify(data));
        throw new Error((data.error && data.error.message) || 'Error enviando mensaje');
    }
    console.log('   -> Mensaje enviado a ' + to + '. id=' + (data.messages && data.messages[0] && data.messages[0].id));
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

// ==========================================
// 3. LÓGICA DEL BOT (sesiones y validaciones)
// ==========================================
const sessions = new Map();

const STEPS = {
    GREETING: 0,
    MES: 1,
    LEAD_NOMBRE: 2,
    LEAD_TELEFONO: 3,
    HORAS: 4,
    PROOF_CONTACTO: 5,
    CAUSAL: 6,
    PERMANENCIA: 7,
    PROOF_CAUSAL: 8,
    DECLARACIONES: 9
};

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
    if (!/^[a-zA-ZÀ-ÿ\s.'-]+$/.test(t)) return false;
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length < 2) return false;
    return true;
}

function nameErrorMessage(text, fieldLabel) {
    const t = text.trim();
    if (/[0-9]/.test(t)) {
        return '❌ "' + text + '" no es válido: no puede contener números. Escribe ' + fieldLabel + ' usando solo letras.';
    }
    if (t.length < 3) {
        return '❌ "' + text + '" no es válido: es muy corto. Escribe ' + fieldLabel + ' completo (nombre y apellido).';
    }
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length < 2) {
        return '❌ "' + text + '" no es válido: parece un solo nombre. Escribe ' + fieldLabel + ' completo (nombre y apellido).';
    }
    return '❌ "' + text + '" no es válido. Escribe ' + fieldLabel + ' usando solo letras y espacios.';
}

function validatePhone(text) {
    const t = text.trim();
    const digits = t.replace(/[^0-9]/g, '');
    if (!/^[0-9+()\s-]+$/.test(t)) {
        return '❌ "' + text + '" no es válido: un teléfono solo puede tener números y opcionalmente +, espacios o guiones. Ej: +56912345678';
    }
    if (digits.length < 8 || digits.length > 13) {
        return '❌ "' + text + '" no es válido: debe tener entre 8 y 13 dígitos. Ej: +56912345678';
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
    const from = msg.from; // número en formato E.164 sin '+', ej: 56912345678
    console.log('📩 Mensaje de ' + from + ' tipo=' + msg.type);

    try {
        const text = (getMessageText(msg) || '').trim();
        const isMedia = messageHasMedia(msg);

        // Iniciar o reiniciar sesión
        if (!sessions.has(from) || text.toLowerCase() === 'hola' || text.toLowerCase() === 'reiniciar') {
            sessions.set(from, { step: STEPS.GREETING, data: {} });
            await sendText(from, '¡Hola! Soy el asistente de devoluciones de IAsapre 🤖.\nPor favor, indícame tu *nombre completo* (Ejecutivo):');
            return;
        }

        const session = sessions.get(from);

        if (session.step === STEPS.GREETING) {
            if (!isValidName(text)) {
                await sendText(from, nameErrorMessage(text, 'tu nombre completo (Ejecutivo)'));
                return;
            }
            session.data.ejecutivo = text;
            session.step = STEPS.MES;
            await sendText(from, 'Gracias, ' + text + '. ¿A qué *mes* corresponde esta devolución?\nResponde con el número:\n' + formatOptions(validMeses));
        }
        else if (session.step === STEPS.MES) {
            const mesMatch = parseOption(text, validMeses);
            if (!mesMatch) {
                await sendText(from, '❌ "' + text + '" no es válido: no corresponde a ninguna opción de mes. Responde solo con el número de la lista:\n' + formatOptions(validMeses));
                return;
            }
            session.data.mes = mesMatch;
            session.data.bolsa = 'N/A';
            session.step = STEPS.LEAD_NOMBRE;
            await sendText(from, 'Indícame el *nombre completo del lead*:');
        }
        else if (session.step === STEPS.LEAD_NOMBRE) {
            if (!isValidName(text)) {
                await sendText(from, nameErrorMessage(text, 'el nombre completo del lead'));
                return;
            }
            session.data.leadNombre = text;
            session.step = STEPS.LEAD_TELEFONO;
            await sendText(from, 'Indícame el *número de teléfono* del lead:');
        }
        else if (session.step === STEPS.LEAD_TELEFONO) {
            const phoneError = validatePhone(text);
            if (phoneError) {
                await sendText(from, phoneError);
                return;
            }
            session.data.leadTelefono = text;
            session.step = STEPS.HORAS;
            await sendText(from, '¿Cuántas *horas* pasaron desde que recibiste el lead hasta que lo contactaste? (Solo el número, ej: 12):');
        }
        else if (session.step === STEPS.HORAS) {
            const horas = parseInt(text, 10);
            if (isNaN(horas) || String(horas) !== text.trim() || horas < 0 || horas > 999) {
                await sendText(from, '❌ "' + text + '" no es válido: debes responder solo con un número entero entre 0 y 999 (las horas), sin letras ni símbolos. Ej: 12');
                return;
            }
            session.data.horasContacto = horas;
            session.step = STEPS.PROOF_CONTACTO;
            await sendText(from, 'Envía una *imagen* (captura) que acredite el contacto dentro de ese tiempo:');
        }
        else if (session.step === STEPS.PROOF_CONTACTO) {
            if (!isMedia) {
                await sendText(from, 'No recibí una imagen. Envía el archivo adjunto.');
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
            await sendText(from, 'Imagen recibida ✅. ¿Cuál es la *causal*?\nResponde con el número:\n' + formatOptions(validCausales));
        }
        else if (session.step === STEPS.CAUSAL) {
            const causalMatch = parseOption(text, validCausales);
            if (!causalMatch) {
                await sendText(from, '❌ "' + text + '" no es válido: no corresponde a ninguna causal de la lista. Responde solo con el número de la lista:\n' + formatOptions(validCausales));
                return;
            }
            session.data.causal = causalMatch;
            if (causalMatch === 'Falta de anualidad') {
                session.step = STEPS.PERMANENCIA;
                await sendText(from, 'Ingresa los meses de *permanencia* del afiliado (ej: 8):');
            } else {
                session.step = STEPS.PROOF_CAUSAL;
                await sendText(from, 'Envía el documento o captura que *acredite* esta causal (y mensaje de cierre si aplica):');
            }
        }
        else if (session.step === STEPS.PERMANENCIA) {
            const mesesP = parseInt(text, 10);
            if (isNaN(mesesP) || String(mesesP) !== text.trim() || mesesP < 0 || mesesP > 600) {
                await sendText(from, '❌ "' + text + '" no es válido: debes responder solo con un número entero (los meses de permanencia), sin letras ni símbolos. Ej: 8');
                return;
            }
            session.data.mesesPermanencia = mesesP;
            session.step = STEPS.PROOF_CAUSAL;
            await sendText(from, 'Envía el documento o captura que *acredite* esta causal (y mensaje de cierre):');
        }
        else if (session.step === STEPS.PROOF_CAUSAL) {
            if (!isMedia) {
                await sendText(from, 'Por favor envía el archivo adjunto.');
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
                '1. Contacté al cotizante en < 24h.\n' +
                '2. La información es veraz.\n' +
                '3. Envié mensaje de cierre.\n' +
                '4. No volveré a contactar a este lead.\n' +
                '5. No usaré los datos para otros fines.'
            );
        }
        else if (session.step === STEPS.DECLARACIONES) {
            if (text.toLowerCase() !== 'acepto') {
                await sendText(from, '❌ "' + text + '" no es válido: para finalizar debes escribir exactamente *ACEPTO*, confirmando las 5 declaraciones anteriores.');
                return;
            }
            await sendText(from, 'Procesando tu solicitud...');
            await evaluateAndSave(session.data, from);
            sessions.delete(from);
        }
    } catch (e) {
        console.error('Error procesando mensaje:', e);
        try {
            await sendText(from, '❌ Error: ' + (e.message || 'desconocido') + '\nEscribe "reiniciar" para volver a empezar.');
        } catch (_) {}
    }
}

// ==========================================
// 4. EVALUACIÓN Y GUARDADO
// ==========================================
async function evaluateAndSave(data, from) {
    let estado = 'PREAPROBADA';
    let motivo = 'Cumple con los criterios del protocolo IAsapre. Sujeto a revisión por el equipo interno.';

    if (data.horasContacto > 24) {
        estado = 'RECHAZADA';
        motivo = 'Contacto en ' + data.horasContacto + ' horas (Máximo 24h).';
    } else if (data.causal === 'Falta de anualidad' && data.mesesPermanencia >= 10) {
        estado = 'RECHAZADA';
        motivo = 'Permanencia de ' + data.mesesPermanencia + ' meses (Máximo 9).';
    } else if (data.causal === 'Whatsapp Inválido') {
        estado = 'REEMPLAZO';
        motivo = 'Número inválido. Será reemplazado (NO consume devolución).';
    }

    if (estado !== 'REEMPLAZO') {
        const count = await db.getCountForBolsa(data.ejecutivo, data.bolsa);
        if (count >= 5) {
            estado = 'RECHAZADA';
            motivo = 'Límite de 5 devoluciones alcanzado.';
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

        await sendText(from, '✅ Devolución ingresada (ID: ' + id + ').\n\nGracias por informarlo. Se revisará y tendrás una respuesta en un máximo de 5 días hábiles.\n\nAnte cualquier duda, escribe a Nicolás Larraín: +56985380357 o nico@iasapre.cl');

        // Notificar al administrador
        const adjuntos = [];
        if (data.urlContacto) adjuntos.push('Contacto: ' + data.urlContacto);
        if (data.urlCausal) adjuntos.push('Causal: ' + data.urlCausal);
        const adjStr = adjuntos.length > 0 ? '\n*Adjuntos:*\n' + adjuntos.join('\n') : '';

        await sendText(ADMIN_PHONE,
            '🚨 *NUEVA DEVOLUCIÓN*\n\n' +
            '*ID:* ' + id + '\n' +
            '*Ejecutivo:* ' + data.ejecutivo + '\n' +
            '*Lead:* ' + data.leadNombre + ' (' + data.leadTelefono + ')\n' +
            '*Mes:* ' + data.mes + '\n' +
            '*Causal:* ' + data.causal + '\n' +
            '*Horas:* ' + data.horasContacto + 'h\n' +
            '*Permanencia:* ' + (data.mesesPermanencia || 'N/A') + '\n\n' +
            '*Evaluación:* ' + estado + '\n' +
            '*Motivo:* ' + motivo + adjStr
        );
    } catch (err) {
        console.error('Error guardando:', err);
        await sendText(from, '❌ Error al guardar. Escribe "reiniciar" para intentar de nuevo.');
    }
}
