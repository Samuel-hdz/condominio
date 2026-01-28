// scripts/test-firebase.js
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Configurar __dirname para ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar variables de entorno desde .env
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function testFirebase() {
    console.log('🧪 Probando configuración de Firebase...\n');
    console.log('📁 Ruta del .env:', path.join(__dirname, '..', '.env'));
    console.log('🔍 Variables cargadas de .env:\n');

    // Mostrar todas las variables cargadas
    console.log('- PORT:', process.env.PORT || '✗ No cargado');
    console.log('- MONGODB_URI:', process.env.MONGODB_URI ? '✓ Cargado' : '✗ No cargado');
    console.log('- JWT_SECRET:', process.env.JWT_SECRET ? '✓ Cargado' : '✗ No cargado');
    console.log('- FIREBASE_SERVICE_ACCOUNT_KEY:', process.env.FIREBASE_SERVICE_ACCOUNT_KEY ? `✓ Cargado (${process.env.FIREBASE_SERVICE_ACCOUNT_KEY.length} chars)` : '✗ No cargado');

    // 1. Verificar variable de entorno
    console.log('\n1. Verificando variable de entorno FIREBASE_SERVICE_ACCOUNT_KEY...');
    
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        console.error('❌ Variable no encontrada en process.env');
        
        // Verificar archivo .env
        const fs = await import('fs');
        const envPath = path.join(__dirname, '..', '.env');
        
        if (fs.existsSync(envPath)) {
            console.log('\n📄 Contenido completo de .env:');
            const content = fs.readFileSync(envPath, 'utf8');
            console.log('========================================');
            console.log(content);
            console.log('========================================\n');
            
            // Buscar específicamente la clave
            if (content.includes('FIREBASE_SERVICE_ACCOUNT_KEY')) {
                console.log('🔍 La clave EXISTE en el archivo pero no se carga.');
                console.log('⚠️  Posibles problemas:');
                console.log('   - La variable tiene comillas dobles dentro de comillas dobles');
                console.log('   - El JSON tiene saltos de línea mal formateados');
                console.log('   - Hay caracteres especiales sin escapar');
                console.log('   - Falta el signo =');
                
                // Extraer solo la variable
                const lines = content.split('\n');
                for (const line of lines) {
                    if (line.trim().startsWith('FIREBASE_SERVICE_ACCOUNT_KEY')) {
                        console.log('\n📋 Línea encontrada:');
                        console.log(line);
                        
                        // Verificar si tiene valor después del =
                        const parts = line.split('=', 2);
                        if (parts.length === 2) {
                            const value = parts[1].trim();
                            console.log('\n📋 Valor extraído (primeros 200 chars):');
                            console.log(value.substring(0, 200) + (value.length > 200 ? '...' : ''));
                            
                            // Intentar parsear
                            try {
                                const parsed = JSON.parse(value);
                                console.log('\n✅ El valor ES JSON válido!');
                                console.log('Proyecto:', parsed.project_id);
                            } catch (parseError) {
                                console.log('\n❌ No se puede parsear como JSON:', parseError.message);
                                
                                // Verificar problemas comunes
                                if (value.startsWith('"') && value.endsWith('"')) {
                                    console.log('ℹ️  El valor está entre comillas, intentando removerlas...');
                                    const unquoted = value.substring(1, value.length - 1);
                                    try {
                                        const parsed = JSON.parse(unquoted);
                                        console.log('✅ ¡Funciona si quitamos las comillas exteriores!');
                                        console.log('Proyecto:', parsed.project_id);
                                    } catch (e) {
                                        console.log('❌ Aún no funciona después de remover comillas');
                                    }
                                }
                            }
                        } else {
                            console.log('❌ No hay signo = o no tiene valor');
                        }
                        break;
                    }
                }
            } else {
                console.log('❌ La clave NO EXISTE en el archivo .env');
            }
        } else {
            console.error(`❌ Archivo .env no encontrado en: ${envPath}`);
        }
        
        console.log('\n💡 SOLUCIÓN:');
        console.log('1. Asegúrate que tu .env tenga esta estructura:');
        console.log('   FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"...", ...}');
        console.log('\n2. O usa comillas simples externas y escapa las comillas internas:');
        console.log('   FIREBASE_SERVICE_ACCOUNT_KEY=\'{"type":"service_account","project_id":"..."}\'');
        console.log('\n3. O mejor aún, usa un archivo JSON separado.');
        
        process.exit(1);
    }
    
    console.log('✅ Variable encontrada');
    console.log('Longitud:', process.env.FIREBASE_SERVICE_ACCOUNT_KEY.length);
    console.log('Primeros 100 caracteres:', process.env.FIREBASE_SERVICE_ACCOUNT_KEY.substring(0, 100) + '...\n');

    // 2. Parsear JSON
    console.log('2. Parseando JSON...');
    let serviceAccount;
    try {
        // Intentar parsear directamente
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        console.log('✅ JSON parseado correctamente (parse directo)');
    } catch (parseError1) {
        console.log('⚠️  Parse directo falló:', parseError1.message);
        
        // Intentar limpiar el string
        try {
            let cleanJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY.trim();
            
            // Remover comillas exteriores si existen
            if (cleanJson.startsWith('"') && cleanJson.endsWith('"')) {
                cleanJson = cleanJson.substring(1, cleanJson.length - 1);
                console.log('ℹ️  Comillas exteriores removidas');
            }
            if (cleanJson.startsWith("'") && cleanJson.endsWith("'")) {
                cleanJson = cleanJson.substring(1, cleanJson.length - 1);
                console.log('ℹ️  Comillas simples exteriores removidas');
            }
            
            // Reemplazar escapes de nueva línea
            cleanJson = cleanJson.replace(/\\n/g, '\n');
            console.log('ℹ️  \\n reemplazados con saltos de línea reales');
            
            serviceAccount = JSON.parse(cleanJson);
            console.log('✅ JSON parseado correctamente (después de limpiar)');
        } catch (parseError2) {
            console.error('❌ Error parseando JSON después de limpiar:', parseError2.message);
            
            // Mostrar el string problemático con más detalle
            const jsonString = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
            console.log('\n🔍 Análisis del string problemático:');
            console.log('Primeros 300 caracteres:', jsonString.substring(0, 300));
            
            // Buscar caracteres problemáticos
            const problematicChars = [];
            for (let i = 0; i < Math.min(jsonString.length, 50); i++) {
                const char = jsonString[i];
                const code = char.charCodeAt(0);
                if (code < 32 || code > 126) {
                    problematicChars.push({ position: i, char: char, code: code });
                }
            }
            
            if (problematicChars.length > 0) {
                console.log('⚠️  Caracteres no imprimibles encontrados:', problematicChars);
            }
            
            process.exit(1);
        }
    }
    
    console.log(`   Proyecto: ${serviceAccount.project_id}`);
    console.log(`   Client Email: ${serviceAccount.client_email}`);
    console.log(`   Private Key: ${serviceAccount.private_key ? '✓ Presente' : '✗ Faltante'}`);
    if (serviceAccount.private_key) {
        console.log(`   Private Key starts with: ${serviceAccount.private_key.substring(0, 30)}...`);
        console.log(`   Private Key ends with: ...${serviceAccount.private_key.substring(serviceAccount.private_key.length - 30)}`);
    }
    console.log();

    // 3. Verificar campos requeridos
    console.log('3. Verificando campos requeridos...');
    const requiredFields = ['project_id', 'private_key', 'client_email'];
    let allFieldsValid = true;
    
    for (const field of requiredFields) {
        if (!serviceAccount[field]) {
            console.error(`❌ Campo faltante: ${field}`);
            allFieldsValid = false;
        } else if (field === 'private_key') {
            // Verificar formato de private key
            const key = serviceAccount[field];
            if (!key.includes('BEGIN PRIVATE KEY') || !key.includes('END PRIVATE KEY')) {
                console.error('❌ Private key con formato incorrecto');
                console.log('   Debe contener "BEGIN PRIVATE KEY" y "END PRIVATE KEY"');
                allFieldsValid = false;
            } else {
                console.log(`✅ ${field}: Formato correcto`);
            }
        } else {
            console.log(`✅ ${field}: Presente`);
        }
    }
    
    if (!allFieldsValid) {
        console.error('\n❌ Campos incompletos o incorrectos');
        process.exit(1);
    }
    
    console.log('✅ Todos los campos son válidos\n');

    // 4. Inicializar Firebase
    console.log('4. Inicializando Firebase Admin SDK...');
    try {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log('✅ Firebase inicializado\n');
    } catch (error) {
        console.error('❌ Error inicializando Firebase:', error.message);
        
        if (error.message.includes('private_key')) {
            console.log('\n🔍 Problema con la private key:');
            const key = serviceAccount.private_key;
            console.log('¿Contiene saltos de línea?', key.includes('\n') ? 'Sí' : 'No');
            console.log('¿Está escapado?', key.includes('\\n') ? 'Sí' : 'No');
            
            if (key.includes('\\n') && !key.includes('\n')) {
                console.log('\n💡 SOLUCIÓN: Reemplaza \\\\n con saltos de línea reales');
                console.log('   En tu .env, cambia:');
                console.log('   "private_key": "-----BEGIN PRIVATE KEY-----\\\\nMII..."');
                console.log('   Por:');
                console.log('   "private_key": "-----BEGIN PRIVATE KEY-----\\nMII..."');
                console.log('   (usa saltos de línea reales, no \\\\n)');
            }
        }
        
        console.error('Stack:', error.stack);
        process.exit(1);
    }

    // 5. Probar conexión
    console.log('5. Probando conexión...');
    try {
        // Obtener información de la app
        const app = admin.app();
        console.log('✅ App Firebase obtenida');
        
        // Probar que messaging está disponible
        const messaging = admin.messaging();
        console.log('✅ Módulo messaging disponible');
        
        // Obtener project ID
        const projectId = app.options.credential.projectId;
        console.log(`✅ Project ID: ${projectId}`);
        
        // Verificar permisos
        console.log('✅ Permisos de Firebase OK');
        
        console.log('\n🎉 ¡Firebase está configurado correctamente!');
        console.log('\n📋 Resumen:');
        console.log(`   • Proyecto: ${serviceAccount.project_id}`);
        console.log(`   • Client Email: ${serviceAccount.client_email}`);
        console.log(`   • Private Key: ${serviceAccount.private_key ? '✓ Presente y válida' : '✗ Faltante'}`);
        console.log(`   • Apps inicializadas: ${admin.apps.length}`);
        console.log(`   • Timestamp: ${new Date().toISOString()}`);
        
        // Sugerencia para usar en PowerShell
        console.log('\n💡 Para cargar en PowerShell (si es necesario):');
        console.log('```powershell');
        console.log('$env:FIREBASE_SERVICE_ACCOUNT_KEY = @\'');
        console.log(JSON.stringify(serviceAccount, null, 2));
        console.log('\'@');
        console.log('```');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error en prueba de conexión:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

// Manejar errores no capturados
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

// Ejecutar la prueba
testFirebase();