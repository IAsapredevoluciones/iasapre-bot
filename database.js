import 'dotenv/config';
import { WebSocket } from 'ws';
import { createClient } from '@supabase/supabase-js';

// Polyfill WebSocket para Node < 22
if (typeof globalThis.WebSocket === 'undefined') {
    globalThis.WebSocket = WebSocket;
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✅ Supabase conectado.');
} else {
    console.warn('⚠️ SUPABASE_URL o SUPABASE_KEY no configurados.');
}

export async function saveReturn(record) {
    if (!supabase) throw new Error('Supabase no configurado');

    const { error } = await supabase.from('devoluciones').insert([{
        id: record.id,
        fecha: record.fecha,
        ejecutivo: record.ejecutivo,
        mes: record.mes,
        bolsa: record.bolsa,
        leadnombre: record.leadNombre,
        leadtelefono: record.leadTelefono,
        causal: record.causal,
        horascontacto: record.horasContacto,
        mesespermanencia: record.mesesPermanencia || null,
        estado: record.estado,
        motivo: record.motivo,
        comprobantes: record.comprobantes || null
    }]);

    if (error) throw error;
}

export async function getAllReturns() {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('devoluciones')
        .select('*')
        .order('fecha', { ascending: false });
    if (error) throw error;
    return data || [];
}

export async function getCountForBolsa(ejecutivo, bolsa) {
    if (!supabase) return 0;
    const { count, error } = await supabase
        .from('devoluciones')
        .select('*', { count: 'exact', head: true })
        .eq('ejecutivo', ejecutivo)
        .eq('bolsa', bolsa)
        .neq('estado', 'REEMPLAZO');
    if (error) return 0;
    return count || 0;
}

export async function uploadFile(fileName, buffer, mimeType) {
    if (!supabase) return null;
    try {
        const filePath = 'devoluciones/' + Date.now() + '_' + fileName;
        const { data, error } = await supabase.storage
            .from('adjuntos')
            .upload(filePath, buffer, { contentType: mimeType, upsert: false });

        if (error) {
            console.error('Error subiendo archivo:', error.message);
            return null;
        }

        const { data: urlData } = supabase.storage
            .from('adjuntos')
            .getPublicUrl(data.path);

        return urlData.publicUrl;
    } catch (err) {
        console.error('Error en uploadFile:', err.message);
        return null;
    }
}
