# Nivel medio

De 4 a 15 archivos, o un chico con riesgo alto. Dos aprobaciones, la investigación que el cambio pida, el red team solo del contrato y uno o dos agentes que escriben. Es el flujo de hoy sin carriles de más, sin e2e aparte y sin releer lo ya revisado.

Lee antes: `ficha-del-proyecto.md` (ficha completa y retros previas), `contrato-y-estimado.md`, `etapas.md`, `presupuesto-de-contexto.md` y `reporte-sielay.md`. De `nivel-grande.md` lee solo la sección «Etapa 3 por dentro» (búscala con `grep -n`) y aplica los puntos que nombra la lista de abajo. Al entregar: `ejecucion-autonoma.md`, `compuerta-de-pruebas.md`, `disciplina-de-pruebas.md` y `cierre-y-retro.md`; con `--alcance produccion`, `receta-de-deploy.md`; con `--terminales`, `terminales.md`.

## Lo que hace medio
- **Aprobaciones: dos.** El Frame y, juntos, la Evidencia y el Plan (tres con `--pausas`). Cada aprobación cubre solo el gate que se muestra.
- **Investigación: según el cambio.** La etapa 2 corre corta y en paralelo, con tope de ~30 min y con el pase de `puntos-ciegos-y-context7.md`; para un cambio sobre código que ya se conoce basta un explorador.
- **Red team: solo del contrato.** Cuatro lentes (seguridad, modos de falla, supuestos y alcance) sobre `contracts.md` congelado, cada hallazgo con archivo:línea; las correcciones entran como enmienda antes de lanzar agentes. No hay red team aparte del plan.
- **Agentes que escriben: uno**, o dos si sus archivos no se cruzan (cada uno con su dueño, rama y worktree, sobre `contracts.md` congelado y con un solo PR por la rama de integración `build/<slug>`). Un archivo que tocarían los dos tiene un solo dueño. Más de dos no es medio: es grande.
- **Retros previas:** un solo resumen agregado de `builds_weekly`, hecho por un subagente (`ficha-del-proyecto.md`).
- **Verificación:** compila, arranca y captura (sin UI: la salida del comando), más las pruebas afectadas del carril o la CI remota de su push. Sin e2e aparte. La compuerta del repo corre igual.
- **Revisión:** una, con contexto limpio, con el esfuerzo de su riesgo (`medium`; `high` en auth, seguridad, migraciones o datos de producción); después, solo el delta (`git diff <sha revisado>..HEAD`; tras un rebase, `git range-diff`).

## Del plan (nivel-grande.md, «Etapa 3 por dentro»)
Aplican: `plan.md` con pre-mortem corto, `contracts.md` congelado y su tabla de propiedad de archivos, el riesgo por carril, un PR por build, el estimado por carril, la compuerta de pruebas del repo (si no existe, no se crea), el comando de entrega en la autoridad concedida y los momentos humanos. El spike (fase 0) solo si un supuesto de riesgo lo pide. No aplican: más de dos carriles, el red team completo del plan y el e2e.

## Si cambia el nivel
Si el cambio crece a más de 15 archivos o aparece un riesgo alto que no estaba, sube a grande: carga `nivel-grande.md`, dilo en una línea y pide el sí que la tarjeta no cubría. Si la persona lo baja en la tarjeta, se carga la del nivel que fijó y su decisión queda escrita ahí.

## Reporte a sielay
`flow: "full"` y `nivel:medio` en `flags`. La etapa 2 se reporta aunque corra corta.
