// QRonos · Datos de demostración para la página de estadísticas.
// Son FICTICIOS: solo sirven para mostrar los gráficos al cliente.
//
//   node datos_demo.js           crea 4 semanas de accesos y rechazos (hasta ayer)
//   node datos_demo.js --borrar  quita esos datos
//
// Usa las personas de ejemplo_personas.csv (las agrega a la lista si faltan).
// Al volver a ejecutarlo, primero borra los datos de demostración anteriores.
// Nunca toca lo registrado hoy, así que los escaneos de hoy se conservan.
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { digitoVerificador } = require("./server.js");

const DB = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "qronos",
  dateStrings: true,
};
const DIAS = 28;

// RUTs ficticios para los rechazos (válidos, pero no están en la lista)
const RUTS_RECHAZO = ["15000001", "16234567", "17555222", "18999001", "22100300", "14321987"]
  .map((c) => c + "-" + digitoVerificador(c));
const PREFIJO_QR = "DEMO-QR-";

// Generador aleatorio con semilla: siempre produce los mismos datos
let semilla = 20261119;
const azar = () => {
  semilla = (semilla + 0x6d2b79f5) | 0;
  let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));

function leerPersonas() {
  const lineas = fs.readFileSync(path.join(__dirname, "ejemplo_personas.csv"), "utf8").split(/\r?\n/).slice(1);
  return lineas.filter((l) => l.trim()).map((l) => {
    const [rut, nombre, tipo, vigencia, guardia] = l.split(";");
    return { rut, nombre, tipo, vigencia: vigencia || null, guardia: guardia === "si" ? 1 : 0 };
  });
}

// Probabilidad de venir según tipo y día (0 = lunes ... 6 = domingo)
const ASISTENCIA = {
  estudiante: [0.85, 0.95, 0.9, 0.85, 0.6, 0.2, 0.02],
  profesor:   [0.8, 0.9, 0.85, 0.8, 0.55, 0.15, 0],
  auxiliar:   [0.97, 0.97, 0.97, 0.97, 0.95, 0.6, 0.05],
};

const hhmmss = (min) => {
  const h = Math.floor(min / 60), m = Math.floor(min % 60), s = entre(0, 59);
  return [h, m, s].map((x) => String(x).padStart(2, "0")).join(":");
};

function visitasDelDia(p, diaSemana) {
  if (azar() > ASISTENCIA[p.tipo][diaSemana]) return [];
  let entrada, dur;
  if (p.tipo === "auxiliar") {
    entrada = entre(7 * 60, 7 * 60 + 45);
    dur = diaSemana === 5 ? entre(240, 300) : entre(480, 540);
  } else if (p.tipo === "profesor") {
    entrada = azar() < 0.6 ? entre(7 * 60 + 30, 9 * 60 + 30) : entre(13 * 60 + 30, 15 * 60);
    dur = entre(180, 480);
  } else {
    entrada = azar() < 0.65 ? entre(7 * 60 + 45, 8 * 60 + 30) : entre(13 * 60 + 45, 14 * 60 + 30);
    dur = diaSemana === 5 ? entre(150, 240) : entre(240, 390);
  }
  const salida = Math.min(entrada + dur, 22 * 60 + 30);
  // Algunos estudiantes salen a almorzar y vuelven
  if (p.tipo === "estudiante" && entrada < 12 * 60 && azar() < 0.25) {
    const sale = entre(12 * 60 + 30, 13 * 60), vuelve = sale + entre(30, 60);
    return [[entrada, sale], [vuelve, Math.max(salida, vuelve + 120)]];
  }
  return [[entrada, salida]];
}

async function borrar(db, personas) {
  const [a] = await db.query("DELETE FROM accesos WHERE rut IN (?) AND fecha < CURDATE()", [personas.map((p) => p.rut)]);
  const [r] = await db.query(
    "DELETE FROM intentos_rechazados WHERE fecha < CURDATE() AND (rut_leido IN (?) OR rut_leido LIKE ?)",
    [RUTS_RECHAZO, PREFIJO_QR + "%"]);
  return { accesos: a.affectedRows, rechazos: r.affectedRows };
}

async function main() {
  const db = await mysql.createConnection(DB);
  const personas = leerPersonas();
  try {
    if (process.argv.includes("--borrar")) {
      const b = await borrar(db, personas);
      console.log(`Datos de demostración borrados: ${b.accesos} accesos y ${b.rechazos} rechazos.`);
      return;
    }
    await borrar(db, personas);
    for (const p of personas) {
      await db.query(
        `INSERT IGNORE INTO personas_autorizadas (rut, nombre, tipo, es_guardia, activo, vigencia_hasta)
         VALUES (?, ?, ?, ?, 1, ?)`, [p.rut, p.nombre, p.tipo, p.guardia, p.vigencia]);
    }
    const [[hoy]] = await db.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS f");
    const accesos = [], rechazos = [];
    const motivos = ["no_autorizado", "no_autorizado", "no_autorizado", "vencido", "inactivo", "qr_no_reconocido", "qr_vencido", "qr_vencido", "qr_usado"];
    for (let d = DIAS; d >= 1; d--) {
      const fecha = new Date(hoy.f + "T12:00:00");
      fecha.setDate(fecha.getDate() - d);
      const f = fecha.toISOString().slice(0, 10);
      const diaSemana = (fecha.getDay() + 6) % 7;
      for (const p of personas)
        for (const [e, s] of visitasDelDia(p, diaSemana)) accesos.push([p.rut, f, hhmmss(e), hhmmss(s)]);
      const nRech = diaSemana < 5 ? entre(0, 3) : entre(0, 1);
      for (let i = 0; i < nRech; i++) {
        const motivo = motivos[entre(0, motivos.length - 1)];
        const leido = motivo === "qr_no_reconocido" ? PREFIJO_QR + entre(100, 999) : RUTS_RECHAZO[entre(0, RUTS_RECHAZO.length - 1)];
        rechazos.push([leido, f, hhmmss(entre(7 * 60, 19 * 60)), motivo]);
      }
    }
    if (accesos.length) await db.query("INSERT INTO accesos (rut, fecha, hora_entrada, hora_salida) VALUES ?", [accesos]);
    if (rechazos.length) await db.query("INSERT INTO intentos_rechazados (rut_leido, fecha, hora, motivo) VALUES ?", [rechazos]);
    console.log(`Listo: ${accesos.length} accesos y ${rechazos.length} rechazos ficticios en los últimos ${DIAS} días (hasta ayer).`);
    console.log("Ábrelos en http://localhost:3000/estadisticas.html  ·  Para quitarlos: node datos_demo.js --borrar");
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error("No se pudo completar:", e.message);
  process.exit(1);
});
