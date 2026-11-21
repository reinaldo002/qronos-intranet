# QRonos · Prototipo: estado, siguiente versión y pendientes

Documento único (reúne el estado del prototipo y lo que entendimos de la siguiente versión). Actualizado el 19 de noviembre de 2026.

- Proyecto: QRonos (PRY-QRONOS-2026-01), empresa Zentra Core, IP Santo Tomás La Serena, Sede Ruta 5.
- Equipo: Bruno Guajardo (Director y Scrum Master), Reinaldo Castillo (Product Owner), Vicente Pereira (Dev Lead), Renato Cornejo (Infra Lead) y Benjamín Rodríguez (Ops Lead).
- **(por confirmar)** = interpretación mía que necesita un sí o un no del equipo.

## Índice

1. Resumen
2. Pendientes (lo que falta hacer)
3. Estado actual del prototipo (versión 4)
4. Siguiente versión: lo que pidió el equipo
5. Reglas, módulos, análisis y QR dinámico
6. Etapas y criterios de aceptación
7. Preguntas abiertas
8. Relación con la documentación

---

## 1. Resumen

- **Hoy (versión 5, etapa 1):** el prototipo lee con la cámara del PC el QR de la credencial, saca el RUT y **solo deja entrar a las personas de la lista de autorizados**, con tipo (Estudiante, Profesor o Auxiliar). Guarda entrada y salida en MySQL (XAMPP), registra los intentos rechazados y permite importar la lista desde CSV. Mantiene los filtros, la exportación a CSV y el diseño Santo Tomás.
- **Lo que viene:** filtros por semana y mes con análisis de datos (etapa 2), QR dinámico (etapa 3) e integración, inicio de sesión y bitácora (etapa 4).
- **Lo que no está probado:** la cámara real con la credencial real.
- **Dónde está el código:** carpeta `prototipo/` (sin comprimir) dentro de `Qronos` en el Escritorio.

---

## 2. Pendientes

### A. Validar lo que ya existe (lo más rápido)
- [ ] Instalar el prototipo en tu PC con XAMPP y arrancarlo.
- [ ] Probar la cámara con tu credencial real (prueba PL05). Si no lee, copiar el texto del cuadro de prueba para ajustar `extraerRut`.
- [ ] Sacar capturas reales de la página para el informe.

### B. Cerrar el informe final
- [ ] Completar los **34 campos `[COMPLETAR]`**: avance real, horas, resultados del piloto y marcha blanca, enlaces, acta firmada, captura real y estado de la Ley 21.719.
- [ ] Confirmar los supuestos que puse: $8.000 la hora, 8 horas por día y docentes guía (Paola Celis Lagos y Fernando Correa).
- [ ] Agregar la versión 4 (filtros y personas) a los capítulos 3 y 4 y a los manuales; hoy el informe documenta hasta la versión 3. *(Puedo hacerlo yo cuando lo pidas.)*
- [ ] Reemplazar el boceto de la interfaz por una captura real.

### C. Decisiones del equipo (reunión corta con Reinaldo y Bruno)
- [ ] ¿Cómo se identifica la persona para recibir su QR dinámico? (lo más seguro es el inicio de sesión de la intranet)
- [ ] ¿Se bloquea de inmediato la credencial estática actual o se acepta mientras tanto?
- [ ] ¿"Auxiliar" es personal de aseo y mantención? ¿El guardia es un tipo más o solo un rol?
- [ ] ¿Los administrativos del Acta son una categoría aparte de "auxiliar"?
- [ ] ¿Qué se hace con las visitas externas, que no estarán en la base?
- [ ] ¿De dónde sale la lista de autorizados: archivo de ejemplo o datos reales de la institución?
- [ ] ¿Cuánto tiempo se guardan los registros históricos?
- [ ] ¿Qué quiso decir Reinaldo con "centrado en el cliente"? Lo interpreté como experiencia de usuario.

### D. Programar la siguiente versión (por etapas, ver sección 6)
- [x] **Etapa 1 (hecha, 19-nov):** lista de autorizados, tipos, rechazo de no autorizados con registro e importación CSV. Probada con base de datos; falta probarla con la cámara real y con tu lista real.
  - [ ] Decidir si el guardia es un tipo o solo una marca (hoy es una casilla aparte, además del tipo).
  - [ ] Cargar la lista real de autorizados (hoy solo hay `ejemplo_personas.csv` con datos ficticios).
- [ ] **Etapa 2:** filtros por semana y mes, y panel de análisis.
- [ ] **Etapa 3:** QR dinámico y pantalla "Mi QR".
- [ ] **Etapa 4:** integración con Matrícula y RR.HH., inicio de sesión y bitácora.

### E. Extras propuestos (opcionales)
- [ ] Aforo en vivo y alertas de quien no marcó salida al cierre (23:00).
- [ ] Reportes en CSV y PDF.
- [ ] Visitas externas con pase temporal.
- [ ] Modo de contingencia con validación manual del guardia.
- [ ] Retención y eliminación segura de registros, y copia de seguridad de la base.

---

## 3. Estado actual del prototipo (versión 5, etapa 1)

> **Cambios de la versión 5 (etapa 1)** sobre lo descrito en las secciones 3.1 a 3.7, que corresponden a la versión 4:
> - Ya no entra cualquier RUT: solo los de la tabla `personas_autorizadas` (activos y con vigencia al día).
> - Nuevas tablas: `personas_autorizadas` (rut, nombre, tipo, es_guardia, activo, vigencia_hasta) e `intentos_rechazados` (rut_leido, fecha, hora, motivo). La tabla `personas` de la versión 4 ya no se usa.
> - Nuevos servicios: `GET /api/rechazados`, `POST /api/personas/importar` y `POST /api/personas/:rut/estado`. `POST /api/escaneo` responde 403 con `rechazado: true` y el motivo.
> - El filtro de tipo ahora es estudiante, profesor, auxiliar, guardia o sin registrar.
> - Página nueva: aviso "ACCESO NO AUTORIZADO", tarjeta de intentos rechazados, y personas con tipo, vigencia, editar, activar o desactivar e importar CSV.
> - Archivo nuevo: `prototipo/ejemplo_personas.csv` (datos ficticios).
> - Pruebas hechas: rechazo por no estar en la lista, por desactivación y por vigencia vencida; QR sin RUT; anti-rebote de rechazos; importación con errores por línea; filtros; CSV; actualización desde la base de la versión 4; y la página en Chromium. Siguen sin probarse la cámara real y los torniquetes.
> - Límites que siguen: QR estático, sin inicio de sesión ni bitácora, sin integración con Matrícula ni RR.HH., sin análisis ni filtros por semana y mes.

### 3.1 Archivos

| Archivo | Para qué sirve |
|---|---|
| `qronos-prototipo.zip` | Prototipo completo: servidor, página, base de datos e instalación |
| `schema.sql` | Crea la base `qronos` con las tablas `accesos` y `personas` |
| `actualizar_prototipo.sql` | Solo si importaste la versión 1: quita el tipo y la tabla de personas antigua |
| `InformeFinal_QRonos.docx` | Informe final de 36 páginas según la pauta del PDF |
| `Eva2gestion.docx` | Informe de Gestión de Personas con los roles ajustados |
| `Plan_RRHH_Equipo_Ideal_QRonos.docx` | Equipo ideal: roles, cargos, organigrama y RACI |

Dentro del zip: `server.js` (335 líneas), `public/index.html` (407 líneas), `public/jsQR.js`, `public/logo.png`, `package.json`, `schema.sql`, `actualizar_prototipo.sql` y `README.md`.

### 3.2 Puesta en marcha
1. Abre XAMPP y pulsa **Start** en **MySQL** (Apache no hace falta).
2. En phpMyAdmin (`http://localhost/phpmyadmin`), pestaña **Importar**, elige `schema.sql`.
3. En la carpeta del prototipo: `npm install` (solo la primera vez) y `node server.js`.
4. Abre `http://localhost:3000` en Chrome o Edge, permite la cámara y muestra el QR.
5. Sin cámara: pega un RUT válido en el cuadro de prueba y pulsa **Enviar**.

Requisitos: Node.js LTS, XAMPP y Chrome o Edge (la cámara solo funciona en `localhost` o con HTTPS).

| Variable | Por defecto | Para qué |
|---|---|---|
| `PORT` | 3000 | Puerto de la página |
| `HOST` | 127.0.0.1 | Solo este equipo; `0.0.0.0` abre la red (bajo tu responsabilidad) |
| `DB_HOST` / `DB_PORT` | 127.0.0.1 / 3306 | Dónde está MySQL |
| `DB_USER` / `DB_PASSWORD` | root / vacía | Acceso a MySQL |
| `DB_NAME` | qronos | Nombre de la base |
| `ANTI_REBOTE` | 15 | Segundos en que una segunda lectura del mismo RUT se ignora |

### 3.3 Qué hace hoy
- **Lectura:** cámara del PC con jsQR (cada 150 ms). Acepta el RUT con o sin puntos y guion, pegado (por ejemplo `217782996`, como trae la credencial) o dentro de una URL. Valida el dígito verificador (módulo 11, con K).
- **Entrada y salida:** la primera lectura del día es entrada, la siguiente es salida y otra posterior abre una nueva entrada. Anti-rebote de 15 s en el servidor y 4 s en el navegador.
- **Filtros:** fecha desde y hasta (por defecto, hoy), RUT o nombre, tipo (guardia o no) y estado (dentro o salió). Botones **Hoy** y **Limpiar**.
- **Tabla:** RUT, nombre, tipo, fecha, entrada, salida y permanencia; resumen de registros y cuántos siguen adentro; actualización cada 10 s.
- **Exportar CSV** con los mismos filtros (separador `;`, UTF-8, abre directo en Excel).
- **Personas (opcional):** RUT, nombre y si es guardia. Si el RUT no está, el acceso se registra igual como "Sin registrar". Quitar a una persona no borra sus accesos.
- **Diseño:** colores institucionales (`#004F45`, `#004438`, `#BBE29B`), Georgia, escudo, onda decorativa y modo oscuro.
- **Seguridad básica:** solo responde en este equipo, consultas parametrizadas, `textContent` contra XSS y CSV a prueba de fórmulas.

### 3.4 Datos y servicios

| Tabla | Campos |
|---|---|
| `accesos` | id, rut (VARCHAR 10), fecha, hora_entrada, hora_salida (puede ser nula); índice por rut y fecha |
| `personas` | rut (clave), nombre, es_guardia |

| Servicio | Qué hace |
|---|---|
| `POST /api/escaneo` | Recibe el texto del QR y registra entrada o salida |
| `GET /api/accesos` | Lista con filtros `desde`, `hasta`, `buscar`, `tipo`, `estado` y `limite` |
| `GET /api/accesos.csv` | Los mismos filtros, como descarga CSV |
| `GET /api/personas` | Lista de personas |
| `POST /api/personas` | Agrega o actualiza una persona |
| `DELETE /api/personas/:rut` | Quita una persona |

### 3.5 Cómo evolucionó

| Versión | Qué traía | Decisión que la originó |
|---|---|---|
| v1 | Lectura de QR, entrada y salida, tipo Estudiante o Profesor | Pedido inicial |
| v2 | Dinámico: cualquier RUT válido, sin tipos | "Al ser prototipo que sea dinámico" |
| v3 | Diseño más Santo Tomás | Pedido de diseño |
| v4 | Filtros, CSV, nombre y tipo guardia | "Agrega filtrado, nombre y tipo guardia" |
| v5 (pendiente) | Solo autorizados, tipos, análisis y QR dinámico | Chat de Reinaldo y Bruno del 19-nov |

### 3.6 Qué se probó
- **Probado** (en un entorno de prueba con MariaDB 10.11): formatos de RUT válidos e inválidos, secuencia entrada, salida y nueva entrada, anti-rebote, migración desde la versión anterior, filtros combinados, CSV, alta y baja de personas, prueba de la página con navegador simulado y revisión contra XSS.
- **No probado:** la cámara real con la credencial real, varios lectores a la vez, volumen alto y el uso con torniquetes.

### 3.7 Límites (hay que decirlos en la defensa)
- **El QR de la credencial es estático y trae solo el RUT.** Una foto del QR sirve para entrar (incidencia I-04 del informe).
- Acepta cualquier RUT válido; no comprueba que la persona pertenezca a la institución.
- Solo distingue "guardia o no"; no hay estudiante, profesor ni auxiliar.
- Sin inicio de sesión ni bitácora, por eso solo responde en `127.0.0.1`.
- Sin conexión con Matrícula ni RR.HH., y sin control de torniquetes.
- No registra intentos rechazados y no tiene análisis de datos.
- Ley N.º 21.719: entra en vigencia el 1 de diciembre de 2026; el Senado aprobó postergarla al 15 de octubre de 2027 (pendiente la Cámara) **(por confirmar el estado actual)**.

---

## 4. Siguiente versión: lo que pidió el equipo

Resumen en una frase: pasar de registrar cualquier RUT a un sistema que **solo deja entrar a personas autorizadas** de una base de datos, con **tipo de persona**, **QR dinámico**, **registro histórico con filtros por fecha, semana y mes** y **análisis** de cuándo y a qué hora entra y sale más gente.

| # | Pedido (quién) | Cómo lo entendí | Módulo |
|---|---|---|---|
| 1 | "Centrado en el cliente" (Reinaldo) | Diseño pensado en la comunidad (rápido, desde el celular) y en la Administración (información clara). **(por confirmar)** | Transversal |
| 2 | "Gestión" (Reinaldo) | Panel para agregar, editar, desactivar e importar personas autorizadas | Gestión |
| 3 | "Registro histórico" (Reinaldo) | Conservar todos los accesos y consultarlos de días y meses pasados | Registro |
| 4 | "Filtrado" (Reinaldo) y "filtros por mes y semanas" (Bruno) | Filtrar por rango de fechas, semana, mes, RUT o nombre, tipo y estado | Registro |
| 5 | "Control de acceso" (Reinaldo) | Decidir en cada lectura si puede entrar y registrar los rechazos | Control de acceso |
| 6 | "Estudiante, profesor, auxiliar" (Reinaldo) | Tres tipos de persona autorizada; vuelve el tipo que habíamos sacado | Personas |
| 7 | Análisis de datos (Bruno) | Qué día viene más gente y a qué hora entra y sale más | Análisis |
| 8 | Base de personas autorizadas (Bruno) | Tabla maestra con RUT, nombre, tipo y vigencia | Personas |
| 9 | QR dinámico "con esos datos" (Bruno) | QR que cambia cada pocos segundos, emitido solo a personas de esa base | QR dinámico |
| 10 | "Solo acepte las credenciales de los que están en esa base" (Bruno) | Si el RUT no está autorizado, se rechaza | Control de acceso |

Qué cambia respecto de la versión actual:

| Tema | Hoy (v4) | Siguiente versión |
|---|---|---|
| Quién puede entrar | Cualquier RUT válido | Solo RUT autorizados y vigentes |
| Tipo | "Guardia o no", opcional | Estudiante, Profesor o Auxiliar, obligatorio y tomado de la base |
| Nombre | Opcional | Viene de la base autorizada |
| Credencial | QR estático (solo RUT) | QR dinámico firmado; el estático solo en transición |
| Filtros | Fecha, RUT o nombre, tipo y estado | Se suman semana y mes |
| Análisis | No existe | Panel con día, hora y comparaciones |
| Rechazos | No se registran | Se registran con motivo |
| Decisiones anteriores | Prototipo dinámico y sin tipos | **Se reemplazan**: control estricto y con tipos |

---

## 5. Reglas, módulos, análisis y QR dinámico

### 5.1 Reglas del negocio
- **RN-01 Solo autorizados:** se acepta únicamente si el RUT está en la base, activo y con vigencia al día.
- **RN-02 Rechazo con motivo:** si no se acepta, muestra "No autorizado" y guarda el intento (fecha, hora y motivo: no está en la base, vencido o inactivo).
- **RN-03 Tipo desde la base:** el tipo se lee de la base, nunca del QR.
- **RN-04 Entrada y salida:** se mantiene la lógica actual y el anti-rebote de 15 s.
- **RN-05 QR dinámico:** código firmado por el servidor, vence a los 60 segundos y sirve una sola vez; no lleva nombre ni tipo a la vista.
- **RN-06 Transición:** mientras no exista el QR dinámico, la credencial estática se acepta solo si el RUT está autorizado (menos seguro). **(por confirmar)**
- **RN-07 Historial:** los registros no se editan; quitar a una persona no borra sus accesos pasados.

### 5.2 Módulos y pantallas
1. **Control de acceso (lector):** cámara, aviso grande de "Acceso permitido" o "No autorizado", nombre y tipo.
2. **Registros:** historial con filtros por fecha, semana, mes, RUT o nombre, tipo y estado, y exportación a CSV.
3. **Análisis:** gráficos y tablas.
4. **Personas autorizadas:** alta, edición, desactivación, vigencia e importación desde CSV o Excel.
5. **Mi QR:** pantalla del celular que muestra el QR dinámico y lo renueva cada 60 segundos.
6. **Intentos rechazados:** lista de lecturas no autorizadas para la Administración.

### 5.3 Análisis de datos
Preguntas que debe responder:
- ¿Qué día de la semana entra más gente? (total y promedio por día)
- ¿A qué hora entra más gente y a qué hora sale más? (franjas de una hora)
- ¿Cuántas personas hay dentro de la sede ahora?
- ¿Cuánto permanece la gente? (promedio por tipo)
- ¿Cómo se compara una semana o un mes con otro?
- ¿Cuántos intentos rechazados hay y por qué motivo?

Presentación propuesta: barras por día, mapa de calor día por hora, línea por semana y tabla de horas pico, todo respetando los filtros.

Definiciones **(por confirmar)**: la semana va de lunes a domingo, el mes es el calendario y una franja es una hora completa.

### 5.4 Datos propuestos

| Tabla | Para qué | Campos principales |
|---|---|---|
| `personas_autorizadas` | Quién puede entrar | rut, nombre, tipo, estado, vigencia_hasta |
| `accesos` | Entradas y salidas | id, rut, fecha, hora_entrada, hora_salida, metodo |
| `intentos_rechazados` | Lecturas no autorizadas | id, rut leído, fecha y hora, motivo |
| `tokens_qr` | QR dinámicos emitidos | id, rut, emitido_en, expira_en, usado |
| `usuarios_admin` | Quién administra | usuario, clave cifrada, rol |
| `bitacora` | Quién consultó o cambió qué | usuario, acción, fecha y hora |

- **Carga de la base:** primero por CSV o Excel (RUT, nombre, tipo, vigencia); después, sincronización con Matrícula y RR.HH. por API.
- **Privacidad:** Leyes N.º 19.628 y N.º 21.719: datos mínimos, acceso por roles, bitácora y plazo de retención definido por la institución.

### 5.5 QR dinámico: cómo lo entendí
1. La persona abre "Mi QR" en su celular e **identifica** quién es **(por confirmar cómo)**.
2. El servidor comprueba que su RUT esté autorizado y vigente.
3. Genera un código firmado que vence a los 60 segundos y lo muestra como QR, que se renueva solo.
4. El lector lo lee y lo envía al servidor.
5. El servidor verifica firma, vencimiento, que no se haya usado y que la persona siga autorizada; si todo está bien, registra la entrada o la salida.

Esto cubre el riesgo de fraude del plan de riesgos (QR reutilizado, vencido o captura de pantalla).

---

## 6. Etapas y criterios de aceptación

| Etapa | Contenido | Se acepta cuando |
|---|---|---|
| 1 | Base autorizada, tipos, "solo autorizados", rechazos registrados e importación CSV | Un RUT fuera de la base se rechaza y queda registrado; uno autorizado entra con nombre y tipo |
| 2 | Filtros por semana y mes, y panel de análisis | Las estadísticas coinciden con una consulta manual |
| 3 | QR dinámico y "Mi QR" | Un QR vencido, reutilizado o sin firma se rechaza en el 100% de las pruebas |
| 4 | Integración con Matrícula y RR.HH., inicio de sesión y bitácora | La base se actualiza sin carga manual y toda consulta queda en la bitácora |

Recomendación: partir por la etapa 1, porque cambia las reglas y las demás dependen de ella.

---

## 7. Preguntas abiertas

Son las de la sección 2C. Las que más bloquean: cómo se identifica la persona para el QR dinámico, qué pasa con la credencial estática y de dónde sale la lista de autorizados.

---

## 8. Relación con la documentación

- Cumple el alcance de prototipo del Acta de Constitución (lectura de QR, registro de entrada y salida, consulta).
- La siguiente versión cubre los entregables de software del Acta: backend de autenticación, integración con bases institucionales y QR dinámico.
- El QR estático y su fraude corresponden al riesgo 9 del Plan de Gestión de Riesgos; la integración con Matrícula y RR.HH., al riesgo 4.
- Coincide con los requisitos funcionales RF01 a RF04, RF09 y RF10 del capítulo 5.3 del informe final.

## Fuentes

- Documentos del proyecto: Acta de Constitución (secciones 2 y 3), Registro de Interesados (interesado 11), Plan de Gestión de Riesgos (riesgos 4, 7 y 9), KPI, Carta Gantt, Requerimientos de Comunicaciones y `entrega final proyecto.pdf`.
- Código del prototipo: `server.js`, `public/index.html`, `schema.sql` y `README.md` dentro de `qronos-prototipo.zip`.
- Conversación del equipo (Reinaldo y Bruno), 19 de noviembre de 2026.
- Informe final del proyecto, capítulo 5.3.
- Garrigues (2026), estado de la Ley N.º 21.719.
