require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Faltan variables de entorno SUPABASE_URL o SUPABASE_KEY");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testUpload() {
    try {
        console.log("Probando conexión con Supabase...");
        
        const filename = `test_archivo_${Date.now()}.txt`;
        const buffer = Buffer.from('Prueba de base64 simulando una imagen', 'utf-8');
        
        console.log(`Subiendo archivo a bucket 'adjuntos' con nombre: ${filename}`);
        const { data, error } = await supabase.storage
            .from('adjuntos')
            .upload(filename, buffer, {
                contentType: 'text/plain',
                upsert: false
            });
            
        if (error) {
            console.error("❌ ERROR AL SUBIR (STORAGE):");
            console.error(error);
        } else {
            console.log("✅ ARCHIVO SUBIDO EXITOSAMENTE:", data);
            
            // Probar insertar en la tabla devoluciones
            console.log("Probando inserción en tabla devoluciones...");
            const dummyId = 'TEST-' + Date.now();
            const { error: dbError } = await supabase.from('devoluciones').insert([{
                id: dummyId,
                ejecutivo: 'Nicolas',
                mes: 'junio-26',
                bolsa: 'Primera Bolsa',
                motivo: 'Test local',
                estado: 'APROBADA',
                adjuntos: []
            }]);
            
            if (dbError) {
                console.error("❌ ERROR AL INSERTAR EN DEVOLUCIONES:");
                console.error(dbError);
            } else {
                console.log("✅ INSERCIÓN EXITOSA EN DEVOLUCIONES!");
            }
        }
    } catch (e) {
        console.error("❌ EXCEPCIÓN NO CONTROLADA:", e);
    }
}

testUpload();
