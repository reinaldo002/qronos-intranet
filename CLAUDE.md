# QRonos (PRY-QRONOS-2026-01): contexto del proyecto

Proyecto de control de acceso para la Sede Ruta 5 de Santo Tomás La Serena. Lo desarrolla Zentra Core. Reemplaza el sistema anterior, que fallaba y obligaba a mostrar el carnet físico.

## Objetivo
Automatizar las entradas principales de la sede con torniquetes con lectores automáticos y una app que genera códigos QR dinámicos (expiran en 1 minuto) para profesores, alumnos y administrativos. Las visitas externas se registran manualmente por los guardias con pases temporales.

## Criterios de éxito
- Registro del 100% de ingresos y salidas (identidad, fecha y hora).
- Acceso en menos de 5 segundos por persona, usando solo el celular.
- Disponibilidad técnica mínima del 99% en horario de funcionamiento.
- Despliegue y cierre a más tardar el 23 de noviembre de 2026.

## Alcance
- Incluye: backend API de autenticación, integración con las bases de datos de Matrícula y RR.HH., app móvil para generar QR, módulo de contingencia con validación manual y pases temporales, plan de gestión del cambio y protocolos legales de datos (Ley 19.628 y Ley 21.719).
- Excluye: accesos secundarios, otras sedes fuera de La Serena, y control automatizado de visitas externas.

## Equipo
- Patrocinador: Dirección / Administración de la Universidad.
- Director del proyecto y Scrum Master: Bruno Guajardo.
- Product Owner / cierre: Reinaldo Castillo.
- Dev Lead / arquitectura: Vicente Pereira.
- Infra Lead: Renato Cornejo.
- Ops Lead / gestión del cambio: Benjamín Rodríguez.

## Hitos
| Hito | Descripción | Fecha |
|---|---|---|
| 0 | Requerimientos y arquitectura aprobados | 6-oct-2026 |
| 1 | Software funcional y validación legal de datos | 20-oct-2026 |
| 2 | Infraestructura física instalada e integrada | 3-nov-2026 |
| 3 | Piloto operativo validado por el cliente | 10-nov-2026 |
| 4 | Despliegue e inicio de la marcha blanca | 17-nov-2026 |
| 5 | Cierre formal y traspaso de operación a TI | 23-nov-2026 |

## Riesgos conocidos
- Humedad y corrosión por clima costero y ambiente salino (torniquetes, lectores, conexiones).
- La Ley 21.719 de datos personales entra en vigencia el 1-dic-2026.
- Equipo pequeño: cada área depende de una sola persona.

## Indicadores (KPI)
Cumplimiento de hitos, avance de tareas por sprint, protocolos legales aprobados, guardias capacitados, incidentes críticos abiertos (meta: 0 al terminar la marcha blanca), riesgos críticos y altos con mitigación activa y entregables de cierre completos.

## Documentos de referencia (en esta carpeta)
- Acta_de_Constitucion_del_Proyecto.docx
- Proyecto_control_de_acceso.docx
- Gestion de riesgo.docx
- KPI.docx
- Requerimientos_de_Comunicaciones.docx
- Registro_de_Interesados.docx
- Carta_Gantt.gan
- entrega final proyecto.pdf

## Cómo trabajar aquí
- Responde en español.
- Antes de cambiar un documento, revisa su contenido y haz solo el cambio pedido.
- Si una fecha o cifra no aparece en los documentos, di que no lo sabes en lugar de inventarlo.
