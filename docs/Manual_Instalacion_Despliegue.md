# Manual de Instalación y Despliegue · QRonos

Guía paso a paso para levantar QRonos desde cero e integrarlo a la intranet de la institución.

- **Dirigido a:** equipo de TI e infraestructura de la sede
- **Versión del sistema:** 5 (control solo de autorizados y QR dinámico)
- **Tiempo estimado:** 3 a 4 horas para el servidor, más 30 minutos por cada punto de acceso

---

## Índice

1. Arquitectura de la solución
2. Requisitos
3. Paso 1: preparar el servidor
4. Paso 2: crear la base de datos
5. Paso 3: instalar la aplicación
6. Paso 4: configurar las variables de entorno
7. Paso 5: dejar QRonos como servicio
8. Paso 6: publicar con HTTPS (Nginx)
9. Paso 7: integrar con la intranet
10. Paso 8: cargar las personas autorizadas
11. Paso 9: preparar los puntos de acceso (lectores y torniquetes)
12. Paso 10: verificar la instalación
13. Respaldo, actualización y retención de datos
14. Solución de problemas

---

## 1. Arquitectura de la solución

```
 Celular de la persona                 Punto de acceso (guardia)
 ┌────────────────────┐                ┌──────────────────────────┐
 │ Intranet → Mi QR    │                │ Equipo lector + cámara    │
 │ (QR dinámico 60 s)  │── se muestra ─▶│ Navegador en modo kiosco  │
 └─────────┬──────────┘                │ Página "Lector de acceso" │
           │ HTTPS                     └───────────┬──────────────┘
           ▼                                       │ HTTPS
 ┌───────────────────────────────────────────────────────────────┐
 │ Servidor QRonos (red interna)                                 │
 │  Nginx (HTTPS, /qronos) ──▶ Node.js (puerto 3000) ──▶ MySQL    │
 └───────┬──────────────────────────────┬────────────────────────┘
         │ OpenID Connect                │ Sincronización diaria
         ▼                               ▼
 Proveedor de identidad           Sistemas de Matrícula y RR.HH.
 de la intranet (SSO)             (personas vigentes)
                                          │
 Controlador del torniquete ◀── señal de apertura desde el lector
```

**Cómo funciona:**

1. La persona entra a la intranet con su cuenta institucional y abre **Mi QR de acceso**.
2. QRonos comprueba que su RUT esté en la base de autorizados, activo y vigente. Si es así, genera un código firmado que vence en 60 segundos.
3. El lector del acceso lee el código y lo envía al servidor.
4. El servidor revisa la firma, el vencimiento, que el código no se haya usado y que la persona siga autorizada. Después registra la entrada o la salida y responde al lector.
5. Si el acceso es permitido, el lector envía la señal de apertura al torniquete. Si no, se guarda el intento rechazado con su motivo.

---

## 2. Requisitos

### 2.1 Servidor

| Recurso | Mínimo | Recomendado |
|---|---|---|
| Sistema operativo | Ubuntu Server 22.04 LTS | Ubuntu Server 24.04 LTS |
| CPU | 2 núcleos | 4 núcleos |
| Memoria RAM | 4 GB | 8 GB |
| Disco | 40 GB | 80 GB SSD |
| Red | IP fija en la red interna | IP fija y nombre DNS interno |

> También funciona en Windows Server con XAMPP (MySQL) y Node.js, como en el prototipo. Para producción se recomienda Linux por estabilidad y seguridad.

### 2.2 Software

| Componente | Versión | Uso |
|---|---|---|
| Node.js | 20 LTS | Ejecuta la aplicación |
| MySQL o MariaDB | 8.0 / 10.11 | Base de datos |
| Nginx | 1.24 o superior | Proxy inverso con HTTPS |
| Git | 2.x | Descargar el repositorio |
| Certificado TLS | Interno o público | La cámara del lector solo funciona con HTTPS |

### 2.3 Puntos de acceso

- Un equipo por acceso (mini PC o tablet) con Chrome o Edge
- Cámara USB o integrada, de al menos 720p
- Conexión a la red interna, de preferencia por cable
- Torniquete con controlador que acepte una señal de apertura (relé o API del fabricante)
- Gabinete con protección IP65 contra la humedad salina de La Serena

### 2.4 Datos que debe entregar la institución

- Cuenta de servicio o URL del proveedor de identidad de la intranet (OpenID Connect)
- Acceso de solo lectura a Matrícula y RR.HH., o una exportación CSV diaria
- Nombre DNS interno para QRonos, por ejemplo `qronos.intranet.institucion.cl`
- Plazo de retención de los registros de acceso

---

## 3. Paso 1: preparar el servidor

Instala los paquetes base:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git nginx mariadb-server curl ufw
```

Instala Node.js 20 LTS:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # debe mostrar v20.x
```

Crea un usuario de sistema para la aplicación:

```bash
sudo useradd --system --create-home --home-dir /opt/qronos --shell /usr/sbin/nologin qronos
```

Abre en el cortafuegos solo lo necesario:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

> El puerto 3000 de Node.js **no** se abre al exterior. Solo Nginx lo usa, desde el mismo servidor.

---

## 4. Paso 2: crear la base de datos

Asegura la instalación de MariaDB:

```bash
sudo mysql_secure_installation
```

Crea la base y el usuario de la aplicación (cambia la clave):

```bash
sudo mysql -e "CREATE DATABASE qronos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER 'qronos_app'@'localhost' IDENTIFIED BY 'CAMBIAR_CLAVE_SEGURA';"
sudo mysql -e "GRANT SELECT, INSERT, UPDATE, DELETE ON qronos.* TO 'qronos_app'@'localhost'; FLUSH PRIVILEGES;"
```

Crea las tablas con el script del repositorio. Este comando se ejecuta **después del Paso 3**, cuando el repositorio ya está descargado:

```bash
sudo mysql qronos < /opt/qronos/app/docs/anexos_instalacion/schema_intranet.sql
```

| Tabla | Para qué sirve |
|---|---|
| `personas_autorizadas` | Quién puede entrar: RUT, nombre, tipo, estado y vigencia |
| `accesos` | Entradas y salidas registradas |
| `intentos_rechazados` | Lecturas no autorizadas con su motivo |
| `tokens_qr` | QR dinámicos emitidos (vencimiento y uso único) |
| `usuarios_admin` | Roles de quienes administran el sistema |
| `bitacora` | Quién consultó o cambió qué y cuándo |

---

## 5. Paso 3: instalar la aplicación

```bash
sudo -u qronos git clone <URL_DEL_REPOSITORIO> /opt/qronos/app
cd /opt/qronos/app/prototipo
sudo -u qronos npm ci --omit=dev
```

El código del sistema está en la carpeta `prototipo/` del repositorio; los manuales y sus anexos, en `docs/`.

> Si el servidor no tiene acceso a internet, copia la carpeta del proyecto (con `node_modules` incluida) desde un equipo que sí lo tenga.

---

## 6. Paso 4: configurar las variables de entorno

Copia el ejemplo y edítalo:

```bash
cd /opt/qronos/app
sudo -u qronos cp docs/anexos_instalacion/.env.example .env
sudo -u qronos nano .env
sudo chmod 600 .env
```

| Variable | Ejemplo | Para qué sirve |
|---|---|---|
| `PORT` | `3000` | Puerto interno de Node.js |
| `HOST` | `127.0.0.1` | Solo escucha localmente; Nginx publica hacia la red |
| `BASE_PATH` | `/qronos` | Ruta dentro de la intranet |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `3306` | Ubicación de la base de datos |
| `DB_USER` / `DB_PASSWORD` | `qronos_app` / clave | Credenciales de la base |
| `DB_NAME` | `qronos` | Nombre de la base |
| `ANTI_REBOTE` | `15` | Segundos en que una segunda lectura del mismo RUT se ignora |
| `QR_SECRETO` | 64 caracteres aleatorios | Clave para firmar los QR dinámicos |
| `QR_VIGENCIA` | `60` | Segundos de validez de cada QR |
| `OIDC_ISSUER` | URL del proveedor | Inicio de sesión de la intranet |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | Entregados por TI | Registro de QRonos como aplicación de la intranet |
| `OIDC_REDIRECT_URI` | `https://qronos.intranet.institucion.cl/qronos/auth/callback` | Retorno después del inicio de sesión |
| `SYNC_HORA` | `06:00` | Hora de la sincronización diaria con Matrícula y RR.HH. |
| `RETENCION_DIAS` | `365` | Días que se guardan los registros antes de eliminarlos |

Para generar la clave de firma del QR:

```bash
openssl rand -hex 32
```

> **Importante:** el archivo `.env` nunca se sube al repositorio. Ya está excluido en `.gitignore`.

---

## 7. Paso 5: dejar QRonos como servicio

Copia el archivo de servicio y actívalo:

```bash
sudo cp docs/anexos_instalacion/qronos.service /etc/systemd/system/qronos.service
sudo systemctl daemon-reload
sudo systemctl enable --now qronos
sudo systemctl status qronos     # debe decir "active (running)"
```

Para revisar los registros del servicio:

```bash
journalctl -u qronos -f
```

Así QRonos arranca solo al encender el servidor y se reinicia si falla.

---

## 8. Paso 6: publicar con HTTPS (Nginx)

1. Copia el certificado TLS en `/etc/ssl/qronos/` (`qronos.crt` y `qronos.key`).
2. Instala la configuración del repositorio:

```bash
sudo cp docs/anexos_instalacion/nginx-qronos.conf /etc/nginx/sites-available/qronos
sudo ln -s /etc/nginx/sites-available/qronos /etc/nginx/sites-enabled/qronos
sudo nginx -t && sudo systemctl reload nginx
```

3. Pide al equipo de redes que el nombre DNS interno apunte a la IP del servidor.
4. Abre `https://qronos.intranet.institucion.cl/qronos` desde un equipo de la red interna.

> **¿Por qué HTTPS?** El navegador solo permite usar la cámara del lector en páginas seguras (HTTPS) o en `localhost`.

---

## 9. Paso 7: integrar con la intranet

### 9.1 Inicio de sesión único (SSO)

1. Pide a TI que registre QRonos como aplicación cliente en el proveedor de identidad de la intranet (OpenID Connect).
2. Entrega la URL de retorno: `https://qronos.intranet.institucion.cl/qronos/auth/callback`.
3. Solicita que el token incluya el **RUT** de la persona (por ejemplo, en el atributo `rut` o `preferred_username`).
4. Copia en el `.env` los datos recibidos: `OIDC_ISSUER`, `OIDC_CLIENT_ID` y `OIDC_CLIENT_SECRET`.
5. Reinicia el servicio con `sudo systemctl restart qronos`.

Con esto, nadie crea una cuenta nueva: se entra con el mismo usuario y clave de la intranet.

### 9.2 Roles

| Rol en QRonos | Quién | Pantallas que ve |
|---|---|---|
| Usuario | Estudiantes, profesores y auxiliares | Mi QR de acceso |
| Guardia | Personal de seguridad | Lector de acceso y validación manual |
| Administración | Dirección de sede o Administración | Registros, Análisis, Personas autorizadas e Intentos rechazados |
| Administrador TI | Equipo de TI | Todo, más la configuración |

Los roles se asignan por grupo de la intranet (por ejemplo, `grp-guardias` y `grp-admin-sede`) o en la tabla `usuarios_admin`.

### 9.3 Acceso directo en el portal

Agrega un mosaico o un enlace en el menú de la intranet:

- **Nombre:** Mi QR de acceso
- **Descripción:** Código dinámico para entrar a la sede
- **URL:** `https://qronos.intranet.institucion.cl/qronos/mi-qr`
- **Visible para:** estudiantes, profesores y auxiliares vigentes

Para guardias y Administración, agrega otro enlace a `https://qronos.intranet.institucion.cl/qronos/` en su menú.

---

## 10. Paso 8: cargar las personas autorizadas

### Opción A: importación CSV (primera carga)

1. Prepara un archivo con el formato de `docs/anexos_instalacion/personas_ejemplo.csv`:

```
rut;nombre;tipo;vigencia_hasta
21778299-6;Camila Rojas Díaz;Estudiante;2026-12-31
13987456-0;Paula Contreras Leiva;Profesor;2027-03-31
```

2. Entra a **Personas autorizadas → Importar CSV / Excel** y sube el archivo.
3. Revisa el resumen: personas agregadas, actualizadas y filas con error (RUT inválido o tipo desconocido).

### Opción B: sincronización automática (operación normal)

- Todos los días, a la hora de `SYNC_HORA`, QRonos consulta Matrícula (estudiantes con matrícula vigente) y RR.HH. (profesores y auxiliares con contrato vigente).
- Quien deja de estar vigente queda **inactivo**, pero su historial no se borra.
- También se puede ejecutar a mano con el botón **Sincronizar Matrícula y RR.HH.**

---

## 11. Paso 9: preparar los puntos de acceso (lectores y torniquetes)

En cada acceso:

1. Instala el equipo lector dentro del gabinete IP65 y conecta la cámara enfocando la zona donde se muestra el celular.
2. Conecta el equipo a la red interna, de preferencia por cable.
3. Configura Chrome en **modo kiosco** para que abra solo la página del lector:

```
chrome --kiosk --app=https://qronos.intranet.institucion.cl/qronos/lector?punto=acceso-principal-1
```

4. Inicia sesión una vez con la cuenta del guardia o con una cuenta de servicio del lector.
5. Permite el uso de la cámara cuando el navegador lo pida.
6. Conecta la salida de apertura al controlador del torniquete (relé o API del fabricante, según el modelo instalado por el equipo de infraestructura).
7. Configura el **paso PMR** (puerta para personas con movilidad reducida) con su propio lector, o con apertura manual desde el lector del guardia.

---

## 12. Paso 10: verificar la instalación

| N.º | Prueba | Resultado esperado |
|---|---|---|
| 1 | `systemctl status qronos` | Servicio activo |
| 2 | Abrir la URL en el navegador | Pide el inicio de sesión de la intranet |
| 3 | Abrir Mi QR con una persona autorizada | Aparece el QR y se renueva cada 60 s |
| 4 | Leer ese QR en el lector | "Acceso permitido" y entrada registrada |
| 5 | Leer el mismo QR otra vez | "No autorizado · QR ya utilizado" |
| 6 | Leer una captura de pantalla antigua | "No autorizado · QR vencido" |
| 7 | Persona fuera de la base | No puede generar QR; si usa la credencial estática, queda en "Intentos rechazados" |
| 8 | Segunda lectura válida del mismo día | Registra la salida |
| 9 | Filtrar en Registros y exportar CSV | El archivo coincide con la tabla |
| 10 | Desconectar la red del lector | Aparece el aviso de contingencia y el guardia puede usar la validación manual |
| 11 | Tiempo de validación a las 08:00 | Menos de 5 segundos por persona |

---

## 13. Respaldo, actualización y retención de datos

### Respaldo diario de la base

Agrega esta tarea programada en el `crontab` de root:

```bash
0 2 * * * mysqldump --single-transaction qronos | gzip > /var/backups/qronos/qronos_$(date +\%F).sql.gz
0 3 * * * find /var/backups/qronos -name "*.sql.gz" -mtime +30 -delete
```

Copia los respaldos a otro servidor o al almacenamiento institucional.

### Restaurar un respaldo

```bash
gunzip -c /var/backups/qronos/qronos_2026-11-23.sql.gz | sudo mysql qronos
```

### Actualizar a una nueva versión

```bash
cd /opt/qronos/app
sudo -u qronos git pull
cd prototipo
sudo -u qronos npm ci --omit=dev
sudo systemctl restart qronos
```

### Retención (Leyes N.º 19.628 y 21.719)

- Los registros de acceso más antiguos que `RETENCION_DIAS` se eliminan automáticamente cada noche.
- La bitácora guarda quién consultó o exportó datos.
- Solo los roles Administración y Administrador TI ven el historial completo.

---

## 14. Solución de problemas

| Problema | Causa probable | Solución |
|---|---|---|
| La cámara no se activa | La página no está en HTTPS o se negó el permiso | Revisa el certificado y permite la cámara en el navegador |
| "No se puede conectar a la base de datos" | Clave o host incorrectos en `.env` | Revisa `DB_*` y que MariaDB esté activo (`systemctl status mariadb`) |
| Todos los QR salen "vencidos" | La hora del servidor está desfasada | Activa la sincronización de hora: `sudo timedatectl set-ntp true` |
| El inicio de sesión vuelve a la intranet con error | URL de retorno mal registrada | Compara `OIDC_REDIRECT_URI` con la registrada en el proveedor de identidad |
| Una persona vigente aparece "No autorizado" | Aún no se ejecuta la sincronización | Pulsa **Sincronizar** o agrégala a mano en Personas autorizadas |
| El torniquete no abre con acceso permitido | Falla en el relé o en el controlador | Revisa la conexión del controlador y usa la apertura manual mientras tanto |
| Lectura lenta en hora punta | Cámara mal enfocada o poca luz | Ajusta el enfoque y la iluminación del punto de acceso |

**Soporte:** Mesa de ayuda TI de la sede · Equipo Zentra Core (Vicente Pereira, Dev Lead; Renato Cornejo, Infra Lead).
