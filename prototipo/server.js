// QRonos - Prototipo de control de acceso (Node.js + MySQL de XAMPP)
// Versión 5, etapa 1: solo entran las personas autorizadas (tabla personas_autorizadas),
// con tipo (estudiante, profesor o auxiliar), registro de intentos rechazados e importación desde CSV.
const express = require("express");
const mysql = require("mysql2/promise");
const path = require("path");
const crypto = require("crypto");

// ---------- Configuración (se puede cambiar con variables de entorno) ----------
const CONFIG = {
  puerto: Number(process.env.PORT || 3000),
  // El prototipo no tiene inicio de sesión: por defecto solo responde en este equipo (localhost).
  // Para abrirlo a la red use HOST=0.0.0.0 (bajo su responsabilidad).
  host: process.env.HOST || "127.0.0.1",
  db: {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "", // XAMPP trae root sin contraseña
    database: process.env.DB_NAME || "qronos",
  },
  // Si el mismo RUT se lee de nuevo dentro de este tiempo, se ignora la lectura
  segundosAntiRebote: Number(process.env.ANTI_REBOTE || 15),
  maxFilasImportacion: 5000,
  // QR dinámico: segundos de validez de cada código y clave con que el servidor los firma.
  // Sin QR_SECRETO se crea una clave nueva al iniciar (los códigos emitidos antes dejan de valer).
  qrSegundos: Number(process.env.QR_SEGUNDOS || 60),
  qrSecreto: process.env.QR_SECRETO || crypto.randomBytes(32).toString("hex"),
  // ¿Se acepta todavía el QR fijo con el RUT (credencial antigua)? QR_ESTATICO=no lo rechaza.
  qrEstatico: String(process.env.QR_ESTATICO || "si").toLowerCase() !== "no",
  adminRemoto: String(process.env.ADMIN_REMOTO || "no").toLowerCase() === "si",
};

const pool = mysql.createPool({
  ...CONFIG.db,
  dateStrings: true, // fechas y horas como texto, sin conversión de zona horaria
  waitForConnections: true,
  connectionLimit: 5,
});

const TIPOS = ["estudiante", "profesor", "auxiliar"];

const MOTIVOS = {
  no_autorizado: "No está en la lista de autorizados",
  inactivo: "Persona desactivada",
  vencido: "Vigencia vencida",
  qr_no_reconocido: "El QR no trae un RUT válido",
  qr_vencido: "Código QR vencido",
  qr_usado: "Código QR ya utilizado",
  qr_invalido: "Código QR adulterado o no emitido por QRonos",
  qr_estatico: "QR fijo no permitido: use la app",
  bloqueado: "Entrada bloqueada por la Administración",
};

// Un bloqueo rige cada día entre fecha_desde y fecha_hasta; si tiene horario, solo entre hora_desde y hora_hasta.
const BLOQUEO_ACTIVO = `CURDATE() BETWEEN b.fecha_desde AND b.fecha_hasta
  AND (b.hora_desde IS NULL OR (CURTIME() >= b.hora_desde AND CURTIME() < b.hora_hasta))`;

// Bloqueo vigente en este momento para el RUT (o null)
async function bloqueoActivo(db, rut) {
  const [f] = await db.query(
    `SELECT b.id, b.justificacion, DATE_FORMAT(b.fecha_hasta, '%d-%m-%Y') AS hasta,
            TIME_FORMAT(b.hora_desde, '%H:%i') AS hora_desde, TIME_FORMAT(b.hora_hasta, '%H:%i') AS hora_hasta
       FROM bloqueos b WHERE b.rut = ? AND ${BLOQUEO_ACTIVO} ORDER BY b.id DESC LIMIT 1`,
    [rut]
  );
  return f[0] || null;
}

// ---------- QR dinámico ----------
// Formato: QRONOS:<rut>:<vence, segundos Unix>:<azar>:<firma>
// La firma (HMAC-SHA256 recortado) impide fabricar o alterar códigos; cada código vence
// a los CONFIG.qrSegundos y sirve para un solo registro. El valor al azar hace que cada código sea distinto.
const PREFIJO_QR = "QRONOS:";
const firmarQr = (rut, vence, azar) =>
  crypto.createHmac("sha256", CONFIG.qrSecreto).update(`${rut}:${vence}:${azar}`).digest("hex").slice(0, 20);

function emitirQr(rut) {
  const ahora = Math.floor(Date.now() / 1000);
  const vence = ahora + CONFIG.qrSegundos;
  const azar = crypto.randomBytes(4).toString("hex");
  return { texto: `${PREFIJO_QR}${rut}:${vence}:${azar}:${firmarQr(rut, vence, azar)}`, ahora, vence, segundos: CONFIG.qrSegundos };
}

// null si el texto no es un QR dinámico; si lo es, { rut, firma, vence } o { error, motivo, rut? }
function leerQrDinamico(texto) {
  const t = String(texto || "").trim();
  if (!t.startsWith(PREFIJO_QR)) return null;
  const m = t.slice(PREFIJO_QR.length).match(/^(\d{7,8}-[0-9K]):(\d{10}):([0-9a-f]{8}):([0-9a-f]{20})$/);
  if (!m) return { error: "El código QR no tiene el formato de QRonos", motivo: "qr_invalido" };
  const [, rut, venceTxt, azar, firma] = m;
  const vence = Number(venceTxt);
  const esperada = firmarQr(rut, vence, azar);
  if (!crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) {
    return { error: "Código QR adulterado o no emitido por QRonos", motivo: "qr_invalido", rut };
  }
  if (Math.floor(Date.now() / 1000) > vence) {
    return { error: "Código QR vencido: muestre el código nuevo de la app", motivo: "qr_vencido", rut };
  }
  return { rut, firma, vence };
}

// Códigos ya usados (en memoria, hasta que vencen)
const qrUsados = new Map();
function marcarQrUsado(firma, vence) {
  const ahora = Math.floor(Date.now() / 1000);
  for (const [f, v] of qrUsados) if (v < ahora) qrUsados.delete(f);
  qrUsados.set(firma, vence);
}

// ---------- Validación de RUT chileno ----------
function digitoVerificador(cuerpo) {
  let suma = 0;
  let mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const r = 11 - (suma % 11);
  return r === 11 ? "0" : r === 10 ? "K" : String(r);
}

// Acepta lo que traiga el QR: "12.345.678-5", "12345678-5", "123456785"
// o una URL/texto que contenga el RUT (por ejemplo ...?rut=12345678-5)
function extraerRut(texto) {
  let t = String(texto || "");
  try {
    t = decodeURIComponent(t);
  } catch (_) {
    /* si no se puede decodificar, se usa tal cual */
  }
  let cuerpo = null;
  let dv = null;
  let m = t.match(/(?<![\d.])(\d{1,2}(?:\.\d{3}){2}|\d{7,8})\s*-\s*([0-9kK])(?![0-9kK])/);
  if (m) {
    cuerpo = m[1].replace(/\./g, "");
    dv = m[2].toUpperCase();
  } else {
    const limpio = t.trim().replace(/\./g, "");
    if (/^\d{7,8}[0-9kK]$/.test(limpio)) {
      cuerpo = limpio.slice(0, -1);
      dv = limpio.slice(-1).toUpperCase();
    }
  }
  if (!cuerpo) return { error: "El QR no contiene un RUT reconocible" };
  if (digitoVerificador(cuerpo) !== dv) return { error: "RUT inválido (el dígito verificador no coincide)" };
  return { rut: `${cuerpo}-${dv}` };
}

const MSG_RUT_PERSONA = "Escriba un RUT válido, por ejemplo 12.345.678-5";
const errorRutPersona = (r) => r.error.replace("El QR no contiene un RUT reconocible", MSG_RUT_PERSONA);

// ---------- Fechas, tipos y CSV ----------
const escaparLike = (v) => v.replace(/[\\%_]/g, "\\$&");

// Acepta AAAA-MM-DD, DD-MM-AAAA o DD/MM/AAAA y devuelve AAAA-MM-DD (o null si no es válida)
function normalizarFecha(v) {
  const t = String(v || "").trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let a, mes, d;
  if (m) {
    [, a, mes, d] = m;
  } else {
    m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (!m) return null;
    [, d, mes, a] = m;
  }
  const iso = `${a}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const f = new Date(iso + "T12:00:00Z");
  if (Number.isNaN(f.getTime()) || f.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

// Fecha exacta AAAA-MM-DD (rechaza días que no existen, como 2026-02-30)
const esFecha = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "") && normalizarFecha(v) === v;

function normalizarTipo(v) {
  const t = String(v || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
  if (["estudiante", "alumno", "alumna", "estudiantes"].includes(t)) return "estudiante";
  if (["profesor", "profesora", "docente", "profesores"].includes(t)) return "profesor";
  if (["auxiliar", "auxiliares"].includes(t)) return "auxiliar";
  return null;
}

const siNo = (v) => ["1", "si", "sí", "s", "true", "x", "yes"].includes(String(v || "").trim().toLowerCase());

// Lee un CSV simple (separador ; , o tabulación; admite comillas dobles). Devuelve filas de campos.
function parsearCsv(texto) {
  const t = String(texto || "").replace(/^﻿/, "");
  const primera = t.split(/\r?\n/).find((l) => l.trim() !== "") || "";
  const cuenta = (c) => (primera.match(new RegExp(c === "\t" ? "\t" : "\\" + c, "g")) || []).length;
  const sep = [";", ",", "\t"].sort((a, b) => cuenta(b) - cuenta(a))[0];
  const filas = [];
  let fila = [];
  let campo = "";
  let enComillas = false;
  let linea = 1;
  let lineaFila = 1;
  const cerrarFila = () => {
    fila.push(campo);
    campo = "";
    if (fila.some((c) => c.trim() !== "")) filas.push({ linea: lineaFila, campos: fila.map((c) => c.trim()) });
    fila = [];
  };
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (enComillas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') enComillas = false;
      else { campo += c; if (c === "\n") linea++; }
    } else if (c === '"' && campo === "") {
      enComillas = true;
    } else if (c === sep) {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      cerrarFila();
      linea++;
      lineaFila = linea;
    } else {
      campo += c;
    }
  }
  if (campo !== "" || fila.length) cerrarFila();
  return filas;
}

// Convierte las filas del CSV en personas válidas y una lista de errores por línea
// Columnas: rut; nombre; tipo; vigencia (opcional); guardia (opcional: si/no)
function validarFilasPersonas(filas) {
  const personas = [];
  const errores = [];
  const vistos = new Set();
  let inicio = 0;
  if (filas.length && /rut/i.test(filas[0].campos[0] || "")) inicio = 1; // encabezado
  for (let i = inicio; i < filas.length; i++) {
    const { linea, campos } = filas[i];
    const r = extraerRut(campos[0]);
    if (r.error) { errores.push({ linea, motivo: errorRutPersona(r) }); continue; }
    const nombre = String(campos[1] || "").replace(/\s+/g, " ").trim();
    if (nombre.length < 1 || nombre.length > 100) { errores.push({ linea, motivo: "El nombre debe tener entre 1 y 100 caracteres" }); continue; }
    const tipo = normalizarTipo(campos[2]);
    if (!tipo) { errores.push({ linea, motivo: "Tipo no válido (use estudiante, profesor o auxiliar)" }); continue; }
    let vigencia = null;
    if (campos[3]) {
      vigencia = normalizarFecha(campos[3]);
      if (!vigencia) { errores.push({ linea, motivo: "Vigencia no válida (use AAAA-MM-DD o DD-MM-AAAA)" }); continue; }
    }
    if (vistos.has(r.rut)) { errores.push({ linea, motivo: "RUT repetido en el archivo (se usó la primera fila)" }); continue; }
    vistos.add(r.rut);
    personas.push({ rut: r.rut, nombre, tipo, vigencia_hasta: vigencia, es_guardia: siNo(campos[4]) ? 1 : 0 });
  }
  return { personas, errores };
}

// ---------- Tablas ----------
async function asegurarTablas() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS personas_autorizadas (
       rut           VARCHAR(10)  NOT NULL PRIMARY KEY,
       nombre        VARCHAR(100) NOT NULL,
       tipo          ENUM('estudiante','profesor','auxiliar') NOT NULL,
       es_guardia    TINYINT(1)   NOT NULL DEFAULT 0,
       activo        TINYINT(1)   NOT NULL DEFAULT 1,
       vigencia_hasta DATE NULL
     ) ENGINE=InnoDB`
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS intentos_rechazados (
       id        INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
       rut_leido VARCHAR(40)  NOT NULL,
       fecha     DATE NOT NULL,
       hora      TIME NOT NULL,
       motivo    VARCHAR(20)  NOT NULL,
       INDEX idx_fecha (fecha),
       INDEX idx_leido (rut_leido, fecha)
     ) ENGINE=InnoDB`
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS bloqueos (
       id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
       rut           VARCHAR(10)  NOT NULL,
       fecha_desde   DATE NOT NULL,
       fecha_hasta   DATE NOT NULL,
       hora_desde    TIME NULL,
       hora_hasta    TIME NULL,
       justificacion VARCHAR(255) NOT NULL,
       creado_en     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       INDEX idx_rut_fechas (rut, fecha_desde, fecha_hasta)
     ) ENGINE=InnoDB`
  );
}

// Estado de una persona frente a la lista: { estado: "ok"|"no_autorizado"|"inactivo"|"vencido", ... }
async function buscarAutorizada(db, rut) {
  const [f] = await db.query(
    `SELECT nombre, tipo, es_guardia, activo, vigencia_hasta,
            (vigencia_hasta IS NOT NULL AND vigencia_hasta < CURDATE()) AS vencida
       FROM personas_autorizadas WHERE rut = ?`,
    [rut]
  );
  if (!f.length) return { estado: "no_autorizado", nombre: null, tipo: null, es_guardia: false };
  const p = f[0];
  const base = { nombre: p.nombre, tipo: p.tipo, es_guardia: !!p.es_guardia };
  if (!p.activo) return { estado: "inactivo", ...base };
  if (Number(p.vencida)) return { estado: "vencido", ...base };
  return { estado: "ok", ...base };
}

// Guarda un intento rechazado (con el mismo anti-rebote que las lecturas, para no llenar el registro)
async function registrarRechazo(db, leido, motivo) {
  const texto = String(leido || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 40) || "(vacío)";
  const [rep] = await db.query(
    `SELECT 1 FROM intentos_rechazados
      WHERE rut_leido = ? AND fecha >= CURDATE() - INTERVAL 1 DAY
        AND TIMESTAMPDIFF(SECOND, TIMESTAMP(fecha, hora), NOW()) < ? LIMIT 1`,
    [texto, CONFIG.segundosAntiRebote]
  );
  if (rep.length) return false;
  await db.query("INSERT INTO intentos_rechazados (rut_leido, fecha, hora, motivo) VALUES (?, CURDATE(), CURTIME(), ?)", [texto, motivo]);
  return true;
}

// ---------- Filtros de la lista de accesos ----------
const TIPOS_FILTRO = [...TIPOS, "guardia", "sin_registrar"];

// Parámetros: desde, hasta (AAAA-MM-DD), buscar (RUT o nombre),
// tipo (estudiante|profesor|auxiliar|guardia|sin_registrar), estado (dentro|salio)
function construirFiltro(q) {
  const cond = [];
  const params = [];
  let desde = q.desde || q.fecha || "";
  let hasta = q.hasta || q.fecha || "";
  if (desde && !esFecha(desde)) return { error: "La fecha 'desde' no es válida (use AAAA-MM-DD)" };
  if (hasta && !esFecha(hasta)) return { error: "La fecha 'hasta' no es válida (use AAAA-MM-DD)" };
  if (desde && hasta && desde > hasta) return { error: "La fecha 'desde' no puede ser posterior a 'hasta'" };
  if (!desde && !hasta) {
    cond.push("a.fecha = CURDATE()");
  } else {
    if (desde) { cond.push("a.fecha >= ?"); params.push(desde); }
    if (hasta) { cond.push("a.fecha <= ?"); params.push(hasta); }
  }
  const buscar = String(q.buscar || "").trim().slice(0, 60);
  if (buscar) {
    if (/^[0-9kK.\-\s]+$/.test(buscar)) {
      const rut = buscar.replace(/[^0-9kK-]/g, "").toUpperCase();
      cond.push("(a.rut LIKE ? OR p.nombre LIKE ?)");
      params.push("%" + escaparLike(rut) + "%", "%" + escaparLike(buscar) + "%");
    } else {
      cond.push("p.nombre LIKE ?");
      params.push("%" + escaparLike(buscar) + "%");
    }
  }
  if (TIPOS.includes(q.tipo)) { cond.push("p.tipo = ?"); params.push(q.tipo); }
  else if (q.tipo === "guardia") cond.push("COALESCE(p.es_guardia, 0) = 1");
  else if (q.tipo === "sin_registrar") cond.push("p.rut IS NULL");
  if (q.estado === "dentro") cond.push("a.hora_salida IS NULL");
  else if (q.estado === "salio") cond.push("a.hora_salida IS NOT NULL");
  return { where: cond.length ? "WHERE " + cond.join(" AND ") : "", params };
}

const SELECT_ACCESOS = `
  SELECT a.id, a.rut, p.nombre, p.tipo, COALESCE(p.es_guardia, 0) AS es_guardia,
         DATE_FORMAT(a.fecha, '%d-%m-%Y') AS fecha,
         TIME_FORMAT(a.hora_entrada, '%H:%i:%s') AS hora_entrada,
         TIME_FORMAT(a.hora_salida, '%H:%i:%s') AS hora_salida,
         TIME_FORMAT(TIMEDIFF(a.hora_salida, a.hora_entrada), '%H:%i:%s') AS permanencia
    FROM accesos a LEFT JOIN personas_autorizadas p ON p.rut = a.rut`;

async function consultarAccesos(query, limite) {
  const f = construirFiltro(query);
  if (f.error) return { error: f.error };
  const [filas] = await pool.query(
    `${SELECT_ACCESOS} ${f.where} ORDER BY a.fecha DESC, a.hora_entrada DESC, a.id DESC LIMIT ?`,
    [...f.params, limite]
  );
  const [[tot]] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(a.hora_salida IS NULL), 0) AS dentro
       FROM accesos a LEFT JOIN personas_autorizadas p ON p.rut = a.rut ${f.where}`,
    f.params
  );
  return { filas, total: Number(tot.total), dentro: Number(tot.dentro) };
}

const ETIQUETA_TIPO = { estudiante: "Estudiante", profesor: "Profesor", auxiliar: "Auxiliar" };

// Celdas de CSV seguras: comillas, separador y protección contra fórmulas de planilla
function celdaCsv(v) {
  let t = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return /[;"\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}

const errorBd = (res, ruta, err) => {
  console.error(`Error en ${ruta}:`, err.message);
  res.status(500).json({ ok: false, error: "Error de base de datos: " + err.message });
};

// ---------- Servidor ----------
const app = express();
app.use(express.json({ limit: "2mb" }));

// Desde otros equipos (por ejemplo, un celular con HOST=0.0.0.0) solo se abre la app móvil:
// el panel de administración no tiene inicio de sesión. ADMIN_REMOTO=si lo abre también (bajo su responsabilidad).
const IPS_LOCALES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const RUTAS_REMOTAS = [/^\/movil\.html$/, /^\/estilo\.css$/, /^\/qrcode\.min\.js$/, /^\/api\/movil\//];
app.use((req, res, next) => {
  if (CONFIG.adminRemoto || IPS_LOCALES.has(req.socket.remoteAddress)) return next();
  if (req.path === "/") return res.redirect("/movil.html");
  if (RUTAS_REMOTAS.some((r) => r.test(req.path))) return next();
  res.status(403).type("text").send("Solo disponible en el equipo del panel de administración. Abre /movil.html");
});

app.use(express.static(path.join(__dirname, "public")));

// Recibe el texto leído del QR: si la persona está autorizada registra ENTRADA o SALIDA;
// si no, rechaza el acceso y guarda el intento.
// Acepta el QR dinámico de la app; el QR fijo con el RUT solo si CONFIG.qrEstatico está activo.
// "manual: true" es la validación manual del guardia (contingencia): siempre puede escribir el RUT.
app.post("/api/escaneo", async (req, res) => {
  const texto = req.body && req.body.texto;
  const manual = !!(req.body && req.body.manual);
  const dinamico = leerQrDinamico(texto);
  const r = dinamico ? (dinamico.error ? { error: dinamico.error } : { rut: dinamico.rut }) : extraerRut(texto);
  const qrYaUsado = !!(dinamico && !dinamico.error && qrUsados.has(dinamico.firma));

  let conn;
  try {
    conn = await pool.getConnection();

    if (dinamico && dinamico.error) {
      const p = dinamico.rut ? await buscarAutorizada(conn, dinamico.rut) : {};
      await registrarRechazo(conn, dinamico.rut || texto, dinamico.motivo);
      return res.status(403).json({ ok: false, rechazado: true, motivo: dinamico.motivo, rut: dinamico.rut || null,
        nombre: p.nombre || null, tipo: p.tipo || null, error: dinamico.error });
    }

    if (r.error) {
      await registrarRechazo(conn, texto, "qr_no_reconocido");
      return res.status(400).json({ ok: false, rechazado: true, motivo: "qr_no_reconocido", error: r.error });
    }

    if (!dinamico && !manual && !CONFIG.qrEstatico) {
      const p = await buscarAutorizada(conn, r.rut);
      await registrarRechazo(conn, r.rut, "qr_estatico");
      return res.status(403).json({ ok: false, rechazado: true, motivo: "qr_estatico", rut: r.rut, nombre: p.nombre, tipo: p.tipo,
        error: "Este QR fijo ya no se acepta: muestre el código de la app QRonos" });
    }

    await conn.beginTransaction();

    // ¿Está autorizada, activa y con vigencia al día?
    const persona = await buscarAutorizada(conn, r.rut);
    if (persona.estado !== "ok") {
      await registrarRechazo(conn, r.rut, persona.estado);
      await conn.commit();
      return res.status(403).json({
        ok: false,
        rechazado: true,
        motivo: persona.estado,
        rut: r.rut,
        nombre: persona.nombre,
        tipo: persona.tipo,
        error: "ACCESO NO AUTORIZADO: " + MOTIVOS[persona.estado].toLowerCase(),
      });
    }

    // Un código dinámico ya usado solo se tolera como lectura repetida (anti-rebote, más abajo)
    const rechazarUsado = async () => {
      await conn.rollback();
      await registrarRechazo(conn, r.rut, "qr_usado");
      return res.status(403).json({ ok: false, rechazado: true, motivo: "qr_usado", rut: r.rut, nombre: persona.nombre, tipo: persona.tipo,
        error: "Este código QR ya se usó: espere el código nuevo de la app" });
    };

    // ¿Tiene una entrada de hoy sin salida?
    const [abiertos] = await conn.query(
      `SELECT id, TIMESTAMPDIFF(SECOND, TIMESTAMP(fecha, hora_entrada), NOW()) AS seg
         FROM accesos
        WHERE rut = ? AND fecha = CURDATE() AND hora_salida IS NULL
        ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [r.rut]
    );

    let accion;
    let idRegistro;

    if (abiertos.length > 0) {
      if (abiertos[0].seg < CONFIG.segundosAntiRebote) {
        await conn.rollback();
        return res.json({ ok: true, accion: "IGNORADO", rut: r.rut, nombre: persona.nombre, tipo: persona.tipo, es_guardia: persona.es_guardia, mensaje: "Lectura repetida, se ignora" });
      }
      if (qrYaUsado) return rechazarUsado();
      await conn.query("UPDATE accesos SET hora_salida = CURTIME() WHERE id = ?", [abiertos[0].id]);
      accion = "SALIDA";
      idRegistro = abiertos[0].id;
    } else {
      const [ultimas] = await conn.query(
        `SELECT TIMESTAMPDIFF(SECOND, TIMESTAMP(fecha, hora_salida), NOW()) AS seg
           FROM accesos
          WHERE rut = ? AND fecha = CURDATE() AND hora_salida IS NOT NULL
          ORDER BY id DESC LIMIT 1`,
        [r.rut]
      );
      if (ultimas.length > 0 && ultimas[0].seg < CONFIG.segundosAntiRebote) {
        await conn.rollback();
        return res.json({ ok: true, accion: "IGNORADO", rut: r.rut, nombre: persona.nombre, tipo: persona.tipo, es_guardia: persona.es_guardia, mensaje: "Lectura repetida, se ignora" });
      }
      if (qrYaUsado) return rechazarUsado();
      // ¿Tiene la entrada bloqueada en este día u horario? (solo se bloquea la entrada; la salida siempre se permite)
      const bloqueo = await bloqueoActivo(conn, r.rut);
      if (bloqueo) {
        await conn.rollback();
        await registrarRechazo(conn, r.rut, "bloqueado");
        const horario = bloqueo.hora_desde ? ` de ${bloqueo.hora_desde} a ${bloqueo.hora_hasta}` : "";
        return res.status(403).json({ ok: false, rechazado: true, motivo: "bloqueado", rut: r.rut, nombre: persona.nombre, tipo: persona.tipo,
          justificacion: bloqueo.justificacion, bloqueo_hasta: bloqueo.hasta, bloqueo_horario: horario.trim() || null,
          error: `ENTRADA BLOQUEADA hasta el ${bloqueo.hasta}${horario}: ${bloqueo.justificacion}` });
      }
      const [ins] = await conn.query(
        "INSERT INTO accesos (rut, fecha, hora_entrada) VALUES (?, CURDATE(), CURTIME())",
        [r.rut]
      );
      accion = "ENTRADA";
      idRegistro = ins.insertId;
    }

    const [filas] = await conn.query(
      `SELECT DATE_FORMAT(fecha, '%d-%m-%Y') AS fecha,
              TIME_FORMAT(hora_entrada, '%H:%i:%s') AS hora_entrada,
              TIME_FORMAT(hora_salida, '%H:%i:%s') AS hora_salida
         FROM accesos WHERE id = ?`,
      [idRegistro]
    );
    await conn.commit();
    if (dinamico) marcarQrUsado(dinamico.firma, dinamico.vence);

    res.json({
      ok: true,
      accion,
      rut: r.rut,
      nombre: persona.nombre,
      tipo: persona.tipo,
      es_guardia: persona.es_guardia,
      fecha: filas[0].fecha,
      hora: accion === "ENTRADA" ? filas[0].hora_entrada : filas[0].hora_salida,
    });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error("Error en /api/escaneo:", err.message);
    res.status(500).json({ ok: false, error: "Error de base de datos: " + err.message });
  } finally {
    if (conn) conn.release();
  }
});

// Lista los accesos con filtros (por defecto, los de hoy)
app.get("/api/accesos", async (req, res) => {
  const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 500, 1), 5000);
  try {
    const r = await consultarAccesos(req.query, limite);
    if (r.error) return res.status(400).json({ ok: false, error: r.error });
    res.json({ ok: true, total: r.total, dentro: r.dentro, mostrados: r.filas.length, accesos: r.filas });
  } catch (err) {
    errorBd(res, "/api/accesos", err);
  }
});

// Mismos filtros, descargados como CSV (separador ";" y UTF-8 con BOM para abrir bien en Excel)
app.get("/api/accesos.csv", async (req, res) => {
  try {
    const r = await consultarAccesos(req.query, 50000);
    if (r.error) return res.status(400).type("text/plain; charset=utf-8").send(r.error);
    const cab = ["Fecha", "RUT", "Nombre", "Tipo", "Guardia", "Hora de entrada", "Hora de salida", "Permanencia"];
    const lineas = r.filas.map((f) =>
      [f.fecha, f.rut, f.nombre || "Sin registrar", f.tipo ? ETIQUETA_TIPO[f.tipo] : "", f.nombre ? (f.es_guardia ? "Sí" : "No") : "", f.hora_entrada, f.hora_salida || "", f.permanencia || ""]
        .map(celdaCsv).join(";")
    );
    const nombre = "accesos_" + (req.query.desde || req.query.fecha || "hoy") + (req.query.hasta && req.query.hasta !== req.query.desde ? "_a_" + req.query.hasta : "") + ".csv";
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombre.replace(/[^A-Za-z0-9_.-]/g, "")}"`,
    });
    res.send("﻿" + [cab.join(";"), ...lineas].join("\r\n") + "\r\n");
  } catch (err) {
    console.error("Error en /api/accesos.csv:", err.message);
    res.status(500).type("text/plain; charset=utf-8").send("Error de base de datos: " + err.message);
  }
});

// Intentos rechazados (por defecto, los de hoy). Parámetros: desde, hasta, limite
app.get("/api/rechazados", async (req, res) => {
  const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 500, 1), 5000);
  const desde = req.query.desde || req.query.fecha || "";
  const hasta = req.query.hasta || req.query.fecha || "";
  if (desde && !esFecha(desde)) return res.status(400).json({ ok: false, error: "La fecha 'desde' no es válida (use AAAA-MM-DD)" });
  if (hasta && !esFecha(hasta)) return res.status(400).json({ ok: false, error: "La fecha 'hasta' no es válida (use AAAA-MM-DD)" });
  if (desde && hasta && desde > hasta) return res.status(400).json({ ok: false, error: "La fecha 'desde' no puede ser posterior a 'hasta'" });
  const cond = [];
  const params = [];
  if (!desde && !hasta) cond.push("i.fecha = CURDATE()");
  if (desde) { cond.push("i.fecha >= ?"); params.push(desde); }
  if (hasta) { cond.push("i.fecha <= ?"); params.push(hasta); }
  const where = "WHERE " + cond.join(" AND ");
  try {
    const [filas] = await pool.query(
      `SELECT i.id, i.rut_leido, p.nombre, p.tipo,
              DATE_FORMAT(i.fecha, '%d-%m-%Y') AS fecha,
              TIME_FORMAT(i.hora, '%H:%i:%s') AS hora, i.motivo
         FROM intentos_rechazados i LEFT JOIN personas_autorizadas p ON p.rut = i.rut_leido
         ${where} ORDER BY i.fecha DESC, i.hora DESC, i.id DESC LIMIT ?`,
      [...params, limite]
    );
    const [[tot]] = await pool.query(`SELECT COUNT(*) AS total FROM intentos_rechazados i ${where}`, params);
    res.json({
      ok: true,
      total: Number(tot.total),
      mostrados: filas.length,
      rechazados: filas.map((f) => ({ ...f, motivo_texto: MOTIVOS[f.motivo] || f.motivo })),
    });
  } catch (err) {
    errorBd(res, "/api/rechazados", err);
  }
});

// ---------- Personas autorizadas ----------
const mapPersona = (f) => ({
  rut: f.rut,
  nombre: f.nombre,
  tipo: f.tipo,
  es_guardia: !!f.es_guardia,
  activo: !!f.activo,
  vigencia_hasta: f.vigencia_hasta || null,
  vencida: !!Number(f.vencida),
  bloqueada: !!Number(f.bloqueada),
});

// Parámetros: q (RUT o nombre), tipo (estudiante|profesor|auxiliar), estado (activo|inactivo|vencido)
app.get("/api/personas", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim().slice(0, 60);
    const cond = ["(? = '' OR rut LIKE ? OR nombre LIKE ?)"];
    const params = [q, "%" + escaparLike(q) + "%", "%" + escaparLike(q) + "%"];
    if (TIPOS.includes(req.query.tipo)) { cond.push("tipo = ?"); params.push(req.query.tipo); }
    if (req.query.estado === "activo") cond.push("activo = 1 AND (vigencia_hasta IS NULL OR vigencia_hasta >= CURDATE())");
    else if (req.query.estado === "inactivo") cond.push("activo = 0");
    else if (req.query.estado === "vencido") cond.push("vigencia_hasta IS NOT NULL AND vigencia_hasta < CURDATE()");
    const [filas] = await pool.query(
      `SELECT rut, nombre, tipo, es_guardia, activo, vigencia_hasta,
              (vigencia_hasta IS NOT NULL AND vigencia_hasta < CURDATE()) AS vencida,
              EXISTS(SELECT 1 FROM bloqueos b WHERE b.rut = personas_autorizadas.rut AND ${BLOQUEO_ACTIVO}) AS bloqueada
         FROM personas_autorizadas WHERE ${cond.join(" AND ")}
        ORDER BY nombre LIMIT 500`,
      params
    );
    const [[tot]] = await pool.query("SELECT COUNT(*) AS total FROM personas_autorizadas");
    res.json({ ok: true, total: Number(tot.total), personas: filas.map(mapPersona) });
  } catch (err) {
    errorBd(res, "GET /api/personas", err);
  }
});

// Alta o edición (si el RUT ya existe, se actualiza)
app.post("/api/personas", async (req, res) => {
  const b = req.body || {};
  const r = extraerRut(b.rut);
  if (r.error) return res.status(400).json({ ok: false, error: errorRutPersona(r) });
  const nombre = String(b.nombre || "").replace(/\s+/g, " ").trim();
  if (nombre.length < 1 || nombre.length > 100) return res.status(400).json({ ok: false, error: "El nombre debe tener entre 1 y 100 caracteres" });
  const tipo = normalizarTipo(b.tipo);
  if (!tipo) return res.status(400).json({ ok: false, error: "Elija el tipo: estudiante, profesor o auxiliar" });
  let vigencia = null;
  if (b.vigencia_hasta) {
    vigencia = normalizarFecha(b.vigencia_hasta);
    if (!vigencia) return res.status(400).json({ ok: false, error: "La vigencia no es válida (use AAAA-MM-DD)" });
  }
  const activo = b.activo === undefined ? 1 : b.activo ? 1 : 0;
  try {
    await pool.query(
      `INSERT INTO personas_autorizadas (rut, nombre, tipo, es_guardia, activo, vigencia_hasta) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), tipo = VALUES(tipo), es_guardia = VALUES(es_guardia),
                               activo = VALUES(activo), vigencia_hasta = VALUES(vigencia_hasta)`,
      [r.rut, nombre, tipo, b.es_guardia ? 1 : 0, activo, vigencia]
    );
    res.json({ ok: true, persona: { rut: r.rut, nombre, tipo, es_guardia: !!b.es_guardia, activo: !!activo, vigencia_hasta: vigencia } });
  } catch (err) {
    errorBd(res, "POST /api/personas", err);
  }
});

// Importación desde CSV: rut; nombre; tipo; vigencia (opcional); guardia (opcional). Cuerpo: { csv: "texto" }
app.post("/api/personas/importar", async (req, res) => {
  const texto = req.body && req.body.csv;
  if (typeof texto !== "string" || !texto.trim()) return res.status(400).json({ ok: false, error: "El archivo está vacío" });
  const filas = parsearCsv(texto);
  if (filas.length > CONFIG.maxFilasImportacion + 1) {
    return res.status(400).json({ ok: false, error: `El archivo tiene demasiadas filas (máximo ${CONFIG.maxFilasImportacion})` });
  }
  const { personas, errores } = validarFilasPersonas(filas);
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    let nuevas = 0;
    let actualizadas = 0;
    for (const p of personas) {
      // Se compara con lo que ya hay para informar nuevas, actualizadas y sin cambios
      const [previa] = await conn.query(
        "SELECT nombre, tipo, es_guardia, activo, DATE_FORMAT(vigencia_hasta, '%Y-%m-%d') AS vigencia FROM personas_autorizadas WHERE rut = ?",
        [p.rut]
      );
      if (!previa.length) nuevas++;
      else {
        const q = previa[0];
        const igual = q.nombre === p.nombre && q.tipo === p.tipo && !!q.es_guardia === !!p.es_guardia && !!q.activo && (q.vigencia || null) === p.vigencia_hasta;
        if (!igual) actualizadas++;
      }
      await conn.query(
        `INSERT INTO personas_autorizadas (rut, nombre, tipo, es_guardia, activo, vigencia_hasta) VALUES (?, ?, ?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), tipo = VALUES(tipo), es_guardia = VALUES(es_guardia),
                                 activo = 1, vigencia_hasta = VALUES(vigencia_hasta)`,
        [p.rut, p.nombre, p.tipo, p.es_guardia, p.vigencia_hasta]
      );
    }
    await conn.commit();
    res.json({
      ok: true,
      leidas: personas.length + errores.length,
      nuevas,
      actualizadas,
      sin_cambios: personas.length - nuevas - actualizadas,
      con_error: errores.length,
      errores: errores.slice(0, 50),
    });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    errorBd(res, "POST /api/personas/importar", err);
  } finally {
    if (conn) conn.release();
  }
});

// Activa o desactiva a una persona (no borra nada: sus accesos pasados se conservan)
app.post("/api/personas/:rut/estado", async (req, res) => {
  const r = extraerRut(req.params.rut);
  if (r.error) return res.status(400).json({ ok: false, error: errorRutPersona(r) });
  const activo = req.body && req.body.activo ? 1 : 0;
  try {
    const [u] = await pool.query("UPDATE personas_autorizadas SET activo = ? WHERE rut = ?", [activo, r.rut]);
    if (!u.affectedRows) return res.status(404).json({ ok: false, error: "Esa persona no está en la lista" });
    res.json({ ok: true, rut: r.rut, activo: !!activo });
  } catch (err) {
    errorBd(res, "POST /api/personas/:rut/estado", err);
  }
});

// Quita a la persona de la lista (sus accesos pasados se conservan, pero ya no podrá entrar)
app.delete("/api/personas/:rut", async (req, res) => {
  const r = extraerRut(req.params.rut);
  if (r.error) return res.status(400).json({ ok: false, error: errorRutPersona(r) });
  try {
    const [d] = await pool.query("DELETE FROM personas_autorizadas WHERE rut = ?", [r.rut]);
    res.json({ ok: true, eliminada: d.affectedRows > 0 });
  } catch (err) {
    errorBd(res, "DELETE /api/personas", err);
  }
});

// ---------- Bloqueos de entrada ----------
// Bloquean la entrada de una persona por uno o más días (fecha_desde a fecha_hasta), todo el día
// o solo en un horario (hora_desde a hora_hasta, cada día del rango). La justificación es obligatoria.
const esHora = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v || "");

// Parámetros: rut (opcional), vista (vigentes = activos o programados, por defecto; todos)
app.get("/api/bloqueos", async (req, res) => {
  const cond = [];
  const params = [];
  if (req.query.rut) {
    const r = extraerRut(req.query.rut);
    if (r.error) return res.status(400).json({ ok: false, error: errorRutPersona(r) });
    cond.push("b.rut = ?");
    params.push(r.rut);
  }
  if (req.query.vista !== "todos") cond.push("b.fecha_hasta >= CURDATE()");
  try {
    const [filas] = await pool.query(
      `SELECT b.id, b.rut, p.nombre, DATE_FORMAT(b.fecha_desde, '%Y-%m-%d') AS fecha_desde,
              DATE_FORMAT(b.fecha_hasta, '%Y-%m-%d') AS fecha_hasta,
              TIME_FORMAT(b.hora_desde, '%H:%i') AS hora_desde, TIME_FORMAT(b.hora_hasta, '%H:%i') AS hora_hasta,
              b.justificacion, DATE_FORMAT(b.creado_en, '%d-%m-%Y %H:%i') AS creado_en,
              (${BLOQUEO_ACTIVO}) AS activo_ahora,
              (b.fecha_hasta < CURDATE() OR (b.fecha_hasta = CURDATE() AND b.hora_hasta IS NOT NULL AND CURTIME() >= b.hora_hasta)) AS terminado
         FROM bloqueos b LEFT JOIN personas_autorizadas p ON p.rut = b.rut
         ${cond.length ? "WHERE " + cond.join(" AND ") : ""}
        ORDER BY b.fecha_desde DESC, b.id DESC LIMIT 500`,
      params
    );
    res.json({
      ok: true,
      bloqueos: filas.map((f) => ({
        ...f,
        estado: Number(f.activo_ahora) ? "activo" : Number(f.terminado) ? "terminado" : "programado",
        activo_ahora: undefined,
        terminado: undefined,
      })),
    });
  } catch (err) {
    errorBd(res, "GET /api/bloqueos", err);
  }
});

// Crea un bloqueo: { rut, fecha_desde, fecha_hasta?, hora_desde?, hora_hasta?, justificacion }
app.post("/api/bloqueos", async (req, res) => {
  const b = req.body || {};
  const r = extraerRut(b.rut);
  if (r.error) return res.status(400).json({ ok: false, error: errorRutPersona(r) });
  const desde = normalizarFecha(b.fecha_desde);
  if (!desde) return res.status(400).json({ ok: false, error: "Indique la fecha de inicio del bloqueo" });
  const hasta = b.fecha_hasta ? normalizarFecha(b.fecha_hasta) : desde;
  if (!hasta) return res.status(400).json({ ok: false, error: "La fecha de término no es válida" });
  if (hasta < desde) return res.status(400).json({ ok: false, error: "La fecha de término no puede ser anterior a la de inicio" });
  const hd = String(b.hora_desde || "").trim().slice(0, 5);
  const hh = String(b.hora_hasta || "").trim().slice(0, 5);
  if (hd || hh) {
    if (!esHora(hd) || !esHora(hh)) return res.status(400).json({ ok: false, error: "Indique ambas horas (desde y hasta) o deje las dos vacías para bloquear el día completo" });
    if (hd >= hh) return res.status(400).json({ ok: false, error: "La hora 'desde' debe ser anterior a la hora 'hasta' (no se admiten horarios que crucen la medianoche)" });
  }
  const justificacion = String(b.justificacion || "").replace(/\s+/g, " ").trim();
  if (justificacion.length < 5) return res.status(400).json({ ok: false, error: "Escriba la justificación del bloqueo (mínimo 5 caracteres)" });
  if (justificacion.length > 255) return res.status(400).json({ ok: false, error: "La justificación no puede superar los 255 caracteres" });
  try {
    const [[hoy]] = await pool.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS f");
    if (hasta < hoy.f) return res.status(400).json({ ok: false, error: "El bloqueo terminaría antes de hoy" });
    const [p] = await pool.query("SELECT nombre FROM personas_autorizadas WHERE rut = ?", [r.rut]);
    if (!p.length) return res.status(404).json({ ok: false, error: "Esa persona no está en la lista de autorizados" });
    const [ins] = await pool.query(
      "INSERT INTO bloqueos (rut, fecha_desde, fecha_hasta, hora_desde, hora_hasta, justificacion) VALUES (?, ?, ?, ?, ?, ?)",
      [r.rut, desde, hasta, hd || null, hh || null, justificacion]
    );
    res.json({ ok: true, bloqueo: { id: ins.insertId, rut: r.rut, nombre: p[0].nombre, fecha_desde: desde, fecha_hasta: hasta,
      hora_desde: hd || null, hora_hasta: hh || null, justificacion } });
  } catch (err) {
    errorBd(res, "POST /api/bloqueos", err);
  }
});

// Quita un bloqueo (la persona vuelve a poder entrar si no tiene otro)
app.delete("/api/bloqueos/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!(id > 0)) return res.status(400).json({ ok: false, error: "Bloqueo no válido" });
  try {
    const [d] = await pool.query("DELETE FROM bloqueos WHERE id = ?", [id]);
    res.json({ ok: true, eliminado: d.affectedRows > 0 });
  } catch (err) {
    errorBd(res, "DELETE /api/bloqueos", err);
  }
});

// ---------- App móvil ----------
// Datos de una persona para la app: estado, últimos accesos y resumen de hoy de la sede.
// El prototipo no tiene inicio de sesión (etapa 4): basta con el RUT, por eso solo responde en este equipo.
app.get("/api/movil/:rut", async (req, res) => {
  const r = extraerRut(req.params.rut);
  if (r.error) return res.status(400).json({ ok: false, error: "El RUT no es válido. Revisa el número y el dígito verificador." });
  try {
    const [[p]] = await pool.query(
      `SELECT rut, nombre, tipo, es_guardia, activo, vigencia_hasta,
              (vigencia_hasta IS NOT NULL AND vigencia_hasta < CURDATE()) AS vencida
         FROM personas_autorizadas WHERE rut = ?`, [r.rut]);
    if (!p) return res.status(404).json({ ok: false, error: "Este RUT no está en la lista de personas autorizadas." });
    const [accesos] = await pool.query(
      `SELECT DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha,
              TIME_FORMAT(hora_entrada, '%H:%i') AS entrada, TIME_FORMAT(hora_salida, '%H:%i') AS salida,
              TIME_FORMAT(TIMEDIFF(hora_salida, hora_entrada), '%H:%i') AS permanencia
         FROM accesos WHERE rut = ? ORDER BY fecha DESC, hora_entrada DESC, id DESC LIMIT 30`, [r.rut]);
    const [[hoy]] = await pool.query(
      `SELECT COUNT(*) AS entradas, COALESCE(SUM(hora_salida IS NULL), 0) AS dentro
         FROM accesos WHERE fecha = CURDATE()`);
    const [[rech]] = await pool.query("SELECT COUNT(*) AS n FROM intentos_rechazados WHERE fecha = CURDATE()");
    const [[fh]] = await pool.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoy, DATE_FORMAT(CURDATE() - INTERVAL 1 DAY, '%Y-%m-%d') AS ayer");
    const bloqueo = await bloqueoActivo(pool, r.rut);
    res.json({
      bloqueo,
      ok: true,
      hoy: fh.hoy,
      ayer: fh.ayer,
      persona: {
        ...mapPersona(p),
        estado: !Number(p.activo) ? "inactivo" : Number(p.vencida) ? "vencido" : "activo",
      },
      accesos,
      sede: { entradasHoy: Number(hoy.entradas), dentroAhora: Number(hoy.dentro), rechazosHoy: Number(rech.n) },
    });
  } catch (err) {
    errorBd(res, "/api/movil", err);
  }
});

// Código QR dinámico de una persona autorizada (vence a los CONFIG.qrSegundos)
app.get("/api/movil/:rut/qr", async (req, res) => {
  const r = extraerRut(req.params.rut);
  if (r.error) return res.status(400).json({ ok: false, error: "El RUT no es válido." });
  try {
    const [f] = await pool.query("SELECT 1 FROM personas_autorizadas WHERE rut = ?", [r.rut]);
    if (!f.length) return res.status(404).json({ ok: false, error: "Este RUT no está en la lista de personas autorizadas." });
    res.json({ ok: true, ...emitirQr(r.rut) });
  } catch (err) {
    errorBd(res, "/api/movil/qr", err);
  }
});

// Configuración visible del lector (para el panel)
app.get("/api/config", (req, res) => {
  res.json({ ok: true, qrSegundos: CONFIG.qrSegundos, qrEstatico: CONFIG.qrEstatico, antiRebote: CONFIG.segundosAntiRebote });
});

// ---------- Estadísticas ----------
// Parámetros: desde, hasta (AAAA-MM-DD). Por defecto, los últimos 30 días (incluido hoy).
app.get("/api/estadisticas", async (req, res) => {
  const desde = req.query.desde || null;
  const hasta = req.query.hasta || null;
  if (desde && !esFecha(desde)) return res.status(400).json({ ok: false, error: "La fecha 'desde' no es válida (use AAAA-MM-DD)" });
  if (hasta && !esFecha(hasta)) return res.status(400).json({ ok: false, error: "La fecha 'hasta' no es válida (use AAAA-MM-DD)" });
  if (desde && hasta && desde > hasta) return res.status(400).json({ ok: false, error: "La fecha 'desde' no puede ser posterior a 'hasta'" });
  try {
    const [[rango]] = await pool.query(
      `SELECT DATE_FORMAT(COALESCE(?, CURDATE() - INTERVAL 29 DAY), '%Y-%m-%d') AS desde,
              DATE_FORMAT(COALESCE(?, CURDATE()), '%Y-%m-%d') AS hasta`,
      [desde, hasta]
    );
    const p = [rango.desde, rango.hasta];
    const enRango = "a.fecha BETWEEN ? AND ?";
    const desdeAccesos = "FROM accesos a LEFT JOIN personas_autorizadas p ON p.rut = a.rut WHERE " + enRango;

    const [[res1]] = await pool.query(
      `SELECT COUNT(*) AS entradas, COUNT(DISTINCT a.rut) AS personas, COUNT(DISTINCT a.fecha) AS dias,
              AVG(CASE WHEN a.hora_salida IS NOT NULL
                       THEN TIME_TO_SEC(TIMEDIFF(a.hora_salida, a.hora_entrada)) / 60 END) AS permanencia
         FROM accesos a WHERE ${enRango}`, p);
    const [[dentro]] = await pool.query(
      "SELECT COUNT(*) AS n FROM accesos WHERE fecha = CURDATE() AND hora_salida IS NULL");
    const [porMotivo] = await pool.query(
      `SELECT i.motivo, COUNT(*) AS n FROM intentos_rechazados i
        WHERE i.fecha BETWEEN ? AND ? GROUP BY i.motivo ORDER BY n DESC`, p);
    const [porTipo] = await pool.query(
      `SELECT COALESCE(p.tipo, 'sin_registrar') AS tipo, COUNT(*) AS n ${desdeAccesos} GROUP BY 1`, p);
    const [porDiaSemana] = await pool.query(
      `SELECT WEEKDAY(a.fecha) AS dia, COUNT(*) AS n ${desdeAccesos} GROUP BY 1`, p);
    const [porHora] = await pool.query(
      `SELECT HOUR(a.hora_entrada) AS hora, COUNT(*) AS n ${desdeAccesos} GROUP BY 1`, p);
    const [porDia] = await pool.query(
      `SELECT DATE_FORMAT(a.fecha, '%Y-%m-%d') AS fecha, COUNT(*) AS n ${desdeAccesos} GROUP BY a.fecha ORDER BY a.fecha`, p);
    const [top] = await pool.query(
      `SELECT a.rut, p.nombre, p.tipo, COUNT(*) AS n ${desdeAccesos}
        GROUP BY a.rut, p.nombre, p.tipo ORDER BY n DESC, p.nombre LIMIT 5`, p);

    const entradas = Number(res1.entradas);
    const rechazos = porMotivo.reduce((s, f) => s + Number(f.n), 0);
    const dias = Number(res1.dias);
    res.json({
      ok: true,
      desde: rango.desde,
      hasta: rango.hasta,
      resumen: {
        entradas,
        personas: Number(res1.personas),
        diasConActividad: dias,
        promedioDiario: dias ? Math.round((entradas / dias) * 10) / 10 : 0,
        permanenciaMinutos: res1.permanencia == null ? null : Math.round(Number(res1.permanencia)),
        dentroAhora: Number(dentro.n),
        rechazos,
        porcentajeRechazo: entradas + rechazos ? Math.round((rechazos / (entradas + rechazos)) * 1000) / 10 : 0,
      },
      porTipo: porTipo.map((f) => ({ tipo: f.tipo, n: Number(f.n) })),
      porDiaSemana: porDiaSemana.map((f) => ({ dia: Number(f.dia), n: Number(f.n) })), // 0 = lunes
      porHora: porHora.map((f) => ({ hora: Number(f.hora), n: Number(f.n) })),
      porDia: porDia.map((f) => ({ fecha: f.fecha, n: Number(f.n) })),
      rechazosPorMotivo: porMotivo.map((f) => ({ motivo: f.motivo, texto: MOTIVOS[f.motivo] || f.motivo, n: Number(f.n) })),
      top: top.map((f) => ({ rut: f.rut, nombre: f.nombre, tipo: f.tipo, n: Number(f.n) })),
    });
  } catch (err) {
    errorBd(res, "/api/estadisticas", err);
  }
});

// Exporta las funciones para pruebas
module.exports = { emitirQr, leerQrDinamico, extraerRut, digitoVerificador, construirFiltro, parsearCsv, validarFilasPersonas, normalizarFecha, normalizarTipo };

if (require.main === module) {
  pool
    .query("SELECT 1")
    .then(() => asegurarTablas())
    .then(() => console.log(`Base de datos "${CONFIG.db.database}" conectada.`))
    .catch((e) => console.error(`No se pudo conectar a MySQL: ${e.message}\n¿Está encendido MySQL en XAMPP y creaste la base con schema.sql?`));
  app.listen(CONFIG.puerto, CONFIG.host, () => console.log(`QRonos listo: abre http://localhost:${CONFIG.puerto}`));
}
