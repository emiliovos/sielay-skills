# Ejecución autónoma (etapas 4–7)

## Antes de lanzar agentes en paralelo
1. Si el repo trae compuerta, confirma que funciona y úsala tal cual. Si no la trae, no se agrega.
2. Red team del contrato y su enmienda (etapa 3).
4. Crea la rama de integración `build/<slug>` desde la rama principal actualizada. Todos los carriles arrancan a la vez (hasta la concurrencia de la ficha) sobre `contracts.md` congelado; ninguno espera el merge de otro salvo una dependencia declarada en el contrato.
5. Por carril:
   - su worktree (`/ak:worktree`, o `git worktree add ../{repo}-wt-{carril} -b {rama}` desde la rama principal actualizada, y luego instalar dependencias, una instalación a la vez); si ya lo preparaste mientras esperabas la aprobación, solo `git switch -c {rama}`;
   - su prefijo de borradores (`p<N>-`) y nombres de log únicos;
   - solo sus archivos, según la tabla de propiedad de `contracts.md`.

En `main directo` el aislamiento por worktree y el orden de integración se mantienen: el coordinador integra carril por carril en `build/<slug>` y al final empuja a main.

## Quién ejecuta
- **Subagentes:** `fullstack-developer` (implementa su carril y hace su verificación de uso), `docs-manager` (docs), `code-reviewer` (revisión con contexto fresco y red team), `researcher` / `Explore` (evidencia). Cada llamada lleva su `model` de la tabla «Modelo fijo por rol» de `SKILL.md`: `sonnet` para implementar y docs, `haiku` para leer y explorar, `opus` para la revisión fresca y el red team; nunca se omite. Si no existen con esos nombres, usa los de propósito general con el mismo encargo. Los subagentes de una sesión comparten scratchpad: nombres de archivo únicos.
- **Otra sesión de Claude Code** (otra terminal): con `--terminales`, según la tabla de reparto del plan y `terminales.md`. Sin el flag, solo si el usuario pide una sesión concreta en la conversación; si no, un subagente.
- **Todo encargo es autocontenido:**
  - la tarea;
  - las rutas absolutas del contrato y del plan;
  - qué archivos leer y cuáles puede tocar;
  - los criterios de aceptación y los guardarraíles;
  - qué cifras reportar;
  - dónde dejar borradores, prototipos y logs: un directorio desechable propio, fuera del repo, que reporta al terminar;
  - "no mergees, no empujes a main";
  - "si el trabajo sale de tus archivos o de los criterios, no lo hagas: descríbelo y termina con `BLOCKED` o `DONE_WITH_CONCERNS`";
  - "no cambies la `clave` de un criterio aprobado: repórtala y termina con `BLOCKED`";
  - "después de cada rebase, reinstala las dependencias antes de empujar";
  - que termine con `Status: DONE | DONE_WITH_CONCERNS | BLOCKED`.

  Quien verifica entrega un artefacto (log, captura, salida de comandos); "revisé el código" no cuenta como verificación.
  Un encargo termina en `DONE` solo con un artefacto citado: la ruta del log o de la captura, o el id de la corrida leído con `gh run view`. Sin artefacto, el estado es `BLOCKED`.
- **Un agente por carril, de punta a punta:** el que implementa hace su verificación de uso; no hay cadena implementador → tester → revisor. Solo el revisor es otro agente, con contexto fresco.
- **Tope por agente:** tras 3 vueltas sobre el mismo error, reemplázalo por un agente nuevo desde el último commit de su rama, con el error y lo ya intentado en el encargo. No repitas el mismo encargo.

## Durante
- **Verificar por carril:** la «Verificación de uso» de `SKILL.md` sobre lo que tocó el carril. Si el repo trae compuerta en CI remoto, además su corrida, sin pruebas locales.
- **Esperar la CI (solo si el repo trae compuerta en CI):** con `link_watch` (sielay-link 1.7.0 o posterior), pide al hub que avise y sigue con otra cosa; si falla, usa el respaldo. Respaldo: `gh pr checks <N> --watch --fail-fast` para un PR, o `gh run watch <id> --exit-status` para una corrida disparada a mano, siempre con `run_in_background`. Nunca Monitor ni bucles de `gh … --json | jq`. Verde es la corrida de `pull_request` (o la que el repo declare para el sello), no la de `push`. Si el workflow no corre en push, no esperes una corrida de push: no va a llegar.
- **Un solo coordinador integra y entrega**, en orden. Con la verificación de uso hecha y su revisión pasada, lo mezcla en `build/<slug>` (`git merge --no-ff`) y empuja. Si un carril resulta malo después, revierte su merge en `build/<slug>` y los demás siguen. Nadie más integra ni entrega.
- **Revisión adversarial por carril, según su riesgo** (`/ak:code-review` o un `code-reviewer`): alto, a fondo con confirmación; normal, a fondo; bajo, ligera. El esfuerzo del revisor es `medium` salvo en auth, seguridad, migraciones o datos de producción, que van con `high` (regla de la tabla «Modelo fijo por rol» de `SKILL.md`). Antes de la entrega, una **revisión de integración** del PR final: cómo encajan los carriles, no repetir cada uno. Los detalles técnicos los decides tú y reportas qué decidiste; las decisiones de producto se preguntan.
- **Evaluador (revisión del carril y del PR final).** Un revisor con contexto fresco, por riesgo: alto, a fondo con confirmación; normal, a fondo; bajo, ligero. Antes de la entrega, una revisión de integración del PR final: cómo encajan los carriles, no repetir cada uno. Reglas:
  - usa como rúbrica los criterios de aceptación en JSON del contrato, compara contra la copia aprobada de su `clave` (su ruta va en el encargo) y marca cada `estado` con su evidencia; en peldaño 5 marca `sin-clave`, no `pasa`, salvo un fallo observable, que es `falla`; una clave cambiada sin un sí nuevo es Critical;
  - reporta solo lo que afecta la corrección, la seguridad o los requisitos; el resto va como opcional y no bloquea. Pon esto en su encargo;
  - marca la **clase completa** del bug (todas las apariciones, con un grep), no una línea;
  - no repite hallazgos ya reportados;
  - máximo **3 vueltas** (1 en riesgo bajo). Cada vuelta corrige en lote todo lo Critical y High; desde la segunda, re-revisa **solo el diff nuevo**;
  - antes de declarar que pasa, el verificador repite la «Verificación de uso» sobre lo corregido.

  Lo que queda (pulido, Medium y Low) va al reporte o a un issue, no a otra vuelta. **Si tras la última vuelta sigue abierto algún Critical o High, no entregues**: para y reporta al usuario el hallazgo con las opciones. Los detalles técnicos los decides tú y reportas qué decidiste; las decisiones de producto se preguntan.
- **Verificación de uso una vez, sobre la integración.** En cuanto `build/<slug>` tenga un camino de punta a punta, hazla con la app arrancada en un entorno desechable (y repítela al integrar el último carril): build de producción, puerto propio, base de datos y datos temporales, y datos sembrados por las rutas reales. La evidencia va en `plans/{plan}/reports/capturas-*.md`. Antes de entregar, abre al menos una captura si hay UI.
- **Con UI, pasada «captura contra referencia, por pantalla»** antes de cerrar la etapa 5: compara cada pantalla de `build/<slug>` con su referencia aprobada (diseño, maqueta o captura previa). Cada diferencia se corrige o se acepta de forma explícita y va a la retro.
- Después de rebasar, reinstala las dependencias antes de empujar. Antes de lanzar un merge, confirma que el push del rebase llegó al remoto.
- Nunca `--no-verify`; nunca `git push | head`; nunca envolver el push o el merge en otro lock si la compuerta ya toma el suyo.
- Procesos: cada agente detiene solo sus PIDs (por PID, no con un patrón amplio), y nada de tocar la config de Claude Code ni sesiones ajenas.

## Al cerrar cada carril
- Actualiza el estado en `plan.md` y en el tracker (*si aplica*).
- Si reportas a sielay (`reporte-sielay.md`): `link_build_stage` con `plan_progress` (`done` + 1) y la `phase` que sigue en curso. Al entrar a la etapa 4, `total` es el número de carriles.
- Si el carril pasó su tope de tokens, ya paró en un punto seguro y reportó: decide si sigue, se parte o se reasigna.
- Compara las horas reales del carril contra su estimado. Si el total previsto se movió más que la tolerancia (±max(0,5 h, 10 % del programado)) o el carril se pasó, reestima con un motivo corto: en el contrato y, si reportas a sielay, con `estimate` completo y `reason` (`reporte-sielay.md`). No pide aprobación salvo que cambie el Goal, los criterios, los no-goals o la autoridad.
- Mide el contexto (`medir-contexto.mjs`, ver «Presupuesto de contexto» en `SKILL.md`): anota en `plan.md` el modelo y el contexto máximo del subagente o la terminal del carril, y corta con checkpoint si el coordinador llegó al umbral.
- Reporta al usuario en una línea.
- Anota la hora de inicio y fin de cada tramo (espera humana, evidencia y plan, implementación, revisión, CI, integración, merge, deploy) en `plan.md`, en UTC con `date -u +%FT%TZ` (es la ventana `--desde/--hasta` de `medir-contexto.mjs`): alimenta la tabla «dónde se fue el tiempo» del reporte final.
- Borra los worktrees y ramas locales de lo ya entregado; nunca una rama cuya entrega no confirmaste.
