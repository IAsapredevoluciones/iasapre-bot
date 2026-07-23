// Estado Global de la App
const state = {
    returns: [],
    chatStep: 0,
    currentReturn: {},
    botMessages: [
        { type: 'text', msg: '¡Hola! Soy el asistente de devoluciones de IAsapre 🤖. Estoy aquí para ayudarte a registrar una devolución de lead. Por favor, dime tu *nombre completo* (Ejecutivo):' },
        { type: 'options', msg: '¿A qué *mes* corresponde esta devolución?', options: ['junio-26', 'julio-26', 'Agosto-26', 'septiembre-26', 'Octubre-26', 'Noviembre-26', 'Diciembre-26'], key: 'mes' },
        { type: 'options', msg: '¿A qué *bolsa* corresponde?', options: ['Primera Bolsa', 'Segunda Bolsa', 'Tercera Bolsa', 'Cuarta Bolsa'], key: 'bolsa' },
        { type: 'text', msg: 'Por favor, indícame el *nombre completo del lead*:', key: 'leadNombre' },
        { type: 'text', msg: 'Indícame el *número de teléfono* del lead:', key: 'leadTelefono' },
        { type: 'text', msg: '¿Cuántas *horas* pasaron desde que recibiste el lead hasta que lo contactaste? (Escribe solo el número, ej: 12, 25):', key: 'horasContacto' },
        { type: 'upload', msg: 'Sube una captura de pantalla que acredite el contacto dentro de ese tiempo y por el medio preferido del cotizante:', key: 'proofContacto' },
        { type: 'options', msg: '¿Cuál es la *causal* de la devolución?', options: ['Falta de anualidad', 'Whatsapp Invalido', 'Preexistencia no afiliable', 'Pre o post natal', 'Renta inferior a $900.000'], key: 'causal' },
        { type: 'conditional', check: 'Falta de anualidad', msg: 'Ingresa los meses de *permanencia* del afiliado (ej: 8, 10):', key: 'mesesPermanencia' },
        { type: 'upload', msg: 'Sube el documento o captura que *acredite* esta causal (y el mensaje de cierre enviado al cliente si aplica):', key: 'proofCausal' },
        { type: 'declarations', msg: 'Para finalizar, debes aceptar las siguientes *declaraciones obligatorias*:\n1. Contacté al cotizante en < 24h.\n2. La información es veraz.\n3. Envié mensaje de cierre.\n4. No volveré a contactar a este lead.\n5. No usaré los datos para otros fines.', options: ['Acepto todas las declaraciones'], key: 'declaraciones' },
        { type: 'finish', msg: '¡Gracias! Evaluando tu solicitud...' }
    ]
};

// Referencias al DOM
const DOM = {
    tabs: document.querySelectorAll('.nav-item'),
    panes: document.querySelectorAll('.tab-pane'),
    returnsTable: document.getElementById('returnsTableBody'),
    emptyState: document.getElementById('emptyState'),
    search: document.getElementById('searchInput'),
    filter: document.getElementById('statusFilter'),
    // Stats
    statTotal: document.getElementById('stat-total'),
    statApproved: document.getElementById('stat-approved'),
    statRejected: document.getElementById('stat-rejected'),
    statReplaced: document.getElementById('stat-replaced'),
    // Bot
    chatArea: document.getElementById('chatArea'),
    inputArea: document.getElementById('inputArea'),
    optionsArea: document.getElementById('optionsArea'),
    uploadArea: document.getElementById('uploadArea'),
    chatInput: document.getElementById('chatInput'),
    sendBtn: document.getElementById('sendMsgBtn'),
    restartBtn: document.getElementById('restartBotBtn'),
    fileInput: document.getElementById('fileUpload'),
    // Modal
    modal: document.getElementById('detailsModal'),
    modalBody: document.getElementById('modalBody'),
    closeModalBtns: document.querySelectorAll('.close-modal, #closeModalFooterBtn'),
    // Export
    exportCsv: document.getElementById('exportCsvBtn'),
    exportJson: document.getElementById('exportJsonBtn'),
    resetBtn: document.getElementById('resetDataBtn')
};

// ==========================================
// 1. NAVEGACIÓN Y TABS
// ==========================================
DOM.tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
        e.preventDefault();
        DOM.tabs.forEach(t => t.classList.remove('active'));
        DOM.panes.forEach(p => p.classList.remove('active'));
        
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
        
        if(tab.dataset.tab === 'simulator' && state.chatStep === 0) {
            initChat();
        }
    });
});

// ==========================================
// 2. LÓGICA DEL PANEL (DASHBOARD)
// ==========================================
function updateDashboard() {
    let filtered = state.returns;
    
    // Aplicar filtros
    const searchTerm = DOM.search.value.toLowerCase();
    const statusFilter = DOM.filter.value;
    
    filtered = filtered.filter(item => {
        const matchesSearch = item.ejecutivo.toLowerCase().includes(searchTerm) || 
                              item.leadNombre.toLowerCase().includes(searchTerm);
        const matchesStatus = statusFilter === 'ALL' || item.estado === statusFilter;
        return matchesSearch && matchesStatus;
    });

    renderTable(filtered);
    updateStats();
}

function updateStats() {
    DOM.statTotal.innerText = state.returns.length;
    DOM.statApproved.innerText = state.returns.filter(r => r.estado === 'APROBADA').length;
    DOM.statRejected.innerText = state.returns.filter(r => r.estado === 'RECHAZADA').length;
    DOM.statReplaced.innerText = state.returns.filter(r => r.estado === 'REEMPLAZO').length;
}

function renderTable(data) {
    DOM.returnsTable.innerHTML = '';
    
    if (data.length === 0) {
        DOM.emptyState.classList.remove('hidden');
        DOM.returnsTable.parentElement.classList.add('hidden');
        return;
    }
    
    DOM.emptyState.classList.add('hidden');
    DOM.returnsTable.parentElement.classList.remove('hidden');

    data.reverse().forEach((item, index) => {
        const tr = document.createElement('tr');
        
        let badgeClass = 'badge-success';
        if(item.estado === 'RECHAZADA') badgeClass = 'badge-danger';
        if(item.estado === 'REEMPLAZO') badgeClass = 'badge-warning';

        tr.innerHTML = `
            <td>${new Date(item.fecha).toLocaleDateString()}</td>
            <td><strong>${item.ejecutivo}</strong></td>
            <td>${item.bolsa}<br><small>${item.mes}</small></td>
            <td>${item.leadNombre}<br><small>${item.leadTelefono}</small></td>
            <td>${item.causal}</td>
            <td>
                <span class="badge ${badgeClass}">${item.estado}</span>
            </td>
            <td>
                <button class="btn btn-outline btn-sm" onclick="viewDetails('${item.id}')">Ver Detalle</button>
            </td>
        `;
        DOM.returnsTable.appendChild(tr);
    });
}

function viewDetails(id) {
    const item = state.returns.find(r => r.id === id);
    if (!item) return;

    let adjuntosHtml = '';
    if (item.comprobantes) {
        try {
            const urls = JSON.parse(item.comprobantes);
            if (urls.urlContacto) adjuntosHtml += `<a href="${urls.urlContacto}" target="_blank" class="btn btn-sm btn-outline mt-3">Ver Prueba de Contacto</a>`;
            if (urls.urlCausal) adjuntosHtml += `<a href="${urls.urlCausal}" target="_blank" class="btn btn-sm btn-outline mt-3" style="margin-left: 8px;">Ver Prueba Causal</a>`;
        } catch(e) {}
    }

    DOM.modalBody.innerHTML = `
        <div class="details-grid">
            <div class="detail-item"><label>Ejecutivo</label><p>${item.ejecutivo}</p></div>
            <div class="detail-item"><label>Fecha Solicitud</label><p>${new Date(item.fecha).toLocaleString()}</p></div>
            <div class="detail-item"><label>Lead Nombre</label><p>${item.leadNombre}</p></div>
            <div class="detail-item"><label>Lead Teléfono</label><p>${item.leadTelefono}</p></div>
            <div class="detail-item"><label>Mes / Bolsa</label><p>${item.mes} / ${item.bolsa}</p></div>
            <div class="detail-item"><label>Causal</label><p>${item.causal}</p></div>
            <div class="detail-item"><label>Horas para contacto</label><p>${item.horasContacto} hrs</p></div>
            <div class="detail-item"><label>Permanencia declarada</label><p>${item.mesesPermanencia || 'N/A'}</p></div>
        </div>
        <div>
            ${adjuntosHtml}
        </div>
        <div class="reason-box">
            <h4 style="margin-bottom:8px">Evaluación Automática: <span style="color:${item.estado==='APROBADA'?'var(--success)':item.estado==='REEMPLAZO'?'var(--warning)':'var(--danger)'}">${item.estado}</span></h4>
            <p>${item.motivo}</p>
        </div>
    `;
    DOM.modal.classList.remove('hidden');
}

DOM.closeModalBtns.forEach(btn => btn.addEventListener('click', () => DOM.modal.classList.add('hidden')));
DOM.search.addEventListener('input', updateDashboard);
DOM.filter.addEventListener('change', updateDashboard);

// ==========================================
// 3. MOTOR DE REGLAS (VALIDACIÓN)
// ==========================================
function evaluateReturn(ret) {
    let estado = 'APROBADA';
    let motivo = 'Cumple con los criterios del protocolo IAsapre.';

    const horas = parseInt(ret.horasContacto);
    
    // Regla 1: Tiempo de contacto
    if (isNaN(horas) || horas > 24) {
        estado = 'RECHAZADA';
        motivo = `El contacto se realizó en ${horas} horas. El protocolo exige un máximo de 24 horas.`;
    } 
    // Regla 2: Permanencia (Solo si es Falta de anualidad)
    else if (ret.causal === 'Falta de anualidad') {
        const meses = parseInt(ret.mesesPermanencia);
        if (isNaN(meses) || meses >= 10) {
            estado = 'RECHAZADA';
            motivo = `La permanencia declarada es de ${meses} meses. El protocolo exige 9 meses o menos para esta causal.`;
        }
    } 
    // Regla 3: WhatsApp Inexistente
    else if (ret.causal === 'Whatsapp Invalido') {
        estado = 'REEMPLAZO';
        motivo = 'El número es inválido. Este dato será reemplazado y NO consume una devolución de la bolsa.';
    }
    
    // Regla 4: Límite de Bolsa (Max 5)
    // Contamos cuántas devoluciones previas tiene este ejecutivo en esa bolsa que no sean reemplazos ni rechazos (o rechazos también cuentan?)
    // Asumimos que los intentos fallidos o aprobados (que no sean whatsapp invalido) consumen.
    if (estado !== 'REEMPLAZO') {
        const consumidos = state.returns.filter(r => 
            r.ejecutivo === ret.ejecutivo && 
            r.bolsa === ret.bolsa && 
            r.causal !== 'Whatsapp Invalido'
        ).length;

        if (consumidos >= 5) {
            estado = 'RECHAZADA';
            motivo = `Se ha alcanzado el límite máximo de 5 devoluciones permitidas para la ${ret.bolsa}. (No se contabilizan los números inválidos).`;
        }
    }

    ret.estado = estado;
    ret.motivo = motivo;
    ret.id = 'RET-' + Math.random().toString(36).substr(2, 9).toUpperCase();
    ret.fecha = new Date().toISOString();
    
    state.returns.push(ret);
    localStorage.setItem('iasapre_returns', JSON.stringify(state.returns));
    updateDashboard();
    
    return { estado, motivo };
}

// ==========================================
// 4. SIMULADOR CHATBOT WHATSAPP
// ==========================================
function formatTime() {
    const d = new Date();
    return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

function addMessage(msg, type = 'in') {
    const div = document.createElement('div');
    div.className = `msg ${type}`;
    div.innerHTML = `${msg.replace(/\*(.*?)\*/g, '<strong>$1</strong>')} <span class="msg-time">${formatTime()}</span>`;
    DOM.chatArea.appendChild(div);
    DOM.chatArea.scrollTop = DOM.chatArea.scrollHeight;
}

function showInputType(stepConfig) {
    DOM.inputArea.classList.add('hidden');
    DOM.optionsArea.classList.add('hidden');
    DOM.uploadArea.classList.add('hidden');
    DOM.optionsArea.innerHTML = '';

    if (!stepConfig) return;

    if (stepConfig.type === 'text' || stepConfig.type === 'conditional') {
        DOM.inputArea.classList.remove('hidden');
        DOM.chatInput.focus();
    } else if (stepConfig.type === 'options' || stepConfig.type === 'declarations') {
        DOM.optionsArea.classList.remove('hidden');
        stepConfig.options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'wa-btn-option';
            btn.innerText = opt;
            btn.onclick = () => handleUserInput(opt);
            DOM.optionsArea.appendChild(btn);
        });
    } else if (stepConfig.type === 'upload') {
        DOM.uploadArea.classList.remove('hidden');
    }
}

function nextStep() {
    if (state.chatStep >= state.botMessages.length) return;
    
    let stepConfig = state.botMessages[state.chatStep];
    
    // Condicional: Si es pregunta de permanencia pero la causal NO fue anualidad, saltarla
    if (stepConfig.type === 'conditional') {
        if (state.currentReturn.causal !== stepConfig.check) {
            state.chatStep++;
            return nextStep();
        }
    }

    setTimeout(() => {
        addMessage(stepConfig.msg, 'in');
        
        if (stepConfig.type === 'finish') {
            // Process the return
            if(!state.currentReturn.ejecutivo) state.currentReturn.ejecutivo = "Ejecutivo Prueba";
            
            const result = evaluateReturn(state.currentReturn);
            
            setTimeout(() => {
                let msg = `✅ Evaluación completada:\n\n*Estado:* ${result.estado}\n*Motivo:* ${result.motivo}`;
                if(result.estado === 'RECHAZADA') msg = `❌ Evaluación completada:\n\n*Estado:* ${result.estado}\n*Motivo:* ${result.motivo}`;
                
                addMessage(msg, 'in');
                showInputType(null);
            }, 1500);
            
            state.chatStep++;
        } else {
            showInputType(stepConfig);
        }
    }, 600);
}

function handleUserInput(value) {
    if (!value.trim()) return;
    
    addMessage(value, 'out');
    
    const stepConfig = state.botMessages[state.chatStep];
    if (stepConfig && stepConfig.key) {
        if (stepConfig.key === 'ejecutivo') state.currentReturn.ejecutivo = value;
        else state.currentReturn[stepConfig.key] = value;
    } else if (state.chatStep === 0) {
        state.currentReturn.ejecutivo = value;
    }

    DOM.chatInput.value = '';
    showInputType(null); // Hide inputs while bot types
    
    state.chatStep++;
    nextStep();
}

// Bot listeners
DOM.sendBtn.addEventListener('click', () => handleUserInput(DOM.chatInput.value));
DOM.chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleUserInput(DOM.chatInput.value);
});

DOM.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleUserInput(`[Archivo Adjunto: ${e.target.files[0].name}]`);
    }
});

function initChat() {
    DOM.chatArea.innerHTML = '';
    state.chatStep = 0;
    state.currentReturn = {};
    nextStep();
}

DOM.restartBtn.addEventListener('click', initChat);

// ==========================================
// 5. EXPORTACIONES Y DATOS
// ==========================================
function downloadStringAsFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

DOM.exportJson.addEventListener('click', () => {
    downloadStringAsFile(JSON.stringify(state.returns, null, 2), 'devoluciones.json', 'application/json');
});

DOM.exportCsv.addEventListener('click', () => {
    if (state.returns.length === 0) return alert('No hay datos para exportar');
    
    // Header
    const keys = ['id', 'fecha', 'ejecutivo', 'mes', 'bolsa', 'leadNombre', 'leadTelefono', 'causal', 'horasContacto', 'mesesPermanencia', 'estado', 'motivo'];
    let csv = keys.join(',') + '\n';
    
    state.returns.forEach(item => {
        let row = keys.map(k => {
            let val = item[k] || '';
            // Escape comas para CSV
            return `"${String(val).replace(/"/g, '""')}"`;
        });
        csv += row.join(',') + '\n';
    });
    
    downloadStringAsFile(csv, 'devoluciones.csv', 'text/csv');
});

DOM.resetBtn.addEventListener('click', () => {
    if (confirm('¿Estás seguro de que deseas borrar TODAS las devoluciones guardadas? Esto no se puede deshacer.')) {
        localStorage.removeItem('iasapre_returns');
        state.returns = [];
        updateDashboard();
    }
});

// ==========================================
// 6. INICIALIZACIÓN API
// ==========================================
async function loadData() {
    try {
        const response = await fetch('/api/returns');
        if (response.ok) {
            state.returns = await response.json();
            updateDashboard();
        }
    } catch (e) {
        console.error("No se pudo cargar la data del servidor. Asegúrate de ejecutar node bot.js", e);
    }
}

// Init
loadData();
// Polling for updates every 10 seconds
setInterval(loadData, 10000);
