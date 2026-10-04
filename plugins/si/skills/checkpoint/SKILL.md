---
name: checkpoint
description: "Ritual de cierre de sesión + handoff genérico para cualquier proyecto. Úsalo al terminar de trabajar: resuelve el contexto del proyecto (config del repo) → journal → docs update → commit → push (si hay remoto propio) → handoff copy-paste para seguir en otra terminal con contexto limpio. Actívalo cuando el usuario diga '/checkpoint', 'checkpoint', 'cierra la sesión', 'termina y dame handoff', 'cerremos', 'wrap up', 'dame el handoff', o al final de una tanda de trabajo."
user-invocable: true
when_to_use: "Invoke al cerrar una sesión de trabajo: deja el trabajo commiteado (en el repo/entorno correcto), la bitácora y docs al día, y un prompt de handoff para retomar en frío. Resuelve acceso/repo/rutas por proyecto en vez de asumir constantes fijas — una sola skill sirve para todos tus proyectos. Para proyectos SIN buzón de coordinación (trabajo en solitario)."
argument-hint: "[<slug-del-proyecto>] [nota opcional de cierre]"
keywords: [cierre, handoff, journal, docs, commit, push, wrap-up, sesion]
metadata:
  category: workflow
  example: "/checkpoint mi-proyecto cerramos por hoy, quedó el PR de auth abierto"
  deps: "git configurado en el repo destino. Opcional: un descriptor de proyecto (p.ej. docs/projects/<slug>/project.json o CLAUDE.md) para auto-resolver acceso/repo/rutas; si no existe, se usan los placeholders de 'Constantes del proyecto'."
  installs: []
  risk: none
  version: "2.0.0"
---

# Checkpoint — cierre de sesión + handoff

Ritual que se corre **al terminar de trabajar**. Deja todo sincronizado (git + bitácora + docs) y produce un handoff para retomar en una terminal limpia. Ejecuta los pasos **en orden**; no te saltes ninguno.

> **Principio:** tú ya tienes el contexto de la sesión — escribe directo, no gastes tokens re-scouteando. Sé conciso y honesto (si algo quedó a medias o falló, dilo, no lo inventes).

## Paso 0 — Resolver el contexto del proyecto (NO hardcodear)

Antes de tocar nada, resuelve **de dónde sale el contexto**, en este orden de preferencia:

1. **Descriptor de proyecto** — si el entorno tiene un archivo de config por proyecto (p.ej. `docs/projects/<slug>/project.json`, o similar), léelo y saca de ahí: dónde vive el código + cómo accederlo (local / SSH / contenedor), identidad git, remoto, rutas de docs/plan.
2. **Convenciones del repo** — si no hay descriptor, lee `CLAUDE.md`/`README.md` del repo y `git remote -v` + `git config user.*`.
3. **Placeholders (fallback)** — si nada de lo anterior aplica, usa el bloque "Constantes del proyecto" de abajo, editado a mano.
4. **Preguntar** — si tras esto sigue ambiguo (slug, remoto o entorno), pregúntalo al usuario en una línea.

Del argumento saca el `<slug>` si lo dieron; si no, infiérelo del trabajo de la sesión. **Reporta en 2-3 líneas el contexto resuelto** (repo, cómo se accede, identidad git, estado del remoto) antes de seguir.

⚠️ **Remoto ajeno:** si `origin` es un **upstream que no es tuyo** (fork no creado), NO se puede pushear ahí. Márcalo y sáltate el push (ver Paso 4). No dejes que parezca respaldado si no lo está.

## Constantes del proyecto (fallback — EDITAR solo si no hay descriptor)

Se usan únicamente cuando el Paso 0 no resolvió el contexto automáticamente:

- **Repo principal (app):** `<RUTA_REPO_APP>` — aquí van journals y docs.
- **Repo(s) secundario(s):** `<RUTA_WORKTREE_SECUNDARIO>` (branch `<RAMA_FEATURE>`, entorno propio). NUNCA el checkout principal compartido ni master directo.
- **DB dev:** `<DB_DEV>` (nunca la DB de producción). Server dev en `:<PUERTO_DEV>`. Datos de prueba: cuentas demo, nunca datos reales.
- **Plan de ejecución activo:** `<RUTA_PLAN_ACTIVO>`
- **Identidad git:** `<NOMBRE> <email>`. **Sin referencias a AI** en mensajes de commit.
- **Regla de push:** todo va en **rama de feature → PR**. Nunca push directo a `main`/`master`.

---

## Paso 1 — /journal
Escribe una bitácora concisa en `docs/journals/YYMMDD-<slug>.md` (usa la ruta de docs resuelta en el Paso 0). Secciones:
- **Qué se hizo** (bullets, con PRs/branches).
- **Decisiones clave** (con el porqué; drifts vs plan si los hubo).
- **Validación** (tests/paridad/lo que se comprobó).
- **Lección** (solo si hubo una operativa que valga recordar).
- **Sigue** (el siguiente paso concreto).

Si ya escribiste el journal de esta tanda, dilo y sáltalo.

## Paso 2 — /docs update
Refresca SOLO lo que cambió en la carpeta de docs del proyecto:
- `codebase-summary.md` — estado actual (stack, estructura, endpoints que consume, PRs, cómo correr).
- Otros docs (`system-architecture.md`, `project-roadmap.md`, etc.) solo si el cambio los afecta. No inventes docs nuevos porque sí.

## Paso 3 — commit (en el repo del proyecto, vía el acceso del Paso 0)
1. `git status` primero (dentro del repo/entorno correcto según el Paso 0).
2. `git add <archivos de ESTA tarea>` — **nunca** `-A` ni `.` (barre WIP ajeno).
3. Conventional commit (`feat:`/`fix:`/`docs:`/`chore:`…), **sin refs a AI** por defecto, con la identidad git del proyecto. **Precedencia: el `CLAUDE.md` del repo gana** — si exige lo contrario (p.ej. `Co-Authored-By: Claude…` / trailer de sesión), seguí el repo, no esta regla.
4. Commits chicos y enfocados; separa por scope si aplica. Si el repo ya estaba limpio, dilo y sáltalo.

## Paso 4 — push (condicional)
- **Solo si hay un remoto PROPIO** (no el upstream ajeno del Paso 0). Push a la **rama de feature** (`feat/...`), nunca a `main`/`master` directo cuando el flujo del proyecto trabaja así.
- Actualiza el PR correspondiente de cada repo tocado. Si la rama nueva pide upstream: `git push -u origin <rama>`.
- **Si `origin` es upstream / no hay remoto propio:** NO pushees. Reporta explícito: "commits solo locales, sin remoto propio — crear fork/remote para backup".
- Si el trabajo vive en carpetas sin repo (planes/journals en un host no versionado), es esperado que no se pushee — dilo.

## Paso 5 — handoff
Escribe/actualiza `HANDOFF.md` en el plan activo Y presenta el mismo texto como **prompt copy-paste** para pegar en una terminal nueva. Estructura obligatoria:
1. **LEE PRIMERO** — plan.md + fase actual + contexto (docs de setup, specs).
2. **ESTADO (no rehacer)** — qué está hecho + PRs/branches.
3. **ENTORNO (crítico)** — cómo acceder al código (local/SSH/contenedor), paths de worktree, DB dev, venv/entorno, puerto dev, credenciales demo (y cómo regenerarlas), identidad git, estado del remoto, regla rama→PR, prohibiciones (nunca prod / datos reales), gotchas del host.
4. **PRUEBA RÁPIDA** — comando que verifica el entorno en ~1 min (curl login→endpoint, tests, o health).
5. **SIGUE** — el siguiente paso concreto.
6. Cierra pidiendo a la sesión nueva que confirme su plan de arranque antes de codear.

---

## Al terminar
Reporta al usuario, en breve: contexto resuelto, qué se commiteó (y en qué repo/entorno), estado del push (o por qué no aplicó), links a PRs, ruta del handoff, y pega el prompt de handoff listo para copiar. Sé explícito si algo quedó sin respaldar.

## Notas
- Si un paso no aplica (p. ej. no hubo cambios de código que commitear), dilo y sáltalo, no lo inventes.
- **Fuente de verdad del acceso:** el descriptor del proyecto (si existe) + el `CLAUDE.md` del repo. Ante conflicto, confirma con el usuario.
- **Variante con coordinación:** si el proyecto usa un buzón COMMS append-only entre varias personas/sesiones, usa el skill `checkpoint-cobru` — añade un paso de actualización del buzón.
- **Instalación:** copia esta carpeta a `~/.claude/skills/checkpoint/`. Se descubre al iniciar una sesión nueva. No necesita editar constantes si tus proyectos tienen descriptor; si no, rellena el bloque "Constantes del proyecto".
