require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
} else {
    console.warn("⚠️ Advertencia: No se encontraron las credenciales de Supabase (SUPABASE_URL y SUPABASE_KEY). La base de datos no funcionará correctamente en la nube.");
}

// Function to save a return
async function saveReturn(data, callback) {
    if (!supabase) return callback(new Error("Supabase no configurado"));
    
    const { id, fecha, ejecutivo, mes, bolsa, leadNombre, leadTelefono, causal, horasContacto, mesesPermanencia, estado, motivo, comprobantesUrls } = data;
    
    const { error } = await supabase
        .from('devoluciones')
        .insert([{
            id, fecha, ejecutivo, mes, bolsa, leadNombre, leadTelefono, causal, horasContacto, mesesPermanencia, estado, motivo, 
            comprobantes: comprobantesUrls ? JSON.stringify(comprobantesUrls) : null
        }]);
        
    if (callback) callback(error);
}

// Function to get all returns
async function getAllReturns(callback) {
    if (!supabase) return callback(new Error("Supabase no configurado"));
    
    const { data, error } = await supabase
        .from('devoluciones')
        .select('*')
        .order('fecha', { ascending: false });
        
    if (callback) callback(error, data);
}

// Function to check how many returns an executive has in a bag (excluding replaced ones)
async function getCountForBolsa(ejecutivo, bolsa, callback) {
    if (!supabase) return callback(new Error("Supabase no configurado"), 0);

    const { count, error } = await supabase
        .from('devoluciones')
        .select('*', { count: 'exact', head: true })
        .eq('ejecutivo', ejecutivo)
        .eq('bolsa', bolsa)
        .neq('estado', 'REEMPLAZO');
        
    if (callback) callback(error, count || 0);
}

// Function to upload file to Supabase Storage
async function uploadFile(fileName, base64Data, mimeType) {
    if (!supabase) return null;
    
    try {
        const buffer = Buffer.from(base64Data, 'base64');
        const { data, error } = await supabase.storage
            .from('comprobantes')
            .upload(`devoluciones/${Date.now()}_${fileName}`, buffer, {
                contentType: mimeType,
                upsert: false
            });
            
        if (error) {
            console.error("Error subiendo a Supabase Storage:", error);
            return null;
        }
        
        // Obtenemos la URL pública del archivo subido
        const { data: publicUrlData } = supabase.storage
            .from('comprobantes')
            .getPublicUrl(data.path);
            
        return publicUrlData.publicUrl;
    } catch (err) {
        console.error("Error en uploadFile:", err);
        return null;
    }
}

module.exports = {
    saveReturn,
    getAllReturns,
    getCountForBolsa,
    uploadFile
};
