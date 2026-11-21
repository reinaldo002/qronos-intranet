-- QRonos · esquema de base de datos (versión 5)
-- Uso: mysql qronos < database/schema.sql

CREATE TABLE IF NOT EXISTS personas_autorizadas (
  rut            VARCHAR(10)  NOT NULL PRIMARY KEY,           -- sin puntos, con guion: 21778299-6
  nombre         VARCHAR(120) NOT NULL,
  tipo           ENUM('Estudiante','Profesor','Auxiliar') NOT NULL,
  estado         ENUM('Activo','Inactivo') NOT NULL DEFAULT 'Activo',
  vigencia_hasta DATE         NOT NULL,
  origen         ENUM('Manual','CSV','Matricula','RRHH') NOT NULL DEFAULT 'Manual',
  actualizado_en TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS accesos (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  rut           VARCHAR(10) NOT NULL,
  fecha         DATE        NOT NULL,
  hora_entrada  TIME        NOT NULL,
  hora_salida   TIME        NULL,
  metodo        ENUM('QR','Manual','Visita') NOT NULL DEFAULT 'QR',
  punto_acceso  VARCHAR(60) NOT NULL,
  guardia       VARCHAR(60) NULL,
  INDEX idx_rut_fecha (rut, fecha),
  INDEX idx_fecha (fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS intentos_rechazados (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  rut_leido    VARCHAR(10) NULL,
  fecha_hora   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  motivo       ENUM('No está en la base','Persona inactiva','Vigencia vencida','QR vencido','QR ya utilizado','Firma inválida') NOT NULL,
  punto_acceso VARCHAR(60) NOT NULL,
  INDEX idx_fecha_hora (fecha_hora)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tokens_qr (
  id         CHAR(36)    NOT NULL PRIMARY KEY,                -- identificador único del código
  rut        VARCHAR(10) NOT NULL,
  emitido_en DATETIME    NOT NULL,
  expira_en  DATETIME    NOT NULL,
  usado      TINYINT(1)  NOT NULL DEFAULT 0,
  INDEX idx_expira (expira_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS usuarios_admin (
  usuario VARCHAR(60) NOT NULL PRIMARY KEY,                   -- usuario de la intranet
  nombre  VARCHAR(120) NOT NULL,
  rol     ENUM('Guardia','Administracion','AdministradorTI') NOT NULL,
  activo  TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bitacora (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuario    VARCHAR(60)  NOT NULL,
  accion     VARCHAR(255) NOT NULL,                           -- ej.: "Exportó CSV 01-11 al 23-11"
  fecha_hora DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_fecha_hora (fecha_hora)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
