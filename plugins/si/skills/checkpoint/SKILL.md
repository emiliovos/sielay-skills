---
name: checkpoint
description: "Ritual de cierre de sesión + handoff genérico para cualquier proyecto. Úsalo al terminar de trabajar: resuelve el contexto y el contrato de cierre del proyecto (CLAUDE.md o descriptor) → bitácora/estado → docs → commit → push según el flujo del repo → handoff copy-paste para seguir en otra terminal con contexto limpio. Si el CLAUDE.md del repo declara su cierre en la sección '## Cierre de sesión', lo sigue sin crear archivos nuevos; si no, usa los valores por defecto. Actívalo cuando el usuario diga '/checkpoint', 'checkpoint', 'cierra la sesión', 'termina y dame handoff', 'cerremos', 'wrap up', 'dame el handoff', o al final de una tanda de trabajo. Modo 'continuar' (/checkpoint continuar, 'checkpoint para seguir', 'voy a limpiar contexto'): sin bitácora ni docs ni push, solo commit local + handoff en pantalla para seguir la misma tarea tras /clear."
user-invocable: true
when_to_use: "Invoke al cerrar una sesión de trabajo: deja el trabajo commiteado (en el repo/entorno correcto), la bitácora o el archivo de estado y los docs al día, y un prompt de handoff para retomar en frío. Resuelve acceso, rutas, flujo de push y destino del handoff por proyecto en vez de asumir constantes fijas — una sola skill sirve para proyectos con y sin convenciones propias. Para proyectos SIN buzón de coordinación (trabajo en solitario)."
argument-hint: "[continuar|autonomo] [<slug-del-proyecto>] [nota opcional de cierre]"
keywords: [cierre, handoff, journal, estado, docs, commit, push, wrap-up, sesion, continuar, compact]
metadata:
  category: workflow
  example: "/checkpoint mi-proyecto cerramos por hoy, quedó el PR de auth abierto"
  deps: "git configurado en el repo destino. Opcional: una sección '## Cierre de sesión' en el CLAUDE.md del repo o un descriptor de proyecto (p.ej. docs/projects/<slug>/project.json) para fijar archivo de estado, flujo de push y destino del handoff; si no existen, se usan los valores por defecto."
  installs: []
  risk: none
  version: "2.5.0"
---

# Checkpoint — cierre de sesión + handoff

Ritual que se corre **al terminar de trabajar**. Deja todo sincronizado (git + bitácora o estado + docs) y produce un handoff para retomar en una terminal limpia. Ejecuta los pasos **en orden**.

> **Precedencia (todos los pasos):** si el `CLAUDE.md` del repo o el descriptor del proyecto define su propio cierre (archivo de estado, flujo de push, handoff, rutas de solo lectura), este ritual **lo sigue y no crea archivos ni carpetas que el repo no use**. Lo que dice esta skill son los valores por defecto para repos sin convención. Si un paso no aplica según el contrato del Paso 0, dilo y sáltalo; no lo inventes.

> **Principio:** tú ya tienes el contexto de la sesión — escribe directo, no gastes tokens re-scouteando. Sé conciso y honesto (si algo quedó a medias o falló, dilo, no lo inventes).

## Modos: `cierre`, `continuar` o `autonomo`

- **`cierre` (por defecto):** terminas la tanda. Corre los Pasos 0 a 5 completos.
- **`continuar`:** la tarea sigue en una terminal nueva o tras `/clear`, solo quieres soltar contexto. Se activa con el argumento `continuar` o frases como "checkpoint para seguir", "voy a limpiar contexto", "handoff para continuar". Corre:
  - **Paso 0** sin cambios (hace falta saber dónde está el repo y su flujo).
  - **Pasos 1 y 2: no se corren.** Sin bitácora, sin archivo de estado, sin docs.
  - **Paso 3:** commit local del trabajo de esta tarea, si hay algo. Nunca en `main`/`master` de un repo con `Push: rama+PR`: si estás ahí, no commitees y dilo en el handoff.
  - **Paso 4: no se pushea**, diga lo que diga el contrato. Reporta los commits como locales.
  - **Paso 5:** handoff siempre en pantalla (no escribe archivos), con la estructura completa.

- **`autonomo`:** para terminales de un build autónomo que reinician su contexto (`/clear`) y retoman desde un archivo. Se activa con el argumento `autonomo` o cuando un coordinador lo pide. Es `continuar` más estas reglas:
  - **Cero preguntas al usuario.** Si algo es ambiguo, decide el valor por defecto y anótalo en el handoff.
  - **El handoff va a un archivo, no a la pantalla:** `~/handoffs/<sesion>.md` (crea la carpeta si falta; `<sesion>` es el nombre de la sesión o del slug). Máximo 40 líneas, sin narrativa: objetivo, estado (hecho / en curso, con rama y PR), siguiente paso concreto, archivos tocados y comandos de verificación. Sin secretos (ver redacción de secretos).
  - **Responde con una sola línea:** la ruta del archivo. No imprimas el handoff.

### ¿`/compact`, `checkpoint continuar` o `checkpoint`?
- **`/compact`:** la misma tarea sigue y casi todo el contexto sigue sirviendo. No hace falta esta skill.
- **`checkpoint continuar`:** la tarea sigue, pero el contexto está lleno de intentos fallidos, salidas largas o subtareas ya cerradas, o vas a cambiar de subtarea. Mejor `/clear` + handoff que un resumen automático que arrastre ruido.
- **`checkpoint` (cierre):** se acaba la tanda o el día, o hay que dejar bitácora y PR para otra persona.

## Paso 0 — Resolver el contexto y el contrato de cierre (NO hardcodear)

### 0.1 Contexto del proyecto
Antes de tocar nada, resuelve **de dónde sale el contexto**, en este orden de preferencia:

1. **Descriptor de proyecto** — si el entorno tiene un archivo de config por proyecto (p.ej. `docs/projects/<slug>/project.json`, o similar), léelo y saca de ahí: dónde vive el código + cómo accederlo (local / SSH / contenedor), identidad git, remoto, rutas de docs/plan.
2. **Convenciones del repo** — si no hay descriptor, lee `CLAUDE.md`/`README.md` del repo y `git remote -v` + `git config user.*`.
3. **Placeholders (fallback)** — si nada de lo anterior aplica, usa el bloque "Constantes del proyecto" de abajo, editado a mano.
4. **Preguntar** — si tras esto sigue ambiguo (slug, remoto o entorno), pregúntalo al usuario en una línea.

Del argumento saca el `<slug>` si lo dieron; si no, infiérelo del trabajo de la sesión.

⚠️ **Remoto ajeno:** si `origin` es un **upstream que no es tuyo** (fork no creado), NO se puede pushear ahí. Márcalo y sáltate el push (ver Paso 4). No dejes que parezca respaldado si no lo está.

### 0.2 Contrato de cierre
Busca en el `CLAUDE.md` del repo (o en los campos `cierre.estado`, `cierre.push` y `cierre.handoff` del descriptor) la sección `## Cierre de sesión` con sus tres líneas (`Estado`, `Push`, `Handoff`). Si la sesión arrancó fuera de un repo (p.ej. en el home de un host que maneja varios proyectos), usa el `CLAUDE.md` del directorio donde arrancó.

El formato exacto, las excepciones por repo en `Push`, los valores por defecto y las reglas (reemplaza nunca suma, rutas de solo lectura, publicar no es pushear) están en `references/contrato-de-cierre.md`. **Léelo** si el repo no tiene la sección, si tiene excepciones o si dudas qué valor aplica. Lo mínimo: sin la sección exacta, valen los valores por defecto (`Estado: journals`, `Push: rama+PR`, `Handoff` según el estado) y **nunca se deducen valores de la prosa**; si el `CLAUDE.md` parece describir otro cierre, pregunta en una línea antes de escribir nada.

**Reporta en 3-4 líneas** el contexto resuelto (repo, cómo se accede, identidad git, estado del remoto) y el contrato de cierre (estado, push con sus excepciones por repo, handoff) antes de seguir. Si no hay sección, dilo así: "sin contrato, usando valores por defecto; si tu repo cierra distinto, agrega la sección `## Cierre de sesión` (ver el README de emiliovos/sielay-skills)".

## Constantes del proyecto (fallback — EDITAR solo si no hay descriptor ni CLAUDE.md)

Se usan únicamente cuando el Paso 0 no resolvió el contexto automáticamente:

- **Repo principal (app):** `<RUTA_REPO_APP>` — aquí van bitácora y docs.
- **Repo(s) secundario(s):** `<RUTA_WORKTREE_SECUNDARIO>` (branch `<RAMA_FEATURE>`, entorno propio). Nunca el checkout principal compartido.
- **DB dev:** `<DB_DEV>` (nunca la DB de producción). Server dev en `:<PUERTO_DEV>`. Datos de prueba: cuentas demo, nunca datos reales.
- **Plan de ejecución activo:** `<RUTA_PLAN_ACTIVO>`
- **Identidad git:** `<NOMBRE> <email>`. **Sin referencias a AI** en mensajes de commit.

---

## Paso 1 — Bitácora o estado
- **`Estado: <ruta>`:** actualiza ese archivo y ningún otro. Respeta su estructura; si no tiene una, usa las secciones de abajo.
- **`Estado: journals` (por defecto):** escribe una bitácora concisa en `docs/journals/YYMMDD-<slug>.md` (usa la ruta de docs resuelta en el Paso 0).

Secciones:
- **Qué se hizo** (bullets, con PRs/branches).
- **Decisiones clave** (con el porqué; drifts vs plan si los hubo).
- **Validación** (tests/paridad/lo que se comprobó).
- **Lección** (solo si hubo una operativa que valga recordar).
- **Sigue** (el siguiente paso concreto).

Si ya escribiste la bitácora o el estado de esta tanda, dilo y sáltalo.

## Paso 2 — Docs
- **`Estado: <ruta>`:** este paso **no aplica** (el estado ya quedó en el Paso 1). Dilo y sáltalo. Solo toca otro doc si el `CLAUDE.md` lo pide explícitamente para el cierre.
- **`Estado: journals` (por defecto):** refresca SOLO lo que cambió en la carpeta de docs del proyecto:
  - `codebase-summary.md` — estado actual (stack, estructura, endpoints que consume, PRs, cómo correr).
  - Otros docs (`system-architecture.md`, `project-roadmap.md`, etc.) solo si el cambio los afecta. No inventes docs nuevos porque sí.

## Paso 3 — commit (en el repo del proyecto, vía el acceso del Paso 0)
1. `git status` primero (dentro del repo/entorno correcto según el Paso 0).
2. `git add <archivos de ESTA tarea>` — **nunca** `-A` ni `.` (barre WIP ajeno).
3. Conventional commit (`feat:`/`fix:`/`docs:`/`chore:`…), **sin refs a AI** por defecto, con la identidad git del proyecto. Si el `CLAUDE.md` del repo exige otra cosa (p.ej. un trailer `Co-Authored-By`), sigue el repo.
4. Commits chicos y enfocados; separa por scope si aplica. Si el repo ya estaba limpio, dilo y sáltalo.

## Paso 4 — push (según el contrato)
- **Por repo:** para cada repo tocado, usa el modo de su excepción en la línea `Push` si lo nombra; si no, el primer valor. Repórtalo por repo ("proyecto: rama+PR, PR #12; pve2-docs: main directo").
- **Solo si hay un remoto PROPIO** (no el upstream ajeno del Paso 0).
- **`rama+PR`:** push a la rama de feature (`git push -u origin <rama>` si pide upstream), nunca a `main`/`master` directo. Abre o actualiza el PR de cada repo tocado.
- **`main directo`:** push a la rama principal, solo porque el repo lo declara así. Sin PR.
- **`no pushear`:** no pushees; reporta los commits como locales.
- **Si `origin` es upstream / no hay remoto propio:** NO pushees. Reporta explícito: "commits solo locales, sin remoto propio — crear fork/remote para backup".
- Si el trabajo vive en carpetas sin repo (planes o bitácoras en un host no versionado), es esperado que no se pushee — dilo.
- Nunca corras scripts de publicación ni deploys (ver el contrato).

## Paso 5 — handoff
Escribe el handoff donde diga el contrato (`<ruta>`, `estado` o `pantalla`; con `pantalla` no se escribe ningún archivo; en modo `continuar`, siempre `pantalla`; en modo `autonomo`, siempre el archivo `~/handoffs/<sesion>.md` de ≤40 líneas) Y preséntalo siempre como **prompt copy-paste** para pegar en una terminal nueva. Estructura obligatoria:
1. **LEE PRIMERO** — plan, archivo de estado o fase actual + contexto (docs de setup, specs).
2. **ESTADO (no rehacer)** — qué está hecho + PRs/branches. Sácalo de comandos, no de memoria: `git status --short`, `git worktree list` y `gh pr list --state open` (o el equivalente de la forja) en cada repo tocado. Cita PRs y ramas tal como salen ahí.
3. **DECISIONES VIGENTES** — decisiones que la sesión nueva no debe reabrir, con su porqué en media línea.
4. **INTENTOS FALLIDOS** — lo que se probó y no funcionó, y por qué, para no repetirlo.
5. **ENTORNO (crítico)** — cómo acceder al código (local/SSH/contenedor), paths de worktree, DB dev, venv/entorno, puerto dev, credenciales demo (y cómo regenerarlas), identidad git, estado del remoto, flujo de push, pasos de publicación pendientes del usuario, prohibiciones (nunca prod / datos reales), gotchas del host.
6. **PRUEBA RÁPIDA** — comando que verifica el entorno en ~1 min (curl login→endpoint, tests, o health).
7. **SIGUE** — el siguiente paso concreto.
8. Cierra pidiendo a la sesión nueva que confirme su plan de arranque antes de codear.

**Arrastre:** si la sesión empezó con un handoff, copia sus DECISIONES VIGENTES e INTENTOS FALLIDOS, quita los que ya no apliquen (dilo en una línea) y suma los nuevos. No se pierden entre handoffs encadenados.

**Redacción de secretos:** el handoff, la bitácora y los commits nunca llevan valores secretos: tokens, contraseñas, llaves, valores de `.env`, cookies ni URLs con credenciales. Nómbralos por variable o ubicación (`GITHUB_TOKEN` en `~/.env`, "token en la web → API Tokens"). Antes de presentar el handoff, revísalo buscando cadenas con forma de secreto (`ghp_`, `sk-`, `xox`, `AKIA`, `-----BEGIN`, JWT `eyJ`, `password=`, `token=`) y reemplázalas por `[redactado]`. Las credenciales demo del ENTORNO van como "cómo regenerarlas", no como valor.

---

## Al terminar
Reporta al usuario, en breve: modo (`cierre` o `continuar`), contexto y contrato resueltos, qué se commiteó (y en qué repo/entorno), estado del push (o por qué no aplicó), links a PRs, dónde quedó el handoff, y pega el prompt de handoff listo para copiar. Sé explícito si algo quedó sin respaldar.

## Notas
- **Fuente de verdad:** el descriptor del proyecto (si existe) + el `CLAUDE.md` del repo. Ante conflicto entre ellos, confirma con el usuario.
- **Coordinación:** esta skill no actualiza buzones compartidos entre varias personas o sesiones; si el proyecto usa uno, actualízalo aparte según sus reglas.
- **Instalación:** `claude plugin marketplace add emiliovos/sielay-skills && claude plugin install si@sielay` (se invoca como `/si:checkpoint`). Actualizar: `claude plugin update si@sielay`.
