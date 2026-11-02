# Nivel chico

Hasta 3 archivos y sin riesgo alto, o un build que la persona fuerza con `--chico`. Es el camino barato: una sola aprobación, un agente que escribe y una verificación corta. Un build completo chico costó 62,5 M de mediana contra 16,7 M de uno chico, así que no se le agrega proceso que el tamaño no pide.

Lee antes: `contrato-y-estimado.md`, `etapas.md` (solo la ruta de cada etapa y las reglas de aprobación), `presupuesto-de-contexto.md` (el corte, la lectura dirigida y los modelos; aquí no hay carriles ni terminales), `ejecucion-autonoma.md` (antes de la etapa 4) y `reporte-sielay.md`. Al entregar: `compuerta-de-pruebas.md`, `disciplina-de-pruebas.md` y `cierre-y-retro.md`; con `--alcance produccion`, `receta-de-deploy.md`.

## Lo que hace chico
- **Aprobaciones: una.** El Frame y el plan van juntos en la tarjeta única, y el sí cubre el merge. Con `--pausas` el plan se separa del Frame (dos aprobaciones).
- **Investigación: no.** Sin etapa de Evidencia; el código que el objetivo toca se lee en el Frame, con lectura dirigida.
- **Red team: no.** La revisión con contexto limpio y la pasada normal de CI son la red de seguridad.
- **Plan:** rápido, en una o dos fases (`/ak:plan --fast`; en modo nativo, un `planner`), sin paralelo, sin `contracts.md` y sin carriles.
- **Agentes que escriben: uno** (`/ak:cook --auto` o un `fullstack-developer`), que escribe también sus pruebas. `--terminales` no vale en chico: se ignora y se dice en el Frame.
- **Retros previas: se saltan.** No se leen retros de builds anteriores.
- **Verificación corta:** compila, arranca y una captura del resultado; sin UI, la salida del comando. La compuerta del repo corre igual que en los otros niveles. No hay e2e aparte.
- **Revisión: una**, con contexto limpio (`code-reviewer`, `effort: medium`; `high` si toca auth, seguridad, migraciones o datos de producción). Si hay arreglos, la siguiente revisión mira solo el delta (regla en `ejecucion-autonoma.md`).

## Ficha mínima
La ficha se descubre, no se pregunta, pero aquí solo con lo que este nivel usa. Lee `CLAUDE.md` (raíz y carpetas que el cambio toca; su línea `Push:`), los scripts del gestor de paquetes o el `Makefile`, los hooks de git, `git remote -v` y la rama, y el código que el cambio toca. De la tabla de `ficha-del-proyecto.md` llena solo estos campos: repo y rutas, remoto, guardarraíles, modo de entrega, compuerta de pruebas (si no existe, o es un stub, se menciona y no se crea ni se propone), alcance, dónde corren las pruebas, CI y deploy continuo (si el push o el merge publica solo, `merge` equivale a producción y rige la regla de `ficha-del-proyecto.md`: sin `--alcance produccion` te detienes antes de entregar), AgentKit, corte de contexto y, con `produccion`, deploy y dueño del deploy. Si el repo trae proceso propio, se dice en el Frame y rigen las reglas de «Repo con proceso propio» del núcleo. La ficha de navegador solo si hay UI. Sin Context7, tracker ni excepciones salvo que el cambio las use. Un paso de lectura bloqueado se marca "sin verificar".

## Tarjeta única
Una sola tarjeta sobre la captura de antes y después del cambio (qué hay hoy y qué quedará). Nombra:
- el **nivel** y su motivo, y cómo cambiarlo (regla en `SKILL.md`); con `--chico` y riesgo alto, el aviso de que se fuerza chico pese al riesgo;
- el alcance, el destino y si habrá deploy;
- el Goal, los criterios con la clave propuesta de cada uno y lo que quede en peldaño 5 (`contrato-y-estimado.md`);
- el estimado calibrado con `builds_calibration`, y la disponibilidad de la persona.

El sí cubre el merge. Cubre además el deploy solo si el alcance es `--alcance produccion` y el repo declara un comando de deploy ligero en sus referencias (`receta-de-deploy.md`); si no declara uno, el deploy sigue con la receta de siempre y su propia aprobación. Una autoridad que la tarjeta no nombra no queda concedida. Se reporta con un solo `gate`.

## Si el cambio crece
Si en la ejecución el cambio pasa de 3 archivos o aparece un riesgo alto, para, dilo en una línea, carga la referencia del nivel que sube (`nivel-medio.md`) y pide el sí que la tarjeta no cubría. Nada fuera de lo aprobado se hace sin ese sí.

## Reporte a sielay
`flow: "chico"` y `nivel:chico` en `flags`. Las etapas que no corren no se reportan. Si el nivel sube, se reporta el `flow` nuevo y `flags` completos (el hub reemplaza la lista entera), conservando los demás, como `parent:<id>`.
