/**
 * Exporta todos los datos de Firestore a archivos JSON en backups/
 * Requiere: FIREBASE_SERVICE_ACCOUNT (JSON de cuenta de servicio) y
 *           FIREBASE_PROJECT_ID como variables de entorno.
 *
 * Estructura generada:
 *   backups/
 *     YYYY-MM-DD/
 *       {empresaId}.json        ← datos completos de cada empresa
 *     latest/
 *       {empresaId}.json        ← copia del último backup (para restaurar rápido)
 *     index.json                ← índice de todas las empresas y fechas de backup
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// ── Validar entorno ──────────────────────────────────────────────────────────
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('ERROR: La variable FIREBASE_SERVICE_ACCOUNT no está definida.');
  console.error('Agrega el JSON de la cuenta de servicio como secret de GitHub.');
  process.exit(1);
}

const projectId = process.env.FIREBASE_PROJECT_ID || 'contabilidad-roro';
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} catch (e) {
  console.error('ERROR: FIREBASE_SERVICE_ACCOUNT no es JSON válido:', e.message);
  process.exit(1);
}

// ── Inicializar Firebase Admin ───────────────────────────────────────────────
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId,
});

const db = admin.firestore();

// ── Colecciones a exportar por empresa ──────────────────────────────────────
const COLECCIONES = [
  'cuentas',
  'asientos',
  'cierres',
  'trabajadores',
  'liquidaciones',
  'productos',
  'mov_inv',
  'auxiliares',
  'honorarios',
  'activos_fijos',
  'conciliaciones',
  'params_rem',
  'audit_log',
  'periodos_cerrados',
  'rut_memoria',
  '_counters',
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function mkdirSafe(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

async function exportarColeccion(empresaId, coleccion) {
  const snap = await db
    .collection('empresas')
    .doc(empresaId)
    .collection(coleccion)
    .get();
  return snap.docs.map((d) => ({ _docId: d.id, ...d.data() }));
}

// ── Función principal ────────────────────────────────────────────────────────
async function main() {
  const hoy = new Date().toISOString().slice(0, 10);
  const repoRoot = path.resolve(__dirname, '..');
  const backupsDir = path.join(repoRoot, 'backups');
  const fechaDir = path.join(backupsDir, hoy);
  const latestDir = path.join(backupsDir, 'latest');

  mkdirSafe(fechaDir);
  mkdirSafe(latestDir);

  // Obtener lista de empresas
  const empresasSnap = await db.collection('empresas').get();
  const empresas = empresasSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (empresas.length === 0) {
    console.log('No se encontraron empresas en Firestore. Nada que exportar.');
    return;
  }

  const indice = [];

  for (const empresa of empresas) {
    const { id: empresaId, nombre = empresaId } = empresa;
    console.log(`Exportando empresa: ${nombre} (${empresaId})`);

    const datos = { empresa, exportado: new Date().toISOString(), colecciones: {} };

    for (const col of COLECCIONES) {
      try {
        datos.colecciones[col] = await exportarColeccion(empresaId, col);
        console.log(`  ${col}: ${datos.colecciones[col].length} documentos`);
      } catch (e) {
        console.warn(`  AVISO: no se pudo exportar ${col}:`, e.message);
        datos.colecciones[col] = [];
      }
    }

    const json = JSON.stringify(datos, null, 2);
    const nombreArchivo = `${empresaId}.json`;

    fs.writeFileSync(path.join(fechaDir, nombreArchivo), json, 'utf8');
    fs.writeFileSync(path.join(latestDir, nombreArchivo), json, 'utf8');

    indice.push({
      empresaId,
      nombre,
      ultimoBackup: datos.exportado,
      archivos: {
        fecha: `backups/${hoy}/${nombreArchivo}`,
        latest: `backups/latest/${nombreArchivo}`,
      },
    });
  }

  // Escribir índice global
  const indexPath = path.join(backupsDir, 'index.json');
  let indexActual = [];
  if (fs.existsSync(indexPath)) {
    try { indexActual = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch {}
  }

  // Fusionar: actualizar entradas existentes o agregar nuevas
  for (const entrada of indice) {
    const idx = indexActual.findIndex((e) => e.empresaId === entrada.empresaId);
    if (idx >= 0) {
      indexActual[idx] = entrada;
    } else {
      indexActual.push(entrada);
    }
  }

  fs.writeFileSync(indexPath, JSON.stringify(indexActual, null, 2), 'utf8');

  console.log(`\nBackup completado: ${empresas.length} empresa(s) exportada(s) a backups/${hoy}/`);
}

main().catch((e) => {
  console.error('Error fatal durante el backup:', e);
  process.exit(1);
});
