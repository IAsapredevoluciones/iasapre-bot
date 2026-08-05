// ============================================================
// BOT WHATSAPP IASAPRE - v2.0 (Baileys, sin Chromium)
// Consume ~50MB de RAM. Funciona en Render Starter ($7/mes).
// ============================================================

import makeWASocket from '@whiskeysockets/baileys';
import { useMultiFileAuthState, DisconnectReason, downloadMediaMessage, getContentType } from '@whiskeysockets/baileys';
import pkg from '@hapi/boom';
const { Boom } = pkg;
import pino from 'pino';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import * as db from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================
// 1. SERVIDOR WEB (QR + API)
// ==========================================
const app = express();
const port = process.env.PORT || 10000;

let currentQR = '';
let botStatus = 'Iniciando servidor...';

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

app.get('/qr', async (req, res) => {
    if (botStatus === 'Conectado y listo') {
        return res.send(
            '<h1 style="text-align:center;margin-top:50px;color:green;font-family:sans-serif;">' +
            '✅ El bot ya está conectado y funcionando.</h1>'
        );
    }
    if (currentQR) {
        try {
            const qrDataUrl = await QRCode.toDataURL(currentQR);
            return res.send(
                '<div style="text-align:center;margin-top:50px;font-family:sans-serif;">' +
                '<h2>Escanea este código con tu WhatsApp</h2>' +
                '<img src="' + qrDataUrl + '" style="width:400px;height:400px;" />' +
                '<p style="font-size:20px;">Estado: <b style="color:blue;">' + botStatus + '</b></p>' +
                '<p><i>Se actualiza sola cada 10 segundos.</i></p>' +
                '<script>setTimeout(function(){location.reload()},10000);</script>' +
                '</div>'
            );
        } catch (e) {
            return res.send('<h1>Error generando QR</h1>');
        }
    }
    res.send(
        '<div style="text-align:center;margin-top:50px;font-family:sans-serif;">' +
        '<h1>Estado: <span style="color:orange;">' + botStatus + '</span></h1>' +
        '<p>Espera, se recarga sola...</p>' +
        '<script>setTimeout(function(){location.reload()},5000);</script>' +
        '</div>'
    );
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', bot: botStatus });
});

app.listen(port, () => {
    console.log('🚀 Servidor web en http://localhost:' + port);
});

// ==========================================
// 2. LÓGICA DEL BOT (BAILEYS)
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
    if (!msg.message) return '';
    const type = getContentType(msg.message);
    if (type === 'conversation') return msg.message.conversation || '';
    if (type === 'extendedTextMessage') return (msg.message.extendedTextMessage || {}).text || '';
    if (type === 'imageMessage') return (msg.message.imageMessage || {}).caption || '';
    if (type === 'documentMessage') return (msg.message.documentMessage || {}).caption || '';
    return '';
}

function messageHasMedia(msg) {
    if (!msg.message) return false;
    const type = getContentType(msg.message);
    return type === 'imageMessage' || type === 'videoMessage' || type === 'documentMessage';
}

let sock = null;

async function connectToWhatsApp() {
    const authDir = path.join(__dirname, 'auth_info');
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    sock = makeWASocket.default
        ? makeWASocket.default({ auth: state, printQRInTerminal: true, logger: pino({ level: 'silent' }), browser: ['IAsapre Bot', 'Chrome', '22.0'], connectTimeoutMs: 60000, defaultQueryTimeoutMs: 0, keepAliveIntervalMs: 30000, markOnlineOnConnect: true })
        : makeWASocket({ auth: state, printQRInTerminal: true, logger: pino({ level: 'silent' }), browser: ['IAsapre Bot', 'Chrome', '22.0'], connectTimeoutMs: 60000, defaultQueryTimeoutMs: 0, keepAliveIntervalMs: 30000, markOnlineOnConnect: true });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentQR = qr;
            botStatus = 'Esperando escaneo de QR...';
            console.log('📱 QR generado. Escanéalo en /qr');
        }

        if (connection === 'close') {
            currentQR = '';
            const boom = new Boom(lastDisconnect?.error);
            const code = boom.output?.statusCode || 0;
            const reconnect = code !== DisconnectReason.loggedOut;
            console.log('⚠️ Conexión cerrada (código ' + code + '). Reconectar: ' + reconnect);
            botStatus = 'Reconectando...';
            if (reconnect) {
                setTimeout(connectToWhatsApp, 3000);
            } else {
                botStatus = 'Sesión cerrada. Reinicia el servidor.';
            }
        }

        if (connection === 'open') {
            currentQR = '';
            botStatus = 'Conectado y listo';
            console.log('✅ Bot conectado y listo.');
        }
    });

    sock.ev.on('messages.upsert', async (upsert) => {
        if (upsert.type !== 'notify') return;

        for (const msg of upsert.messages) {
            try {
                if (msg.key.fromMe) continue;
                if (msg.key.remoteJid === 'status@broadcast') continue;
                if (!msg.message) continue;

                const from = msg.key.remoteJid;
                const text = (getMessageText(msg) || '').trim();
                const isMedia = messageHasMedia(msg);

                // Iniciar o reiniciar sesión
                if (!sessions.has(from) || text.toLowerCase() === 'hola' || text.toLowerCase() === 'reiniciar') {
                    sessions.set(from, { step: STEPS.GREETING, data: {} });
                    await sock.sendMessage(from, {
                        text: '¡Hola! Soy el asistente de devoluciones de IAsapre 🤖.\nPor favor, indícame tu *nombre completo* (Ejecutivo):'
                    });
                    continue;
                }

                const session = sessions.get(from);

                if (session.step === STEPS.GREETING) {
                    if (!isValidName(text)) {
                        await sock.sendMessage(from, { text: nameErrorMessage(text, 'tu nombre completo (Ejecutivo)') });
                        continue;
                    }
                    session.data.ejecutivo = text;
                    session.step = STEPS.MES;
                    await sock.sendMessage(from, {
                        text: 'Gracias, ' + text + '. ¿A qué *mes* corresponde esta devolución?\nResponde con el número:\n' + formatOptions(validMeses)
                    });
                }
                else if (session.step === STEPS.MES) {
                    const mesMatch = parseOption(text, validMeses);
                    if (!mesMatch) {
                        await sock.sendMessage(from, { text: '❌ "' + text + '" no es válido: no corresponde a ninguna opción de mes. Responde solo con el número de la lista:\n' + formatOptions(validMeses) });
                        continue;
                    }
                    session.data.mes = mesMatch;
                    session.data.bolsa = 'N/A';
                    session.step = STEPS.LEAD_NOMBRE;
                    await sock.sendMessage(from, { text: 'Indícame el *nombre completo del lead*:' });
                }
                else if (session.step === STEPS.LEAD_NOMBRE) {
                    if (!isValidName(text)) {
                        await sock.sendMessage(from, { text: nameErrorMessage(text, 'el nombre completo del lead') });
                        continue;
                    }
                    session.data.leadNombre = text;
                    session.step = STEPS.LEAD_TELEFONO;
                    await sock.sendMessage(from, { text: 'Indícame el *número de teléfono* del lead:' });
                }
                else if (session.step === STEPS.LEAD_TELEFONO) {
                    const phoneError = validatePhone(text);
                    if (phoneError) {
                        await sock.sendMessage(from, { text: phoneError });
                        continue;
                    }
                    session.data.leadTelefono = text;
                    session.step = STEPS.HORAS;
                    await sock.sendMessage(from, {
                        text: '¿Cuántas *horas* pasaron desde que recibiste el lead hasta que lo contactaste? (Solo el número, ej: 12):'
                    });
                }
                else if (session.step === STEPS.HORAS) {
                    const horas = parseInt(text, 10);
                    if (isNaN(horas) || String(horas) !== text.trim() || horas < 0 || horas > 999) {
                        await sock.sendMessage(from, { text: '❌ "' + text + '" no es válido: debes responder solo con un número entero entre 0 y 999 (las horas), sin letras ni símbolos. Ej: 12' });
                        continue;
                    }
                    session.data.horasContacto = horas;
                    session.step = STEPS.PROOF_CONTACTO;
                    await sock.sendMessage(from, {
                        text: 'Envía una *imagen* (captura) que acredite el contacto dentro de ese tiempo:'
                    });
                }
                else if (session.step === STEPS.PROOF_CONTACTO) {
                    if (!isMedia) {
                        await sock.sendMessage(from, { text: 'No recibí una imagen. Envía el archivo adjunto.' });
                        continue;
                    }
                    try {
                        const buffer1 = await downloadMediaMessage(msg, 'buffer', {}, {
                            logger: pino({ level: 'silent' }),
                            reuploadRequest: sock.updateMediaMessage
                        });
                        const type1 = getContentType(msg.message);
                        const mime1 = msg.message[type1]?.mimetype || 'image/jpeg';
                        const ext1 = (mime1.split('/')[1] || 'jpg').split(';')[0];
                        const name1 = 'contacto_' + from.split('@')[0] + '_' + Date.now() + '.' + ext1;
                        const url1 = await db.uploadFile(name1, buffer1, mime1);
                        session.data.urlContacto = url1;
                    } catch (dlErr) {
                        console.error('Error descargando media:', dlErr.message);
                    }
                    session.step = STEPS.CAUSAL;
                    await sock.sendMessage(from, {
                        text: 'Imagen recibida ✅. ¿Cuál es la *causal*?\nResponde con el número:\n' + formatOptions(validCausales)
                    });
                }
                else if (session.step === STEPS.CAUSAL) {
                    const causalMatch = parseOption(text, validCausales);
                    if (!causalMatch) {
                        await sock.sendMessage(from, { text: '❌ "' + text + '" no es válido: no corresponde a ninguna causal de la lista. Responde solo con el número de la lista:\n' + formatOptions(validCausales) });
                        continue;
                    }
                    session.data.causal = causalMatch;
                    if (causalMatch === 'Falta de anualidad') {
                        session.step = STEPS.PERMANENCIA;
                        await sock.sendMessage(from, { text: 'Ingresa los meses de *permanencia* del afiliado (ej: 8):' });
                    } else {
                        session.step = STEPS.PROOF_CAUSAL;
                        await sock.sendMessage(from, {
                            text: 'Envía el documento o captura que *acredite* esta causal (y mensaje de cierre si aplica):'
                        });
                    }
                }
                else if (session.step === STEPS.PERMANENCIA) {
                    const mesesP = parseInt(text, 10);
                    if (isNaN(mesesP) || String(mesesP) !== text.trim() || mesesP < 0 || mesesP > 600) {
                        await sock.sendMessage(from, { text: '❌ "' + text + '" no es válido: debes responder solo con un número entero (los meses de permanencia), sin letras ni símbolos. Ej: 8' });
                        continue;
                    }
                    session.data.mesesPermanencia = mesesP;
                    session.step = STEPS.PROOF_CAUSAL;
                    await sock.sendMessage(from, {
                        text: 'Envía el documento o captura que *acredite* esta causal (y mensaje de cierre):'
                    });
                }
                else if (session.step === STEPS.PROOF_CAUSAL) {
                    if (!isMedia) {
                        await sock.sendMessage(from, { text: 'Por favor envía el archivo adjunto.' });
                        continue;
                    }
                    try {
                        const buffer2 = await downloadMediaMessage(msg, 'buffer', {}, {
                            logger: pino({ level: 'silent' }),
                            reuploadRequest: sock.updateMediaMessage
                        });
                        const type2 = getContentType(msg.message);
                        const mime2 = msg.message[type2]?.mimetype || 'image/jpeg';
                        const ext2 = (mime2.split('/')[1] || 'jpg').split(';')[0];
                        const name2 = 'causal_' + from.split('@')[0] + '_' + Date.now() + '.' + ext2;
                        const url2 = await db.uploadFile(name2, buffer2, mime2);
                        session.data.urlCausal = url2;
                    } catch (dlErr2) {
                        console.error('Error descargando media:', dlErr2.message);
                    }
                    session.step = STEPS.DECLARACIONES;
                    await sock.sendMessage(from, {
                        text: 'Para finalizar, escribe *ACEPTO* para confirmar:\n' +
                            '1. Contacté al cotizante en < 24h.\n' +
                            '2. La información es veraz.\n' +
                            '3. Envié mensaje de cierre.\n' +
                            '4. No volveré a contactar a este lead.\n' +
                            '5. No usaré los datos para otros fines.'
                    });
                }
                else if (session.step === STEPS.DECLARACIONES) {
                    if (text.toLowerCase() !== 'acepto') {
                        await sock.sendMessage(from, { text: '❌ "' + text + '" no es válido: para finalizar debes escribir exactamente *ACEPTO*, confirmando las 5 declaraciones anteriores.' });
                        continue;
                    }
                    await sock.sendMessage(from, { text: 'Procesando tu solicitud...' });
                    await evaluateAndSave(session.data, from);
                    sessions.delete(from);
                }

            } catch (e) {
                console.error('Error procesando mensaje:', e);
                try {
                    await sock.sendMessage(msg.key.remoteJid, {
                        text: '❌ Error: ' + (e.message || 'desconocido') + '\nEscribe "reiniciar" para volver a empezar.'
                    });
                } catch (_) {}
            }
        }
    });
}

// ==========================================
// 3. EVALUACIÓN Y GUARDADO
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
    } else if (data.causal === 'Whatsapp Invalido') {
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

        await sock.sendMessage(from, {
            text: '✅ Devolución ingresada (ID: ' + id + ').\n\nGracias por informarlo. Se revisará y tendrás una respuesta en un máximo de 5 días hábiles.\n\nAnte cualquier duda, escribe a Nicolás Larraín: +56985380357 o nico@iasapre.cl'
        });

        // Notificar al administrador
        const adminJid = '56985380357@s.whatsapp.net';
        const adjuntos = [];
        if (data.urlContacto) adjuntos.push('Contacto: ' + data.urlContacto);
        if (data.urlCausal) adjuntos.push('Causal: ' + data.urlCausal);
        const adjStr = adjuntos.length > 0 ? '\n*Adjuntos:*\n' + adjuntos.join('\n') : '';

        await sock.sendMessage(adminJid, {
            text: '🚨 *NUEVA DEVOLUCIÓN*\n\n' +
                '*ID:* ' + id + '\n' +
                '*Ejecutivo:* ' + data.ejecutivo + '\n' +
                '*Lead:* ' + data.leadNombre + ' (' + data.leadTelefono + ')\n' +
                '*Mes:* ' + data.mes + '\n' +
                '*Causal:* ' + data.causal + '\n' +
                '*Horas:* ' + data.horasContacto + 'h\n' +
                '*Permanencia:* ' + (data.mesesPermanencia || 'N/A') + '\n\n' +
                '*Evaluación:* ' + estado + '\n' +
                '*Motivo:* ' + motivo + adjStr
        });
    } catch (err) {
        console.error('Error guardando:', err);
        await sock.sendMessage(from, {
            text: '❌ Error al guardar. Escribe "reiniciar" para intentar de nuevo.'
        });
    }
}

// ==========================================
// 4. ARRANCAR
// ==========================================
connectToWhatsApp();
