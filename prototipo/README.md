# QRonos · Prototipo de control de acceso (versión 5, etapa 1)

Lee con la cámara del PC el QR de la credencial, obtiene el RUT y **deja entrar solo a las personas autorizadas**.
Registra en MySQL (XAMPP) el RUT, la fecha y la hora de entrada y de salida, y guarda los intentos rechazados.

## Qué trae esta versión
- **Lista de personas autorizadas** (RUT, nombre, tipo Estudiante, Profesor o Auxiliar, si es guardia, estado y vigencia).
- **Solo autorizados:** si el RUT no está en la lista, está desactivado o su vigencia venció, el acceso se rechaza.
- **Intentos rechazados:** cada rechazo queda guardado con fecha, hora y motivo, y se ve en la página.
- **Importación desde CSV** de la lista de personas (con informe de errores por línea).
- **Alta, edición, activar o desactivar y quitar** personas desde la página.
- **Bloqueos de entrada por persona**, por uno o más días (todo el día) o solo en un horario, siempre con **justificación obligatoria**. Ver "Bloqueos de entrada".
- Filtros de registros por fecha, RUT o nombre, tipo (estudiante, profesor, auxiliar, guardia o sin registrar) y estado, y exportación a CSV.

## Requisitos
- XAMPP (solo se usa MySQL; Apache no es necesario).
- Node.js versión LTS (https://nodejs.org).
- Chrome o Edge, abriendo la página desde http://localhost:3000 (la cámara solo funciona en localhost o HTTPS).

## Puesta en marcha
1. Abre el panel de XAMPP y pulsa **Start** en **MySQL**.
2. Crea la base de datos, con una de estas dos opciones:
   - phpMyAdmin (http://localhost/phpmyadmin): pestaña **Importar**, elige `schema.sql` y pulsa **Importar**.
   - Consola: `C:\xampp\mysql\bin\mysql -u root < schema.sql`
3. En una consola dentro de esta carpeta:
   - `npm install` (solo la primera vez)
   - `node server.js`
4. Abre http://localhost:3000, permite el acceso a la cámara.
5. **Carga la lista de autorizados:** en la tarjeta "Personas autorizadas" elige `ejemplo_personas.csv` y pulsa **Importar CSV** (o agrega personas una por una). Sin personas en la lista, nadie puede entrar.
6. Muestra el QR frente a la cámara.

### Si ya tenías la versión 4
- Importa `schema.sql` otra vez (no borra nada) o simplemente inicia el servidor: crea las tablas nuevas solas.
- Tus registros de acceso se conservan. La tabla `personas` de la versión 4 ya no se usa (queda intacta); carga las personas de nuevo con el CSV, ahora con su tipo.
- Si venías de la versión 1, importa antes `actualizar_prototipo.sql`.

## Cómo funciona
1. Se lee el QR y se obtiene el RUT (con o sin puntos y guion, pegado como `217782996`, o dentro de una URL). Se valida el dígito verificador.
2. Se busca el RUT en la lista de autorizados:
   - **No está, está desactivada o su vigencia venció:** se muestra "ACCESO NO AUTORIZADO" con el motivo y se guarda en intentos rechazados.
   - **Está autorizada:** se registra el acceso.
3. Entrada y salida:
   - Primera lectura del día: **entrada**.
   - Siguiente lectura: **salida** (completa la hora de salida).
   - Otra lectura después de la salida: **nueva entrada**.
   - Si el mismo RUT se lee de nuevo en menos de 15 segundos, se ignora.
4. El tipo y el nombre vienen siempre de la lista, nunca del QR.

Motivos de rechazo: `no_autorizado`, `inactivo`, `vencido`, `qr_no_reconocido` (el QR no trae un RUT válido), `qr_vencido` (el código de la app pasó su minuto), `qr_usado` (el código ya registró un acceso), `qr_invalido` (código alterado o no emitido por QRonos), `qr_estatico` (QR fijo, solo con `QR_ESTATICO=no`) y `bloqueado` (entrada bloqueada en ese día u horario). Las lecturas repetidas del mismo texto dentro de 15 segundos se guardan una sola vez.

## Bloqueos de entrada
En la pestaña **Personas**, tarjeta "Bloqueos de entrada" (o con el botón **Bloquear** de cada persona):
- **RUT** de una persona de la lista, **desde el día** y **hasta el día** (si se deja vacío, solo ese día).
- **Horario opcional:** sin horas se bloquea el día completo; con horas (por ejemplo 08:00 a 12:00) se bloquea solo ese tramo en cada día del rango. No se admiten horarios que crucen la medianoche (use dos bloqueos).
- **Justificación obligatoria** (5 a 255 caracteres). Se muestra al guardia en el lector y a la persona en la app móvil.
- Durante el bloqueo el lector responde "ENTRADA BLOQUEADA" con la justificación, también en la validación manual, y el intento queda en rechazados con el motivo `bloqueado`. **La salida nunca se bloquea**: si la persona ya estaba dentro, puede salir.
- En la lista de personas aparece "Bloqueada ahora". Un bloqueo se puede quitar en cualquier momento; los terminados se ven con "Mostrar: Todos".

## Importar personas desde CSV
- Columnas: `rut; nombre; tipo; vigencia; guardia` (`vigencia` y `guardia` son opcionales).
- Separador `;`, `,` o tabulación. La primera fila puede ser el encabezado.
- Tipo: `estudiante`, `profesor` o `auxiliar` (también se entiende `alumno` y `docente`).
- Vigencia: `AAAA-MM-DD`, `DD-MM-AAAA` o `DD/MM/AAAA`. Vacía significa sin límite.
- Guardia: `si` o vacío.
- Si el RUT ya existe, se actualiza (y se reactiva). Las filas con error se informan por línea y el resto se importa. Máximo 5.000 filas.
- Hay un ejemplo con personas ficticias en `ejemplo_personas.csv`.

## Probar sin cámara
En la página hay un cuadro para pegar el texto del QR o un RUT (por ejemplo `20.123.456-5` del CSV de ejemplo) y pulsar **Enviar**.

## Páginas
El diseño sigue la maqueta `qronos_prototipo_movil.html` (estilos comunes en `public/estilo.css`).
- **Panel de administración** (http://localhost:3000): pestañas Lector (cámara, resumen de hoy, estado del sistema y últimas lecturas), Registros (accesos e intentos rechazados), Personas, Estadísticas y Generar QR.
- **App móvil** (http://localhost:3000/movil.html): la persona entra con su RUT y ve su credencial con el QR, el estado de su acceso, sus últimos ingresos, su historial y la ayuda. El QR es **dinámico**: el servidor emite un código firmado (`QRONOS:<rut>:<vence>:<azar>:<firma>`) que vence en 60 segundos y sirve para un solo registro; la app pide uno nuevo cada minuto, con cuenta regresiva. Una foto o captura deja de servir al vencer, y un código alterado se rechaza.
  - Para abrirla desde un celular en la misma red Wi-Fi, inicia el servidor con `$env:HOST="0.0.0.0"; node server.js` y entra a `http://<IP del PC>:3000/movil.html`. Desde otros equipos solo se abre la app móvil (el panel responde 403); el panel se usa en el PC (`http://localhost:3000`). Con `ADMIN_REMOTO=si` el panel también se abre desde la red, bajo su responsabilidad. Si el celular no carga, falta permitir el puerto 3000 en el firewall de Windows para redes privadas (PowerShell como administrador): `New-NetFirewallRule -DisplayName "QRonos prototipo (puerto 3000)" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private`.
  - No hay inicio de sesión (etapa 4): con conocer un RUT autorizado se ven sus accesos.

## Generar QR de prueba
Abre http://localhost:3000/generar.html (o el enlace "Generar QR de prueba" en el lector). Elige una persona de la lista o escribe cualquier RUT o texto, y muestra el QR a la cámara desde otra pantalla o desde el celular (botón **Descargar PNG**). El QR trae solo el RUT, igual que la credencial (QR fijo). Es solo para pruebas; se acepta mientras `QR_ESTATICO` no sea `no`.

## Estadísticas
Abre http://localhost:3000/estadisticas.html (o el enlace "Ver estadísticas" en el lector). Por defecto muestra los últimos 30 días; se puede cambiar a 7 o 90 días o elegir un rango.
- Indicadores: entradas, personas distintas, promedio diario, permanencia promedio, personas dentro ahora y porcentaje de rechazo.
- Gráfico de torta con el porcentaje de entradas por tipo (estudiantes, profesores, auxiliares).
- Entradas por día de la semana (día con más y con menos ingresos), por hora (hora punta) y por fecha.
- Gráfico de torta de intentos rechazados por motivo y las 5 personas con más ingresos.
El prototipo registra una sola entrada (Ruta 5), así que no compara accesos entre sí.

## Datos de demostración
Para mostrar las estadísticas sin escanear durante semanas:
- `node datos_demo.js` crea 4 semanas (hasta ayer) de accesos y rechazos **ficticios** para las personas de `ejemplo_personas.csv` (las agrega a la lista si faltan). Si se ejecuta de nuevo, reemplaza los anteriores.
- `node datos_demo.js --borrar` los quita: borra los accesos anteriores a hoy de esas 8 personas de ejemplo y los rechazos ficticios. Lo registrado hoy no se toca.

## Configuración
Valores por defecto: MySQL en 127.0.0.1:3306, usuario `root`, sin contraseña, base `qronos`, página en el puerto 3000.
Se pueden cambiar con variables de entorno (`DB_PASSWORD`, `DB_NAME`, `DB_PORT`, `PORT`, `ANTI_REBOTE`, `HOST`).
QR dinámico: `QR_SEGUNDOS` (validez, 60 por defecto), `QR_SECRETO` (clave de firma; sin ella se crea una al iniciar y los códigos anteriores dejan de valer) y `QR_ESTATICO` (`si` por defecto: también acepta el QR fijo con el RUT durante la transición; con `no` solo vale el código de la app). La validación manual del guardia (cuadro de texto del lector) siempre acepta el RUT escrito.
Por seguridad, el servidor solo responde en este equipo (127.0.0.1), porque el prototipo no tiene inicio de sesión y permite agregar o quitar personas. Para abrirlo a la red use `HOST=0.0.0.0` bajo su responsabilidad. Ejemplo en PowerShell:

    $env:DB_PASSWORD="tu_clave"; node server.js

## Tablas
- `accesos`: id, rut, fecha, hora_entrada, hora_salida.
- `personas_autorizadas`: rut, nombre, tipo, es_guardia, activo, vigencia_hasta.
- `intentos_rechazados`: id, rut_leido, fecha, hora, motivo.
- `bloqueos`: id, rut, fecha_desde, fecha_hasta, hora_desde, hora_hasta, justificacion, creado_en.

## Servicios de la API
- `POST /api/escaneo`: recibe el texto del QR. Responde 200 con la entrada o salida, o 403 (rechazado) o 400 (QR sin RUT válido) con `rechazado: true` y el `motivo`.
- `GET /api/accesos`: lista con filtros `desde`, `hasta` (AAAA-MM-DD), `buscar`, `tipo` (`estudiante`, `profesor`, `auxiliar`, `guardia` o `sin_registrar`), `estado` (`dentro` o `salio`) y `limite`.
- `GET /api/accesos.csv`: los mismos filtros, descargados como CSV.
- `GET /api/rechazados`: intentos rechazados, con `desde`, `hasta` y `limite` (por defecto, los de hoy).
- `GET /api/movil/:rut/qr`: emite el código QR dinámico de la persona (`texto`, `ahora`, `vence`, `segundos`).
- `GET /api/config`: validez del QR dinámico, si se acepta el QR fijo y el anti-rebote.
- `GET /api/movil/:rut`: datos para la app móvil (persona y su estado, últimas 30 visitas y resumen de hoy de la sede). 404 si el RUT no está en la lista.
- `GET /api/estadisticas`: resumen, entradas por tipo, día de la semana, hora y fecha, rechazos por motivo y las 5 personas con más ingresos; con `desde` y `hasta` (por defecto, los últimos 30 días).
- `GET /api/personas`: lista con `q` (RUT o nombre), `tipo` y `estado` (`activo`, `inactivo` o `vencido`).
- `POST /api/personas`: alta o edición de una persona (`rut`, `nombre`, `tipo`, `vigencia_hasta`, `es_guardia`, `activo`).
- `POST /api/personas/importar`: importación desde CSV (`{ "csv": "texto" }`).
- `POST /api/personas/:rut/estado`: activa o desactiva (`{ "activo": true }`).
- `DELETE /api/personas/:rut`: quita a la persona de la lista (sus accesos pasados se conservan).
- `GET /api/bloqueos`: bloqueos activos y programados, con `rut` opcional y `vista=todos` para incluir los terminados. Cada uno trae `estado` (`activo`, `programado` o `terminado`).
- `POST /api/bloqueos`: crea un bloqueo (`rut`, `fecha_desde`, `fecha_hasta` opcional, `hora_desde` y `hora_hasta` opcionales, `justificacion` obligatoria).
- `DELETE /api/bloqueos/:id`: quita un bloqueo.

## Límites del prototipo
- Mientras `QR_ESTATICO` no sea `no`, el QR fijo de la credencial (solo el RUT) sigue sirviendo, y una foto de él también. El código de la app es dinámico.
- Los códigos ya usados se recuerdan en memoria: si se reinicia el servidor sin `QR_SECRETO`, todos los códigos anteriores dejan de valer (es lo esperado).
- Sin inicio de sesión ni bitácora (etapa 4), por eso solo responde en este equipo.
- No hay conexión con Matrícula ni RR.HH.: la lista se carga a mano o por CSV.
- No hay análisis de datos ni filtros por semana y mes (etapa 2).

## Problemas frecuentes
- **No se pudo conectar a MySQL**: revisa que MySQL esté en verde en XAMPP, que importaste `schema.sql` y la contraseña de `root`.
- **El puerto 3306 es otro** (por ejemplo 3307): usa `DB_PORT`.
- **No abre la cámara**: permite el acceso en el navegador y cierra otras apps que la estén usando.
- **El QR no se lee**: acerca o aleja el celular o la pantalla, sube el brillo y evita reflejos.
- **Todos salen "No autorizado"**: la lista está vacía o no incluye ese RUT; impórtala o agrega a la persona.
- **"El QR no contiene un RUT reconocible"**: el QR trae otro formato; copia el texto que muestra y ajusta `extraerRut` en `server.js`.
