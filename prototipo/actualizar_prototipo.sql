-- Solo si ya importaste la versión anterior de schema.sql (con tipo y tabla personas).
-- Quita el tipo y la tabla de personas, y conserva los accesos ya registrados.
-- Ejecutar en phpMyAdmin (pestaña SQL, con la base qronos) o con:
--   C:\xampp\mysql\bin\mysql -u root < actualizar_prototipo.sql

USE qronos;
ALTER TABLE accesos DROP FOREIGN KEY fk_accesos_persona;
ALTER TABLE accesos DROP COLUMN tipo;
DROP TABLE IF EXISTS personas;
