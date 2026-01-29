import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const folders = [
    'uploads',
    'uploads/comprobantes',
    'uploads/general',
    'uploads/profiles'
];

folders.forEach(folder => {
    const folderPath = path.join(__dirname, '..', folder);
    
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
        console.log(`Carpeta creada: ${folder}`);
    } else {
        console.log(`Carpeta ya existe: ${folder}`);
    }
});

console.log('Estructura de carpetas para uploads creada exitosamente');