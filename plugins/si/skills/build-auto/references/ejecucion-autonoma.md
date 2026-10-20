# Ejecución autónoma (etapas 4–7)

## Antes de lanzar agentes en paralelo
1. Confirma que la compuerta de pruebas del repo existe y funciona (`compuerta-de-pruebas.md`). Si no existe, el plan la incluye como fase.
2. Corre `/ak:test audit` (o un `tester`) acotado a las pruebas que tocará el plan. Arregla las inestables conocidas o acótalas con timeout: una prueba colgada con el lock de la suite frena a todas las fases.
3. Red team del contrato y su enmienda (etapa 3).
4. Implementa, revisa y entrega primero lo que los demás necesitan. Las demás fases arrancan desde la rama principal ya corregida, para no rebasar todas las ramas por cada corrección.
5. Por agente:
   - su worktree (`/ak:worktree`, o `git worktree add ../{repo}-wt-{fase} -b {rama}` desde la rama principal actualizada, y luego instalar dependencias);
   - su prefijo de borradores (`p<N>-`) y nombres de log únicos;
   - solo sus archivos, según la tabla de propiedad de `contracts.md`.

En `main directo` no hay ramas que mergear, pero el aislamiento por worktree y el orden de entrega se mantienen: el coordinador integra fase por fase y empuja por la compuerta.

## Quién ejecuta
- **Subagentes por tipo:** `fullstack-developer` (código), `docs-manager` (docs), `code-reviewer` (revisión y red team), `researcher` / `Explore` (evidencia), `tester` (verificación). Si no existen con esos nombres, usa los de propósito general con el mismo encargo. Los subagentes de una sesión comparten scratchpad: nombres de archivo únicos.
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
  - que termine con `Status: DONE | DONE_WITH_CONCERNS | BLOCKED`.

  Un tester tiene que entregar un artefacto (log, captura, salida de comandos); "revisé el código" no cuenta como verificación.

## Durante
- **Un solo coordinador entrega** (mergea o empuja a main), en orden y siempre por la compuerta. Nadie más entrega.
- **Revisión adversarial antes de cada entrega** (`/ak:code-review` o un `code-reviewer`). Los detalles técnicos los decides tú y reportas qué decidiste; las decisiones de producto se preguntan.
- **Los revisores reportan solo lo que afecta la corrección, la seguridad o los requisitos.** El resto va como opcional: no bloquea la entrega ni se convierte en pruebas nuevas por defecto. Perseguir cada hallazgo lleva a pruebas para casos que no pueden ocurrir. Pon esta regla en el encargo de cada revisor.
- **Tope de revisión por PR o push:**
  - una revisión a fondo;
  - corrige **en lote** todo lo Critical y High;
  - confirma con una revisión ligera;
  - máximo **dos vueltas**.

  Lo que queda (pulido, Medium y Low) va al reporte o a un issue, no a otra vuelta. Revisar sin tope cuesta horas y la mayoría de las vueltas extra solo pulen. **Si tras la segunda vuelta sigue abierto algún Critical o High, no entregues**: para y reporta al usuario el hallazgo con las opciones.
- **Prueba real lo antes posible.** En cuanto haya un camino de punta a punta, pruébalo con el sistema real en un entorno desechable:
  - build de producción, puerto propio, base de datos y datos temporales;
  - datos sembrados por las rutas reales, no insertados a mano;
  - un script reejecutable;
  - evidencia en `plans/{plan}/reports/e2e-*.md`.

  Antes de entregar, abre al menos una captura si hay UI; si no, revisa la salida del script e2e. Muchas pruebas unitarias en verde no sustituyen esto.
- Después de rebasar, reinstala las dependencias antes de empujar. Antes de lanzar un merge, confirma que el push del rebase llegó al remoto.
- Si la suite de otra sesión tiene el lock, espera tu turno; no la mates.
- Nunca `--no-verify`; nunca `git push | head`; nunca envolver el push o el merge en otro lock si la compuerta ya toma el suyo.
- Procesos: cada agente detiene solo sus PIDs (por PID, no con un patrón amplio), y nada de tocar la config de Claude Code ni sesiones ajenas.

## Al cerrar cada fase
- Actualiza el estado en `plan.md` y en el tracker (*si aplica*).
- Reporta al usuario en una línea.
- Borra los worktrees y ramas locales de lo ya entregado; nunca una rama cuya entrega no confirmaste.
