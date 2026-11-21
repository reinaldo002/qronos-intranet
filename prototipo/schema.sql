-- QRonos · Prototipo de control de acceso · Versión 5 (etapa 1)
-- Importar en phpMyAdmin (XAMPP) o ejecutar: C:\xampp\mysql\bin\mysql -u root < schema.sql
-- Es seguro volver a importarlo: no borra nada. El servidor también crea las tablas nuevas al iniciar.

CREATE DATABASE IF NOT EXISTS qronos CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE qronos;

-- Un registro por visita: entrada y, cuando sale, la hora de salida.
-- El RUT va sin puntos y con guion, por ejemplo 12345678-9.
-- Solo se registran accesos de personas autorizadas (tabla personas_autorizadas).
CREATE TABLE IF NOT EXISTS accesos (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rut          VARCHAR(10)  NOT NULL,
  fecha        DATE NOT NULL,
  hora_entrada TIME NOT NULL,
  hora_salida  TIME NULL,
  INDEX idx_rut_fecha (rut, fecha)
) ENGINE=InnoDB;

-- Lista de personas que pueden entrar. Si el RUT no está, está desactivado
-- o su vigencia venció, el acceso se rechaza y se guarda en intentos_rechazados.
-- El tipo se toma de esta tabla, nunca del QR.
CREATE TABLE IF NOT EXISTS personas_autorizadas (
  rut            VARCHAR(10)  NOT NULL PRIMARY KEY,
  nombre         VARCHAR(100) NOT NULL,
  tipo           ENUM('estudiante','profesor','auxiliar') NOT NULL,
  es_guardia     TINYINT(1)   NOT NULL DEFAULT 0,
  activo         TINYINT(1)   NOT NULL DEFAULT 1,
  vigencia_hasta DATE NULL
) ENGINE=InnoDB;

-- Lecturas que no pudieron entrar. rut_leido guarda el RUT o, si el QR no trae un RUT válido,
-- los primeros 40 caracteres de lo que se leyó.
-- motivo: no_autorizado, inactivo, vencido o qr_no_reconocido
CREATE TABLE IF NOT EXISTS intentos_rechazados (
  id        INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rut_leido VARCHAR(40)  NOT NULL,
  fecha     DATE NOT NULL,
  hora      TIME NOT NULL,
  motivo    VARCHAR(20)  NOT NULL,
  INDEX idx_fecha (fecha),
  INDEX idx_leido (rut_leido, fecha)
) ENGINE=InnoDB;

-- Bloqueos de entrada por persona: rigen cada día entre fecha_desde y fecha_hasta,
-- todo el día (horas en NULL) o solo entre hora_desde y hora_hasta. Solo bloquean la entrada, no la salida.
-- Un intento durante un bloqueo se guarda en intentos_rechazados con motivo 'bloqueado'.
CREATE TABLE IF NOT EXISTS bloqueos (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rut           VARCHAR(10)  NOT NULL,
  fecha_desde   DATE NOT NULL,
  fecha_hasta   DATE NOT NULL,
  hora_desde    TIME NULL,
  hora_hasta    TIME NULL,
  justificacion VARCHAR(255) NOT NULL,
  creado_en     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rut_fechas (rut, fecha_desde, fecha_hasta)
) ENGINE=InnoDB;

-- La tabla personas de la versión 4 (nombre y es_guardia) ya no se usa; no se borra por si la necesitas.

-- Consultas útiles
-- Accesos de hoy:        SELECT a.*, p.nombre, p.tipo FROM accesos a LEFT JOIN personas_autorizadas p ON p.rut = a.rut WHERE a.fecha = CURDATE() ORDER BY a.id DESC;
-- Quién sigue adentro:   SELECT * FROM accesos WHERE fecha = CURDATE() AND hora_salida IS NULL;
-- Rechazos de hoy:       SELECT * FROM intentos_rechazados WHERE fecha = CURDATE() ORDER BY id DESC;
-- Quién puede entrar:    SELECT * FROM personas_autorizadas WHERE activo = 1 AND (vigencia_hasta IS NULL OR vigencia_hasta >= CURDATE());
