# Contrato entre etapas y estimado

Lo leen los tres niveles antes de escribir el Frame. El contrato y el estimado son iguales en chico, medio y grande; solo cambia cuántas etapas lo pasan de mano.

## Contrato entre etapas
Cada etapa recibe y deja este contrato compacto: **Goal · Scope y no-goals · Evidencia y decisiones · Artefactos · Criterios de aceptación · Riesgos abiertos · Estimado · Autoridad concedida.** Desde el Plan, cada fase suma su tabla de cableado (abajo).

Los criterios de aceptación se escriben como JSON, `[{"id": "c1", "criterio": "…", "evidencia": "cómo se prueba", "superficie": "dónde lo usa alguien", "clave": "la respuesta correcta", "autor_clave": "agente, aprobó Ana", "peldano": 4, "estado": "pendiente"}]`. El evaluador (etapa 6) los usa como rúbrica y `estado` pasa a `pasa`, `falla` o `sin-clave` con su evidencia.

`peldano` dice qué tan independiente es la clave, de más a menos fuerte: **1** sistema anterior o paridad; **2** snapshot de un resultado bueno; **3** suite independiente del código; **4** spec previa al código; **5** ninguna, el agente decide qué es correcto. `autor_clave` es `sistema`, `persona:<quién>`, `agente, aprobó <quién>` o `agente`. Sin clave, `clave` y `autor_clave` van en `null`. Una clave que produjo quien construye y nadie aprobó es peldaño 5, sea cual sea su forma, también un snapshot o una suite propios.

Al pedir el sí, cada clave que propone el agente se dice en lenguaje claro y sin el JSON, y de ellas solo sube la que se le mostró a la persona y aceptó. Lo que quede en peldaño 5 se dice aparte: «esto nadie lo comprobará contra una respuesta ajena: <flujo>». Las claves aprobadas quedan escritas antes de construir, con commit: en el reporte del Frame o en el plan; en chico (`--una`) y `--fix`, en un reporte de la tarjeta. Esa es la copia contra la que se compara, y solo un sí nuevo la actualiza. Un criterio en peldaño 5 no se marca `pasa` por opinión: su `estado` es `sin-clave`, con lo observado como evidencia, salvo un fallo observable, que es `falla`. `sin-clave` no bloquea, porque ya se avisó, y va al reporte final.

## Cableado comprobable con grep
Código limpio, probado y revisado que nadie importa, registra ni muestra no sirve. Por eso el Plan lleva, en el contrato de **cada fase** (o carril), una tabla «punto de registro → grep que lo prueba»: una fila por cada lugar donde lo nuevo se engancha al resto del sistema.

| Punto de registro | Grep que lo prueba | Espera |
|---|---|---|
| ruta `GET /api/x` montada | `grep -n "api/x" server/routes/index.js` | ≥1 |
| clave i18n `x.titulo` en es y en | `grep -c '"titulo"' src/i18n/locales/es/x.json src/i18n/locales/en/x.json` | 1 en cada uno |
| `crearX` exportada e importada | `grep -rln "crearX" src --include=*.js` | ≥2 archivos |
| hook enganchado | `grep -n "x-hook" .claude/settings.json` | ≥1 |

- **Qué entra:** rutas, menús y pestañas registrados, claves i18n en los dos idiomas, exports con al menos un importador fuera de su archivo, hooks, crons, migraciones en la lista que las aplica y flags leídos donde se usan. Una fase sin punto de registro (un refactor interno) lo dice en una fila: «sin cableado nuevo».
- **Cómo se escribe:** cada grep va completo y copiable, con ruta y sin `<marcadores>`, y su columna «Espera» dice el resultado que pasa. Es un grep contra el código, no una prueba: corre en segundos.
- **Al cerrar la fase**, antes de marcarla hecha, quien la cerró corre la tabla y anota en `plan.md` cada fila con `pasa` o `falla` y la salida recortada. Una sola `falla` deja la fase abierta: se cablea y se vuelve a correr la tabla, o la fase termina `BLOCKED` con la fila que falló. No se cierra con «se integra en la fase siguiente»: eso va a la tabla de la fase siguiente, con su porqué.
- **Al integrar**, la revisión de integración vuelve a correr las tablas de todas las fases sobre la rama final, porque un merge entre carriles puede deshacer un registro.

**Estimado** = horas de **reloj** con carriles en paralelo, no la suma de las fases: la ruta crítica es el carril más largo, más la integración, el merge final y el deploy. Si la suma difiere, muestra las dos cifras: "reloj 3,5 h (suma 9 h): backend+migración 2 h ∥ menú y config 1 h ∥ vistas 1,5 h → integración y e2e 0,75 h → merge 0,25 h → deploy 0,5 h; supuesto: la CI remota está en línea". **El estimado siempre sale calibrado por lo medido**, nunca crudo, y cubre el **trabajo**; la espera de una persona va aparte. Pasos:
  1. **Crudo** solo de lo que se estima a ojo: la implementación de cada carril y la integración.
  2. **Fases medidas**: verificar, revisar y entregar (CI, revisión, cola, merge y deploy) no se estiman a ojo: se toma la mediana real de sus etapas en el repo (`stages` de `builds_calibration`).
  3. **Factor del repo**: `builds_calibration` con `repo` (`<dueño>/<repo>`) da `factor` (mediana de trabajo ÷ estimado de los últimos 30 builds entregados del repo) y `p80`. El factor solo multiplica lo estimado a ojo; las fases medidas se suman tal cual. Promesa: **«≈ crudo × factor + fases medidas, a más tardar crudo × p80 + fases medidas»**, redondeado a 0,25 h, con la línea de dónde sale: "≈0,75 h, a más tardar 1 h: crudo 1,5 h × 0,35 (p80 0,58, 30 builds de sielay) + verificar, revisar y entregar 0,25 h medidos". Con `source: "all"` dilo ("factor de todos los repos: el repo tiene pocos builds").
  4. **Espera aparte**: la espera de una persona (gates, el sí de alguien, el turno en una cola de merge) no entra en `total_h`; se muestra en su línea con la mediana del repo (`wait_h_median`), sobre todo en `<repo donde manda la espera>`: "espera de personas aparte: mediana 2 h por build".
  Sin `builds_calibration` (un hub anterior), la razón sale de `builds_weekly` (sección «Real / estimated hours»: la mediana del mismo `kind` con 3 builds o más, si no la de todos); sin herramienta ni datos, ×0,4, y las fases medidas se estiman a ojo. El calibrado es el que va en `estimate.total_h` (el «a más tardar» y la espera, en `assumption`) y el que se le promete a la persona. En el Frame va grueso; en el Plan va por carril y es el **programado** que se aprueba. Si después se mueve, se reestima con un motivo (ver `references/reporte-sielay.md`); reestimar no es una enmienda.

Los tres niveles calculan el estimado así, con `builds_calibration`: la razón sale del repo en curso, nunca de una cifra escrita en esta skill.
