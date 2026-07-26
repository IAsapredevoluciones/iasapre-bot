const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage, getContentType } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const express = require('express');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');
const db = require('./database');

// ==========================================
// 1. EXPRESS WEB SERVER (DASHBOARD + QR)
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
        res.send('<h1 style="text-align:center; margin-top:50px; color: green; font-family: sans-serif;">✅ El bot ya está conectado y funcionando. No necesitas escanear nada.</h1>');
    } else if (currentQR) {
        try {
            const qrImage = await QRCode.toDataURL(currentQR);
            res.send(`
                <div style="text-align: center; margin-top: 50px; font-family: sans-serif;">
                    <h2>Escanea este código con tu WhatsApp</h2>
                    <img src="${qrImage}" alt="QR Code" style="width: 400px; height: 400px;" />
                    <p style="font-size: 20px;">Estado actual: <b style="color: blue;">${botStatus}</b></p>
                    <p><i>Esta página se actualiza sola cada 10 segundos.</i></p>
                    <script>setTimeout(() => location.reload(), 10000);</script>
                </div>
            `);
        } catch (e) {
            res.send('<h1>Error generando QR</h1>');
        }
    } else {
        res.send(`
            <div style="text-align: center; margin-top: 50px; font-family: sans-serif;">
                <h1>Estado: <span style="color: orange;">${botStatus}</span></h1>
                <p>Por favor espera, la página se recargará sola...</p>
                <script>setTimeout(() => location.reload(), 5000);</script>
            </div>
        `);
    }
});

// Health check para UptimeRobot u otros monitores
app.get('/health', (req, res) => {
    res.json({ status: 'ok', bot: botStatus });
});

app.listen(port, () => {
    console.log(`🚀 Dashboard web disponible en http://localhost:${port}`);
});

// ==========================================
// 2. WHATSAPP BOT CON BAILEYS (SIN CHROMIUM)
// ==========================================

// Máquina de estados para la conversación
const sessions = new Map();

const STEPS = {
    GREETING: 0,
    MES: 1,
    LEAD_NOMBRE: 3,
    LEAD_TELEFONO: 4,
    HORAS: 5,
    PROOF_CONTACTO: 6,
    CAUSAL: 7,
    PERMANENCIA: 8,
    PROOF_CAUSAL: 9,
    DECLARACIONES: 10
};

const validMeses = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];
const validCausales = ['Falta de anualidad', 'Whatsapp Invalido', 'Preexistencia no afiliable', 'Pre o post natal', 'Renta inferior a $900.000'];

function formatOptions(options) {
    return options.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
}

function parseOption(text, options) {
    const num = parseInt(text);
    if (!isNaN(num) && num > 0 && num <= options.length) {
        return options[num - 1];
    }
    return options.find(o => o.toLowerCase() === text.toLowerCase());
}

// Función auxiliar para obtener el texto de un mensaje
function getMessageText(msg) {
    const messageType = getContentType(msg.message);
    if (messageType === 'conversation') return msg.message.conversation;
    if (messageType === 'extendedTextMessage') return msg.message.extendedTextMessage?.text;
    if (messageType === 'imageMessage') return msg.message.imageMessage?.caption || '';
    if (messageType === 'documentMessage') return msg.message.documentMessage?.caption || '';
    return '';
}

// Función auxiliar para verificar si el mensaje tiene media
function hasMedia(msg) {
    const messageType = getContentType(msg.message);
    return ['imageMessage', 'videoMessage', 'documentMessage'].includes(messageType);
}

let sock = null; // Referencia global al socket

async function connectToWhatsApp() {
    const authDir = path.join(__dirname, 'auth_info');
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ['IAsapre Bot', 'Chrome', '22.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 30000,
        markOnlineOnConnect: true,
    });

    // Guardar credenciales cuando se actualicen
    sock.ev.on('creds.update', saveCreds);

    // Manejar actualizaciones de conexión
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentQR = qr;
            botStatus = 'Esperando escaneo de QR...';
            console.log('📱 Nuevo QR generado. Escanéalo en /qr');
        }

        if (connection === 'close') {
            currentQR = '';
            const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`⚠️ Conexión cerrada. Código: ${statusCode}. Reconectando: ${shouldReconnect}`);
            botStatus = 'Reconectando...';
            if (shouldReconnect) {
                setTimeout(() => connectToWhatsApp(), 3000);
            } else {
                botStatus = 'Sesión cerrada. Reinicia el servidor para volver a escanear.';
            }
        }

        if (connection === 'open') {
            currentQR = '';
            botStatus = 'Conectado y listo';
            console.log('✅ Bot de WhatsApp conectado y listo para recibir mensajes.');
        }
    });

    // Manejar mensajes entrantes
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            try {
                // Ignorar mensajes propios y de status
                if (msg.key.fromMe) continue;
                if (msg.key.remoteJid === 'status@broadcast') continue;
                if (!msg.message) continue;

                const from = msg.key.remoteJid;
                const text = (getMessageText(msg) || '').trim();
                const isMedia = hasMedia(msg);

                // Inicializar sesión si no existe o si escribe "hola" / "reiniciar"
                if (!sessions.has(from) || text.toLowerCase() === 'hola' || text.toLowerCase() === 'reiniciar') {
                    sessions.set(from, { step: STEPS.GREETING, data: { adjuntos: [] } });
                    await sock.sendMessage(from, { text: '¡Hola! Soy el asistente de devoluciones de IAsapre 🤖.\nPor favor, indícame tu *nombre completo* (Ejecutivo):' });
                    continue;
                }

                const session = sessions.get(from);

                switch (session.step) {
                    case STEPS.GREETING:
                        session.data.ejecutivo = text;
                        session.step = STEPS.MES;
                        await sock.sendMessage(from, { text: `Gracias, ${text}. ¿A qué *mes* corresponde esta devolución?\nResponde con el número de la opción:\n${formatOptions(validMeses)}` });
                        break;

                    case STEPS.MES: {
                        const mesMatch = parseOption(text, validMeses);
                        if (!mesMatch) {
                            await sock.sendMessage(from, { text: 'Por favor, responde con el número de un mes válido de la lista:\n' + formatOptions(validMeses) });
                            continue;
                        }
                        session.data.mes = mesMatch;
                        session.data.bolsa = 'N/A';
                        session.step = STEPS.LEAD_NOMBRE;
                        await sock.sendMessage(from, { text: 'Por favor, indícame el *nombre completo del lead*:' });
                        break;
                    }

                    case STEPS.LEAD_NOMBRE:
                        session.data.leadNombre = text;
                        session.step = STEPS.LEAD_TELEFONO;
                        await sock.sendMessage(from, { text: 'Indícame el *número de teléfono* del lead:' });
                        break;

                    case STEPS.LEAD_TELEFONO:
                        session.data.leadTelefono = text;
                        session.step = STEPS.HORAS;
                        await sock.sendMessage(from, { text: '¿Cuántas *horas* pasaron desde que recibiste el lead hasta que lo contactaste? (Escribe solo el número, ej: 12, 25):' });
                        break;

                    case STEPS.HORAS: {
                        const horas = parseInt(text);
                        if (isNaN(horas)) {
                            await sock.sendMessage(from, { text: 'Por favor, ingresa solo un número válido.' });
                            continue;
                        }
                        session.data.horasContacto = horas;
                        session.step = STEPS.PROOF_CONTACTO;
                        await sock.sendMessage(from, { text: 'Sube/Envía una imagen (captura de pantalla) que acredite el contacto dentro de ese tiempo:' });
                        break;
                    }

                    case STEPS.PROOF_CONTACTO: {
                        if (!isMedia) {
                            await sock.sendMessage(from, { text: 'No he recibido una imagen/archivo. Por favor envía el adjunto para continuar.' });
                            continue;
                        }
                        const buffer1 = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
                        if (buffer1) {
                            const messageType = getContentType(msg.message);
                            const mimeType = msg.message[messageType]?.mimetype || 'image/jpeg';
                            const ext = mimeType.split('/')[1] || 'jpg';
                            const uniqueFilename = `contacto_${from.split('@')[0]}_${Date.now()}.${ext}`;
                            const url = await db.uploadFile(uniqueFilename, buffer1, mimeType);
                            session.data.urlContacto = url;
                        }
                        session.step = STEPS.CAUSAL;
                        await sock.sendMessage(from, { text: 'Imagen recibida ✅. ¿Cuál es la *causal* de la devolución?\nResponde con el número de la opción:\n' + formatOptions(validCausales) });
                        break;
                    }

                    case STEPS.CAUSAL: {
                        const causalMatch = parseOption(text, validCausales);
                        if (!causalMatch) {
                            await sock.sendMessage(from, { text: 'Causal no válida. Responde con el número de la opción:\n' + formatOptions(validCausales) });
                            continue;
                        }
                        session.data.causal = causalMatch;

                        if (causalMatch === 'Falta de anualidad') {
                            session.step = STEPS.PERMANENCIA;
                            await sock.sendMessage(from, { text: 'Ingresa los meses de *permanencia* del afiliado (ej: 8, 10):' });
                        } else {
                            session.step = STEPS.PROOF_CAUSAL;
                            await sock.sendMessage(from, { text: 'Sube/Envía el documento o captura que *acredite* esta causal (y el mensaje de cierre si aplica):' });
                        }
                        break;
                    }

                    case STEPS.PERMANENCIA: {
                        const meses = parseInt(text);
                        if (isNaN(meses)) {
                            await sock.sendMessage(from, { text: 'Por favor, ingresa solo un número válido.' });
                            continue;
                        }
                        session.data.mesesPermanencia = meses;
                        session.step = STEPS.PROOF_CAUSAL;
                        await sock.sendMessage(from, { text: 'Sube/Envía el documento o captura que *acredite* esta causal (y el mensaje de cierre enviado):' });
                        break;
                    }

                    case STEPS.PROOF_CAUSAL: {
                        if (!isMedia) {
                            await sock.sendMessage(from, { text: 'Por favor envía el archivo adjunto para continuar.' });
                            continue;
                        }
                        const buffer2 = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
                        if (buffer2) {
                            const messageType = getContentType(msg.message);
                            const mimeType = msg.message[messageType]?.mimetype || 'image/jpeg';
                            const ext = mimeType.split('/')[1] || 'jpg';
                            const uniqueFilename2 = `causal_${from.split('@')[0]}_${Date.now()}.${ext}`;
                            const url2 = await db.uploadFile(uniqueFilename2, buffer2, mimeType);
                            session.data.urlCausal = url2;
                        }
                        session.step = STEPS.DECLARACIONES;
                        await sock.sendMessage(from, { text: 'Para finalizar, escribe *ACEPTO* para confirmar las siguientes declaraciones obligatorias:\n1. Contacté al cotizante en < 24h.\n2. La información es veraz.\n3. Envié mensaje de cierre.\n4. No volveré a contactar a este lead.\n5. No usaré los datos para otros fines.' });
                        break;
                    }

                    case STEPS.DECLARACIONES: {
                        if (text.toLowerCase() !== 'acepto') {
                            await sock.sendMessage(from, { text: 'Debes escribir la palabra "Acepto" para continuar y enviar tu solicitud.' });
                            continue;
                        }

                        await sock.sendMessage(from, { text: 'Procesando tu solicitud...' });
                        await evaluateAndSave(session.data, from);
                        sessions.delete(from);
                        break;
                    }
                }
            } catch (e) {
                console.error("Error procesando mensaje:", e);
                const from = msg.key.remoteJid;
                try {
                    const errorMsg = e.message || 'Error desconocido';
                    await sock.sendMessage(from, { text: `❌ Ocurrió un error interno: *${errorMsg}*\n\nEscribe "reiniciar" para volver a empezar.` });
                } catch (sendErr) {
                    console.error("Error enviando error:", sendErr);
                }
            }
        }
    });
}

async function evaluateAndSave(data, from) {
    let estado = 'APROBADA';
    let motivo = 'Cumple con los criterios del protocolo IAsapre.';

    // Regla 1
    if (data.horasContacto > 24) {
        estado = 'RECHAZADA';
        motivo = `El contacto se realizó en ${data.horasContacto} horas (Máximo 24h).`;
    }
    // Regla 2
    else if (data.causal === 'Falta de anualidad' && data.mesesPermanencia >= 10) {
        estado = 'RECHAZADA';
        motivo = `La permanencia declarada es de ${data.mesesPermanencia} meses (Máximo 9).`;
    }
    // Regla 3
    else if (data.causal === 'Whatsapp Invalido') {
        estado = 'REEMPLAZO';
        motivo = 'El número es inválido. Este dato será reemplazado y NO consume una devolución.';
    }

    // Regla 4: Verificar límites
    if (estado !== 'REEMPLAZO') {
        const count = await db.getCountForBolsa(data.ejecutivo, data.bolsa);
        if (count >= 5) {
            estado = 'RECHAZADA';
            motivo = `Se ha alcanzado el límite de 5 devoluciones.`;
        }
    }

    const id = 'RET-' + Math.random().toString(36).substr(2, 9).toUpperCase();
    const fecha = new Date().toISOString();

    try {
        await db.saveReturn({
            id, fecha, ...data, estado, motivo,
            comprobantes: JSON.stringify({
                contacto: data.urlContacto || null,
                causal: data.urlCausal || null
            })
        });

        await sock.sendMessage(from, { text: `✅ Su devolución ha quedado ingresada exitosamente (ID: ${id}).\n\nTodos los antecedentes y el motivo de la devolución pasarán por una revisión interna. Se le dará una respuesta a la brevedad. ¡Gracias!` });

        // Notificar al administrador
        const adminNumber = '56985380357@s.whatsapp.net';
        const docLinks = [];
        if (data.urlContacto) docLinks.push(`Contacto: ${data.urlContacto}`);
        if (data.urlCausal) docLinks.push(`Causal: ${data.urlCausal}`);
        const attachmentsStr = docLinks.length > 0 ? `\n*Adjuntos:*\n${docLinks.join('\n')}` : '';

        const adminText = `🚨 *NUEVA SOLICITUD DE DEVOLUCIÓN INGRESADA*\n\n*ID:* ${id}\n*Ejecutivo:* ${data.ejecutivo}\n*Lead:* ${data.leadNombre} (${data.leadTelefono})\n*Mes:* ${data.mes}\n*Causal:* ${data.causal}\n*Horas Contacto:* ${data.horasContacto}h\n*Permanencia Declarada:* ${data.mesesPermanencia || 'N/A'}\n\n*Evaluación Automática Preliminar:* ${estado}\n*Motivo:* ${motivo}${attachmentsStr}`;

        await sock.sendMessage(adminNumber, { text: adminText });
    } catch (err) {
        console.error("Error guardando en DB:", err);
        await sock.sendMessage(from, { text: '❌ Ocurrió un error al guardar en la base de datos. Escribe "reiniciar" para intentar de nuevo.' });
    }
}

// Iniciar conexión
connectToWhatsApp();
