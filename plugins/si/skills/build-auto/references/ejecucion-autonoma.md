# Ejecución autónoma (etapas 4–7)

## Antes de lanzar agentes en paralelo
1. Confirma que la compuerta de pruebas del repo existe y funciona (`compuerta-de-pruebas.md`). Si no existe, no se agrega: cada carril usa la verificación que define el plan.
2. Corre `/ak:test audit` (o un agente de pruebas) acotado a las pruebas que tocará el plan. Arregla las inestables conocidas o acótalas con timeout: una prueba colgada con el lock de la suite frena a todos los carriles. Una inestable compartida la arregla el coordinador una vez, no cada carril.
3. Red team del contrato y su enmienda (etapa 3).
4. Crea la rama de integración `build/<slug>` desde la rama principal actualizada. Todos los carriles arrancan a la vez (hasta la concurrencia de la ficha) sobre `contracts.md` congelado; ninguno espera el merge de otro salvo una dependencia declarada en el contrato.
5. Por carril:
   - su worktree (`/ak:worktree`, o `git worktree add ../{repo}-wt-{carril} -b {rama}` desde la rama principal actualizada, y luego instalar dependencias, una instalación a la vez); si ya lo preparaste mientras esperabas la aprobación, solo `git switch -c {rama}`;
   - su prefijo de borradores (`p<N>-`) y nombres de log únicos;
   - solo sus archivos, según la tabla de propiedad de `contracts.md`.

En `main directo` el aislamiento por worktree y el orden de integración se mantienen: el coordinador integra carril por carril en `build/<slug>` y al final empuja a main por la compuerta.

## Quién ejecuta
- **Subagentes:** `fullstack-developer` (implementa y escribe las pruebas de su carril), `docs-manager` (docs), `code-reviewer` (revisión con contexto fresco y red team), `researcher` / `Explore` (evidencia). Cada llamada lleva su `model` de la tabla «Modelo fijo por rol» de `SKILL.md`: `sonnet` para implementar y docs, `haiku` para leer y explorar, `opus` para la revisión fresca y el red team; nunca se omite. Si no existen con esos nombres, usa los de propósito general con el mismo encargo. Los subagentes de una sesión comparten scratchpad: nombres de archivo únicos.
- **Otra sesión de Claude Code** (otra terminal): con `--terminales`, según la tabla de reparto del plan y `terminales.md`. Sin el flag, solo si el usuario pide una sesión concreta en la conversación; si no, un subagente.
- **Todo encargo es autocontenido:**
  - la tarea;
  - las rutas absolutas del contrato y del plan;
  - el `base_sha` del plan y el comando de deriva sobre sus rutas (sección «SHA base y deriva»);
  - qué archivos leer y cuáles puede tocar;
  - las condiciones de paro del plan, copiadas tal cual;
  - los criterios de aceptación y los guardarraíles;
  - qué cifras reportar;
  - dónde dejar borradores, prototipos y logs: un directorio desechable propio, fuera del repo, que reporta al terminar;
  - "no mergees, no empujes a main";
  - "si el trabajo sale de tus archivos o de los criterios, no lo hagas: descríbelo y termina con `BLOCKED` o `DONE_WITH_CONCERNS`";
  - "lo que veas fuera de tus archivos y de los criterios y no te frene (un bug vecino, una deuda, una prueba floja) va en una línea de `fuera-de-alcance.md`, no al diff" (sección «Fuera de alcance»);
  - "no cambies la `clave` de un criterio aprobado: repórtala y termina con `BLOCKED`";
  - "después de cada rebase, reinstala las dependencias antes de empujar";
  - que termine con `Status: DONE | DONE_WITH_CONCERNS | BLOCKED`.

  Quien verifica entrega un artefacto (log, captura, salida de comandos); "revisé el código" no cuenta como verificación.
  Un encargo termina en `DONE` solo con un artefacto citado: la ruta del log o de la captura, o el id de la corrida leído con `gh run view`. Sin artefacto, el estado es `BLOCKED`.
  Un carril que cierra sin la línea `Status:` cuenta como `BLOCKED`: no se integra, se anota así en `plan.md` y se trata como cualquier bloqueo.
- **Un agente por carril, de punta a punta:** el que implementa escribe sus pruebas; no hay cadena implementador → tester → revisor. Solo el revisor es otro agente, con contexto fresco.
- **Tope por agente:** tras 3 vueltas sobre el mismo error, reemplázalo por un agente nuevo desde el último commit de su rama, con el error y lo ya intentado en el encargo. No repitas el mismo encargo.

## SHA base y deriva
Un plan se escribe contra un estado del código; si la rama principal lo movió después, el ejecutor improvisa sobre un plan viejo. Vale en los tres niveles:
- **Cada plan anota de dónde parte.** El frontmatter de `plan.md` lleva `base_sha:`, el SHA de la rama principal del remoto al escribirlo (`git fetch` y `git rev-parse origin/<principal>`), y el plan nombra las rutas que toca. Un encargo sin plan propio lleva el mismo dato en su texto.
- **Cada plan lleva sus condiciones de paro.** Una sección «Condiciones de paro» con lo que, en este plan concreto, deja de cuadrar: una función o una ruta que ya no existe, una prueba que ya no falla como se esperaba, una cifra que salió fuera del rango del criterio. Se suman a las salidas genéricas del encargo, no las reemplazan.
- **Chequeo de deriva, dos veces:** antes de implementar (cada carril, al recibir el encargo) y antes de encolar el merge (el coordinador), con `git fetch` y `git diff --stat <base_sha>..origin/<principal> -- <rutas del plan>`. Salida vacía: sin deriva.
- **Si hay deriva, para y lo dice.** El carril termina con `BLOCKED` y la salida del comando; el coordinador lo anota en `plan.md` y en el reporte (`status: "blocked"`). Solo el coordinador reanuda: lee el diff de la deriva y, si el plan sigue valiendo, anota en `plan.md` el `base_sha` nuevo con una línea de por qué sigue valiendo; si no, el cambio sale de lo aprobado y se pregunta.
- Una condición de paro que se cumple funciona igual: `BLOCKED`, con la evidencia, y nadie la salta para terminar.

## Fuera de alcance
- **Un registro por build:** `fuera-de-alcance.md` en la carpeta del plan; en chico, que no tiene carpeta, una sección «Fuera de alcance» en el reporte final. Escriben los carriles y los revisores; el coordinador lo lee.
- **Una línea por hallazgo:** `AAMMDD HH:MM · carril · archivo:línea · qué vio · por qué no lo tocó · siguiente paso (issue, encargo o nada)`.
- **Anotarlo no amplía el alcance.** Tocar algo del registro pide la misma aprobación que un trabajo que crece (`SKILL.md`, «Aprobaciones»). El cierre lo cuenta (`cierre-y-retro.md`).

## Durante
- **Verificar por carril:** las pruebas afectadas o, si la compuerta corre en CI remoto, la corrida del workflow sobre el push del carril; con CI remoto no corras pruebas locales, tampoco en subagentes. Si el workflow del repo no corre en push, dispara la corrida del carril a mano (`gh workflow run <workflow> --ref <rama>`; solo sirve si la rama ya trae esa versión del workflow) o no esperes CI hasta el PR de integración. La CI que cuenta para la entrega es la de `build/<slug>`; la de un carril solo sirve para ver la rama, nunca se reusa para el sello (su head no es el del PR final), y solo vale como verificación si ese carril no comparte archivos con los demás.
- **Esperar la CI:** con `link_watch` (sielay-link 1.7.0 o posterior), pide al hub que avise y sigue con otra cosa; si falla, usa el respaldo. Respaldo: `gh pr checks <N> --watch --fail-fast` para un PR, o `gh run watch <id> --exit-status` para una corrida disparada a mano, siempre con `run_in_background`. Nunca Monitor ni bucles de `gh … --json | jq`. Verde es la corrida de `pull_request` (o la que el repo declare para el sello), no la de `push`. Si el workflow no corre en push, no esperes una corrida de push: no va a llegar.
- **Tope de 2 rondas rojas de CI**, por carril y por PR. Una ronda es una corrida del workflow que cuenta (la de la CI del carril o la del PR), sobre un head nuevo o relanzada sobre el mismo. Más rondas rinden cada vez menos: tras la segunda roja no hay tercera, el carril para y pasa a la persona con las dos clasificaciones, los ids de las corridas y las opciones. Este tope es aparte del «tope por agente», que cuenta vueltas locales sobre un error.
- **Clasifica cada rojo antes de reintentar**, con la evidencia del log (`gh run view <id> --log-failed`) y una fila en `plan.md` (ronda, id de la corrida, clase, evidencia):
  - `código`: el cambio rompe un comportamiento. Se arregla en el carril;
  - `prueba`: la prueba está mal o es inestable. Se arregla la prueba sin debilitarla; «inestable» se demuestra con la corrida, no se supone;
  - `entorno`: runner, red, dependencias, lock o cuota. No se toca el código: se arregla el entorno o se relanza la corrida, que cuenta como ronda.

  Sin clasificar no se reintenta. Si no sabes a qué clase va, cuenta como `código`.
- **Un solo coordinador integra y entrega**, en orden y siempre por la compuerta. Con la CI del carril en verde y su revisión pasada, lo mezcla en `build/<slug>` (`git merge --no-ff`) y empuja. Si un carril resulta malo después, revierte su merge en `build/<slug>` y los demás siguen. Nadie más integra ni entrega.
- **Revisión adversarial por carril, según su riesgo** (`/ak:code-review` o un `code-reviewer`): alto, a fondo con confirmación; normal, a fondo; bajo, ligera. El esfuerzo del revisor es `medium` salvo en auth, seguridad, migraciones o datos de producción, que van con `high` (regla de la tabla «Modelo fijo por rol» de `SKILL.md`). Antes de la entrega, una **revisión de integración** del PR final: cómo encajan los carriles, no repetir cada uno. **Re-revisión: solo el delta.** La primera revisión de un carril o del PR mira todo el cambio y se anota el SHA revisado; las siguientes miran `git diff <sha revisado>..HEAD`, y tras un rebase `git range-diff <base vieja>..<sha revisado> <base nueva>..HEAD`, para no releer lo que ya se revisó. Nada en los ganchos del repo exige revisar la punta completa cada vez; si algún repo lo exige, manda su regla y se dice en el Frame. Los detalles técnicos los decides tú y reportas qué decidiste; las decisiones de producto se preguntan.
- **Evaluador (revisión del carril y del PR final).** Un revisor con contexto fresco, por riesgo: alto, a fondo con confirmación; normal, a fondo; bajo, ligero. Antes de la entrega, una revisión de integración del PR final: cómo encajan los carriles, no repetir cada uno. Reglas:
  - usa como rúbrica los criterios de aceptación en JSON del contrato, compara contra la copia aprobada de su `clave` (su ruta va en el encargo) y marca cada `estado` con su evidencia; en peldaño 5 marca `sin-clave`, no `pasa`, salvo un fallo observable, que es `falla`; una clave cambiada sin un sí nuevo es Critical;
  - reporta solo lo que afecta la corrección, la seguridad o los requisitos; el resto va como opcional y no bloquea. Pon esto en su encargo;
  - marca la **clase completa** del bug (todas las apariciones, con un grep), no una línea;
  - no repite hallazgos ya reportados;
  - lo que vea fuera de los archivos y de los criterios del plan lo anota en `fuera-de-alcance.md` y no lo cuenta como hallazgo;
  - máximo **3 vueltas** (1 en riesgo bajo). Cada vuelta corrige en lote todo lo Critical y High; desde la segunda, re-revisa **solo el diff nuevo**;
  - reporta el conteo de Critical y High abiertos en cada vuelta. **Desde la segunda vuelta, si ese conteo no baja respecto a la anterior, para y escala** a la persona con los hallazgos, sin gastar la vuelta que queda;
  - antes de declarar que pasa, el verificador corre la **compuerta completa** del repo, no una o dos pruebas.

  Lo que queda (pulido, Medium y Low) va al reporte o a un issue, no a otra vuelta. **Si tras la última vuelta sigue abierto algún Critical o High, no entregues**: para y reporta al usuario el hallazgo con las opciones. Los detalles técnicos los decides tú y reportas qué decidiste; las decisiones de producto se preguntan.
- **Prueba real una vez, sobre la integración.** En cuanto `build/<slug>` tenga un camino de punta a punta, pruébalo con el sistema real en un entorno desechable (y repítelo al integrar el último carril):
  - build de producción, puerto propio, base de datos y datos temporales;
  - datos sembrados por las rutas reales, no insertados a mano; una captura de pantalla vacía no es evidencia, así que las capturas se toman con datos sembrados;
  - un script reejecutable;
  - evidencia en `plans/{plan}/reports/e2e-*.md`.

  Antes de entregar, abre al menos una captura si hay UI; si no, revisa la salida del script e2e. Muchas pruebas unitarias en verde no sustituyen esto.
- **Con UI, pasada «captura contra referencia, por pantalla»** antes de cerrar la etapa 5: compara cada pantalla de `build/<slug>` con su referencia aprobada (diseño, maqueta o captura previa). Cada diferencia se corrige o se acepta de forma explícita y va a la retro.
- Después de rebasar, reinstala las dependencias antes de empujar. Antes de lanzar un merge, confirma que el push del rebase llegó al remoto.
- Si la suite de otra sesión tiene el lock, espera tu turno; no la mates.
- Procesos: cada agente detiene solo sus PIDs (por PID, no con un patrón amplio), y nada de tocar la config de Claude Code ni sesiones ajenas.

## Al cerrar cada carril
- Actualiza el estado en `plan.md` y en el tracker (*si aplica*).
- Corre la tabla de cableado de la fase (`contrato-y-estimado.md`, «Cableado comprobable con grep») y anota cada fila en `plan.md`; una `falla` deja el carril abierto o en `BLOCKED`.
- Si reportas a sielay (`reporte-sielay.md`): `link_build_stage` con `plan_progress` (`done` + 1) y la `phase` que sigue en curso. Al entrar a la etapa 4, `total` es el número de carriles.
- Si el carril pasó su tope de tokens, ya paró en un punto seguro y reportó: decide si sigue, se parte o se reasigna.
- Compara las horas reales del carril contra su estimado. Si el total previsto se movió más que la tolerancia (±max(0,5 h, 10 % del programado)) o el carril se pasó, reestima con un motivo corto: en el contrato y, si reportas a sielay, con `estimate` completo y `reason` (`reporte-sielay.md`). No pide aprobación salvo que cambie el Goal, los criterios, los no-goals o la autoridad.
- Mide el contexto (`medir-contexto.mjs`, ver `presupuesto-de-contexto.md`): anota en `plan.md` el modelo y el contexto máximo del subagente o la terminal del carril, y corta con checkpoint si el coordinador llegó al umbral.
- Reporta al usuario en una línea.
- Anota la hora de inicio y fin de cada tramo (espera humana, evidencia y plan, implementación, revisión, CI, integración, merge, deploy) en `plan.md`, en UTC con `date -u +%FT%TZ` (es la ventana `--desde/--hasta` de `medir-contexto.mjs`): alimenta la tabla «dónde se fue el tiempo» del reporte final.
- Borra los worktrees y ramas locales de lo ya entregado; nunca una rama cuya entrega no confirmaste.
