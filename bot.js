const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');

// ==========================================
// 1. EXPRESS WEB SERVER (DASHBOARD)
// ==========================================
const app = express();
app.use(cors());
app.use(express.json());
// Serve the frontend files
app.use(express.static(path.join(__dirname, 'public')));

// API route to get all returns for the dashboard
app.get('/api/returns', (req, res) => {
    db.getAllReturns((err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Dashboard web disponible en http://localhost:${PORT}`);
});

// ==========================================
// 2. WHATSAPP BOT LOGIC
// ==========================================
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log('📱 ESCANEA ESTE CÓDIGO QR CON LA APP DE WHATSAPP:');
    qrcode.generate(qr, { small: true });
    console.log('\n=========================================');
    console.log('🚨 SI TU CELULAR NO LEE EL QR DE ARRIBA 🚨');
    console.log('Copia el siguiente enlace, pégalo en tu navegador y escanea la imagen perfecta:');
    console.log(`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`);
    console.log('=========================================\n');
});

client.on('ready', () => {
    console.log('✅ Bot de WhatsApp conectado y listo para recibir mensajes.');
});

// State machine for conversation sessions
const sessions = new Map();

const STEPS = {
    GREETING: 0,
    MES: 1,
    BOLSA: 2,
    LEAD_NOMBRE: 3,
    LEAD_TELEFONO: 4,
    HORAS: 5,
    PROOF_CONTACTO: 6,
    CAUSAL: 7,
    PERMANENCIA: 8,
    PROOF_CAUSAL: 9,
    DECLARACIONES: 10
};

// Valid options for text fallback
const validMeses = ['junio-26', 'julio-26', 'Agosto-26', 'septiembre-26', 'Octubre-26', 'Noviembre-26', 'Diciembre-26'];
const validBolsas = ['Primera Bolsa', 'Segunda Bolsa', 'Tercera Bolsa', 'Cuarta Bolsa'];
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

client.on('message', async (msg) => {
    const from = msg.from;
    const text = msg.body.trim();
    
    // Ignore status broadcasts
    if (from === 'status@broadcast') return;

    // Initialize session if not exists or if they type "hola" / "reiniciar"
    if (!sessions.has(from) || text.toLowerCase() === 'hola' || text.toLowerCase() === 'reiniciar') {
        sessions.set(from, { step: STEPS.GREETING, data: {} });
        await msg.reply('¡Hola! Soy el asistente de devoluciones de IAsapre 🤖.\nPor favor, indícame tu *nombre completo* (Ejecutivo):');
        return;
    }

    const session = sessions.get(from);

    try {
        switch (session.step) {
            case STEPS.GREETING:
                session.data.ejecutivo = text;
                session.step = STEPS.MES;
                await msg.reply(`Gracias, ${text}. ¿A qué *mes* corresponde esta devolución?\nResponde con el número de la opción:\n${formatOptions(validMeses)}`);
                break;

            case STEPS.MES:
                const mesMatch = parseOption(text, validMeses);
                if (!mesMatch) {
                    await msg.reply('Por favor, responde con el número de un mes válido de la lista:\n' + formatOptions(validMeses));
                    return;
                }
                session.data.mes = mesMatch;
                session.step = STEPS.BOLSA;
                await msg.reply('¿A qué *bolsa* corresponde?\nResponde con el número de la opción:\n' + formatOptions(validBolsas));
                break;

            case STEPS.BOLSA:
                const bolsaMatch = parseOption(text, validBolsas);
                if (!bolsaMatch) {
                    await msg.reply('Por favor responde con el número de una bolsa válida:\n' + formatOptions(validBolsas));
                    return;
                }
                session.data.bolsa = bolsaMatch;
                session.step = STEPS.LEAD_NOMBRE;
                await msg.reply('Por favor, indícame el *nombre completo del lead*:');
                break;

            case STEPS.LEAD_NOMBRE:
                session.data.leadNombre = text;
                session.step = STEPS.LEAD_TELEFONO;
                await msg.reply('Indícame el *número de teléfono* del lead:');
                break;

            case STEPS.LEAD_TELEFONO:
                session.data.leadTelefono = text;
                session.step = STEPS.HORAS;
                await msg.reply('¿Cuántas *horas* pasaron desde que recibiste el lead hasta que lo contactaste? (Escribe solo el número, ej: 12, 25):');
                break;

            case STEPS.HORAS:
                const horas = parseInt(text);
                if (isNaN(horas)) {
                    await msg.reply('Por favor, ingresa solo un número válido.');
                    return;
                }
                session.data.horasContacto = horas;
                session.step = STEPS.PROOF_CONTACTO;
                await msg.reply('Sube/Envía una imagen (captura de pantalla) que acredite el contacto dentro de ese tiempo:');
                break;

            case STEPS.PROOF_CONTACTO:
                if (!msg.hasMedia) {
                    await msg.reply('No he recibido una imagen/archivo. Por favor envía el adjunto para continuar.');
                    return;
                }
                const media1 = await msg.downloadMedia();
                if (media1) {
                    const url = await db.uploadFile(`contacto_${msg.from}_${media1.filename || 'img.jpg'}`, media1.data, media1.mimetype);
                    session.data.urlContacto = url;
                }
                session.step = STEPS.CAUSAL;
                await msg.reply('Imagen recibida. ¿Cuál es la *causal* de la devolución?\nResponde con el número de la opción:\n' + formatOptions(validCausales));
                break;

            case STEPS.CAUSAL:
                let causalMatch = parseOption(text, validCausales);
                if (!causalMatch) {
                    await msg.reply('Causal no válida. Responde con el número de la opción:\n' + formatOptions(validCausales));
                    return;
                }
                session.data.causal = causalMatch;
                
                if (causalMatch === 'Falta de anualidad') {
                    session.step = STEPS.PERMANENCIA;
                    await msg.reply('Ingresa los meses de *permanencia* del afiliado (ej: 8, 10):');
                } else {
                    session.step = STEPS.PROOF_CAUSAL;
                    await msg.reply('Sube/Envía el documento o captura que *acredite* esta causal (y el mensaje de cierre si aplica):');
                }
                break;

            case STEPS.PERMANENCIA:
                const meses = parseInt(text);
                if (isNaN(meses)) {
                    await msg.reply('Por favor, ingresa solo un número válido.');
                    return;
                }
                session.data.mesesPermanencia = meses;
                session.step = STEPS.PROOF_CAUSAL;
                await msg.reply('Sube/Envía el documento o captura que *acredite* esta causal (y el mensaje de cierre enviado):');
                break;

            case STEPS.PROOF_CAUSAL:
                if (!msg.hasMedia) {
                    await msg.reply('Por favor envía el archivo adjunto para continuar.');
                    return;
                }
                const media2 = await msg.downloadMedia();
                if (media2) {
                    const url2 = await db.uploadFile(`causal_${msg.from}_${media2.filename || 'doc.jpg'}`, media2.data, media2.mimetype);
                    session.data.urlCausal = url2;
                }
                session.step = STEPS.DECLARACIONES;
                await msg.reply('Para finalizar, escribe *ACEPTO* para confirmar las siguientes declaraciones obligatorias:\n1. Contacté al cotizante en < 24h.\n2. La información es veraz.\n3. Envié mensaje de cierre.\n4. No volveré a contactar a este lead.\n5. No usaré los datos para otros fines.');
                break;

            case STEPS.DECLARACIONES:
                if (text.toLowerCase() !== 'acepto') {
                    await msg.reply('Debes escribir la palabra "Acepto" para continuar y enviar tu solicitud.');
                    return;
                }
                
                // Finalizar y Evaluar
                await msg.reply('Procesando tu solicitud...');
                await evaluateAndSave(session.data, msg);
                
                // Clear session
                sessions.delete(from);
                break;
        }
    } catch (e) {
        console.error("Error procesando mensaje:", e);
        await msg.reply('Ocurrió un error procesando tu mensaje. Escribe "reiniciar" para volver a empezar.');
    }
});

async function evaluateAndSave(data, whatsappMsg) {
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

    // Regla 4: Verificar límites en Base de Datos
    if (estado !== 'REEMPLAZO') {
        db.getCountForBolsa(data.ejecutivo, data.bolsa, (err, count) => {
            if (!err && count >= 5) {
                estado = 'RECHAZADA';
                motivo = `Se ha alcanzado el límite de 5 devoluciones para la ${data.bolsa}.`;
            }
            saveAndNotify(data, estado, motivo, whatsappMsg);
        });
    } else {
        saveAndNotify(data, estado, motivo, whatsappMsg);
    }
}

function saveAndNotify(data, estado, motivo, msg) {
    const id = 'RET-' + Math.random().toString(36).substr(2, 9).toUpperCase();
    const fecha = new Date().toISOString();
    
    db.saveReturn({
        id, fecha, ...data, estado, motivo
    }, async (err) => {
        if (err) {
            console.error(err);
            await msg.reply('❌ Ocurrió un error al guardar en la base de datos.');
            return;
        }

        let replyMsg = `✅ Su devolución ha quedado ingresada exitosamente (ID: ${id}).\n\nTodos los antecedentes y el motivo de la devolución pasarán por una revisión interna. Se le dará una respuesta a la brevedad. ¡Gracias!`;
        await msg.reply(replyMsg);

        // Notificar al administrador
        const adminNumber = '56985380357@c.us';
        const docLinks = [];
        if (data.urlContacto) docLinks.push(`Contacto: ${data.urlContacto}`);
        if (data.urlCausal) docLinks.push(`Causal: ${data.urlCausal}`);
        const attachmentsStr = docLinks.length > 0 ? `\n*Adjuntos:*\n${docLinks.join('\n')}` : '';
        
        const adminText = `🚨 *NUEVA SOLICITUD DE DEVOLUCIÓN INGRESADA*\n\n*ID:* ${id}\n*Ejecutivo:* ${data.ejecutivo}\n*Lead:* ${data.leadNombre} (${data.leadTelefono})\n*Mes/Bolsa:* ${data.mes} / ${data.bolsa}\n*Causal:* ${data.causal}\n*Horas Contacto:* ${data.horasContacto}h\n*Permanencia Declarada:* ${data.mesesPermanencia || 'N/A'}\n\n*Evaluación Automática Preliminar:* ${estado}\n*Motivo:* ${motivo}${attachmentsStr}`;
        
        client.sendMessage(adminNumber, adminText).catch(console.error);
    });
}

client.initialize();
