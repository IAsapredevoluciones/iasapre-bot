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
const port = process.env.PORT || 3000;

// Variables de estado del bot
let currentQR = '';
let botStatus = 'Iniciando servidor...';
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

app.get('/qr', (req, res) => {
    if (botStatus === 'Conectado y listo') {
        res.send('<h1 style="text-align:center; margin-top:50px; color: green;">✅ El bot ya está conectado y funcionando. No necesitas escanear nada.</h1>');
    } else if (currentQR) {
        res.send(`
            <div style="text-align: center; margin-top: 50px; font-family: sans-serif;">
                <h2>Escanea este código con tu WhatsApp</h2>
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(currentQR)}" alt="QR Code" />
                <p style="font-size: 20px;">Estado actual: <b style="color: blue;">${botStatus}</b></p>
                <p><i>Esta página se actualiza sola cada 10 segundos para mostrarte el QR más reciente.</i></p>
                <script>setTimeout(() => location.reload(), 10000);</script>
            </div>
        `);
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

// START SERVER
app.listen(port, () => {
    console.log(`🚀 Dashboard web disponible en http://localhost:${port}`);
});

// ==========================================
// 2. WHATSAPP BOT LOGIC
// ==========================================
const fs = require('fs');
function removeSingletonLock(dir) {
    if (!fs.existsSync(dir)) return;
    let files = [];
    try { files = fs.readdirSync(dir); } catch(e) { return; }
    for (const file of files) {
        const fullPath = path.join(dir, file);
        try {
            if (fs.lstatSync(fullPath).isDirectory()) {
                removeSingletonLock(fullPath);
            } else if (file === 'SingletonLock') {
                fs.unlinkSync(fullPath);
                console.log('Borrando lock:', fullPath);
            }
        } catch(e) {}
    }
}
removeSingletonLock(path.join(__dirname, '.wwebjs_auth'));

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

client.on('qr', (qr) => {
    currentQR = qr;
    botStatus = 'Esperando escaneo de QR...';
    console.log('📱 ESCANEA ESTE CÓDIGO QR CON LA APP DE WHATSAPP:');
    qrcode.generate(qr, { small: true });
    console.log('\n=========================================');
    console.log('🚨 SI TU CELULAR NO LEE EL QR DE ARRIBA 🚨');
    console.log('Copia el siguiente enlace, pégalo en tu navegador y escanea la imagen perfecta:');
    console.log(`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`);
    console.log('=========================================\n');
});

client.on('loading_screen', (percent, message) => {
    botStatus = `Sincronizando chats (${percent}%)...`;
    console.log(`⏳ SINCRONIZANDO CHATS: ${percent}% - ${message}`);
});

client.on('authenticated', () => {
    currentQR = '';
    botStatus = 'Autenticado, descargando chats...';
    console.log('🔐 ¡Autenticación exitosa! WhatsApp aceptó el código.');
    console.log('Descargando historial de chats (esto puede demorar varios minutos en servidores gratuitos)...');
});

client.on('auth_failure', msg => {
    botStatus = 'Error de autenticación';
    console.error('❌ Error de autenticación:', msg);
});

client.on('ready', () => {
    currentQR = '';
    botStatus = 'Conectado y listo';
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

client.on('message', async (msg) => {
    const from = msg.from;
    const text = msg.body.trim();
    
    // Ignore status broadcasts
    if (from === 'status@broadcast') return;

    // Initialize session if not exists or if they type "hola" / "reiniciar"
    if (!sessions.has(from) || text.toLowerCase() === 'hola' || text.toLowerCase() === 'reiniciar') {
        sessions.set(from, { step: STEPS.GREETING, data: { adjuntos: [] } });
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
                session.data.bolsa = 'N/A'; // Bolsa omitida por solicitud
                session.step = STEPS.LEAD_NOMBRE;
                await msg.reply('Por favor, indícame el *nombre completo del lead*:');
                break;

            case STEPS.BOLSA:
                // Omitido
                session.step = STEPS.LEAD_NOMBRE;
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
                    const uniqueFilename = `contacto_${msg.from.split('@')[0]}_${Date.now()}_${media1.filename || 'img.jpg'}`;
                    const url = await db.uploadFile(uniqueFilename, media1.data, media1.mimetype);
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
                    const uniqueFilename2 = `causal_${msg.from.split('@')[0]}_${Date.now()}_${media2.filename || 'img.jpg'}`;
                    const url2 = await db.uploadFile(uniqueFilename2, media2.data, media2.mimetype);
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
        const errorMsg = e.message || JSON.stringify(e) || 'Error desconocido';
        await msg.reply(`❌ Ocurrió un error interno: *${errorMsg}*\n\nPor favor envíame este mensaje rojo para revisarlo. Escribe "reiniciar" para volver a empezar.`);
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
