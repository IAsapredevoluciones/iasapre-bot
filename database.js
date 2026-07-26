require('dotenv').config();
global.WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✅ Supabase conectado correctamente.');
} else {
    console.warn("⚠️ Advertencia: No se encontraron SUPABASE_URL y SUPABASE_KEY.");
}

async function saveReturn(data) {
    if (!supabase) throw new Error("Supabase no configurado");
    
    const { error } = await supabase
        .from('devoluciones')
        .insert([{
            id: data.id,
            fecha: data.fecha,
            ejecutivo: data.ejecutivo,
            mes: data.mes,
            bolsa: data.bolsa,
            "leadNombre": data.leadNombre,
            "leadTelefono": data.leadTelefono,
            causal: data.causal,
            "horasContacto": data.horasContacto,
            "mesesPermanencia": data.mesesPermanencia,
            estado: data.estado,
            motivo: data.motivo,
            comprobantes: data.comprobantes || null
        }]);
        
    if (error) throw error;
}

async function getAllReturns() {
    if (!supabase) throw new Error("Supabase no configurado");
    
    const { data, error } = await supabase
        .from('devoluciones')
        .select('*')
        .order('fecha', { ascending: false });
        
    if (error) throw error;
    return data;
}

async function getCountForBolsa(ejecutivo, bolsa) {
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

async function uploadFile(fileName, buffer, mimeType) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase.storage
            .from('adjuntos')
            .upload(`devoluciones/${Date.now()}_${fileName}`, buffer, {
                contentType: mimeType,
                upsert: false
            });
            
        if (error) {
            console.error("Error subiendo a Supabase Storage:", error.message);
            return null;
        }
        
        const { data: publicUrlData } = supabase.storage
            .from('adjuntos')
            .getPublicUrl(data.path);
            
        return publicUrlData.publicUrl;
    } catch (err) {
        console.error("Error en uploadFile:", err.message);
        return null;
    }
}

module.exports = {
    saveReturn,
    getAllReturns,
    getCountForBolsa,
    uploadFile
};
