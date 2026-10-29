---
name: checkpoint
description: "Ritual de cierre de sesión + handoff genérico para cualquier proyecto. Úsalo al terminar de trabajar: resuelve el contexto y el contrato de cierre del proyecto (CLAUDE.md o descriptor) → bitácora/estado → docs → commit → push según el flujo del repo → handoff copy-paste para seguir en otra terminal con contexto limpio. Si el CLAUDE.md del repo declara su cierre en la sección '## Cierre de sesión', lo sigue sin crear archivos nuevos (salvo el archivo de reporte del Paso 6); si no, usa los valores por defecto. Actívalo cuando el usuario diga '/checkpoint', 'checkpoint', 'cierra la sesión', 'termina y dame handoff', 'cerremos', 'wrap up', 'dame el handoff', o al final de una tanda de trabajo. Modo 'continuar' (/checkpoint continuar, 'checkpoint para seguir', 'voy a limpiar contexto'): sin bitácora ni docs ni push, solo commit local + handoff corto (≤25 líneas) en pantalla para seguir la misma tarea tras /clear. Todos los modos incluyen el ENTORNO VIVO de la sesión (crons, procesos en segundo plano con PID, estado git), un ARRANQUE que lo verifica al retomar y el bloque de REPORTE (hecho, quedó, retro) agregado al archivo de reportes que declara el repo."
user-invocable: true
when_to_use: "Invoke al cerrar una sesión de trabajo: deja el trabajo commiteado (en el repo/entorno correcto), la bitácora o el archivo de estado y los docs al día, y un prompt de handoff para retomar en frío. Resuelve acceso, rutas, flujo de push y destino del handoff por proyecto en vez de asumir constantes fijas — una sola skill sirve para proyectos con y sin convenciones propias. Para proyectos SIN buzón de coordinación (trabajo en solitario)."
argument-hint: "[continuar|autonomo|coordinador] [<slug-del-proyecto>] [nota opcional de cierre]"
keywords: [cierre, handoff, journal, estado, docs, commit, push, wrap-up, sesion, continuar, compact]
metadata:
  category: workflow
  example: "/checkpoint mi-proyecto cerramos por hoy, quedó el PR de auth abierto"
  deps: "git configurado en el repo destino. Opcional: una sección '## Cierre de sesión' en el CLAUDE.md del repo o un descriptor de proyecto (p.ej. docs/projects/<slug>/project.json) para fijar archivo de estado, flujo de push y destino del handoff; si no existen, se usan los valores por defecto."
  installs: []
  risk: none
  version: "2.7.1"
---

# Checkpoint — cierre de sesión + handoff

Ritual que se corre **al terminar de trabajar**. Deja todo sincronizado (git + bitácora o estado + docs) y produce un handoff para retomar en una terminal limpia, con el **entorno vivo** de la sesión (crons, procesos en segundo plano, estado git) para que la sesión nueva no herede en silencio lo que dejó corriendo la anterior.

> **Precedencia (todos los pasos):** si el `CLAUDE.md` del repo o el descriptor del proyecto define su propio cierre (archivo de estado, flujo de push, handoff, rutas de solo lectura), este ritual **lo sigue y no crea archivos ni carpetas que el repo no use**. Lo que dice esta skill son los valores por defecto para repos sin convención. Si un paso no aplica según el contrato del Paso 0, dilo y sáltalo; no lo inventes.

> **Principio:** tú ya tienes el contexto de la sesión — escribe directo, no gastes tokens re-scouteando. Sé conciso y honesto (si algo quedó a medias o falló, dilo, no lo inventes).

> **Velocidad:** el estado del entorno sale de **una** llamada Bash más `CronList` (máximo 2 `tool_use` de estado, ver «Entorno vivo»). No relees archivos que ya tienes en contexto (`CLAUDE.md`, el contrato de cierre), no corras `git status`, `git worktree list` ni `gh pr list` por separado (el script ya los trae) y no ejecutes pasos que el modo no usa. En `continuar` y `autonomo` el estado son **2 `tool_use` como máximo** (la llamada del script y `CronList`): el Paso 0 no corre comandos sueltos y el Paso 3 usa los datos git del inventario.

## Modos y formato del handoff

| Modo | Se activa con | Pasos | Handoff | Largo |
|---|---|---|---|---|
| `cierre` (por defecto) | `/checkpoint`, «cierra la sesión», «cerremos» | 0 a 6; docs solo si cambió algo visible; push en segundo plano | según el contrato de cierre + ENTORNO VIVO + ARRANQUE | completo |
| `continuar` | `continuar`, «voy a limpiar contexto», «checkpoint para seguir» | 0 breve, 3 (commit local), entorno vivo, 5, 6 | pantalla: objetivo, estado, siguiente, ENTORNO VIVO, ARRANQUE | **≤ 25 líneas** |
| `autonomo` | `autonomo`, o lo pide un coordinador | igual que `continuar`, sin preguntas | archivo `~/handoffs/<sesion>.md` | **≤ 40 líneas** |
| `coordinador` | `coordinador`, o la sesión coordina a otras | `cierre` (0 a 6) + renglones `(coordinador)` del descriptor + las demás sesiones | según el contrato de cierre | completo |

- **`continuar`:** la tarea sigue en una terminal nueva o tras `/clear`. **Paso 0** breve (dónde está el repo; sin reporte de contexto). **Pasos 1, 2 y 4: no se corren** (sin bitácora, docs ni push, diga lo que diga el contrato). **Paso 3:** commit local del trabajo de esta tarea si hay algo; nunca en `main`/`master` de un repo con `Push: rama+PR` (si estás ahí, no commitees y dilo en el handoff). **Paso 5:** handoff en pantalla, sin escribir archivos, de máximo 25 líneas: objetivo, estado (hecho / en curso, con rama y PR), siguiente paso concreto, ENTORNO VIVO y ARRANQUE; suma una línea por decisión o intento fallido que la sesión nueva no deba reabrir. **Paso 6:** el bloque de reporte, igual que en los demás modos.
- **`autonomo`:** para terminales de un build autónomo que reinician su contexto y retoman desde un archivo. Es `continuar` más estas reglas:
  - **Cero preguntas al usuario.** Si algo es ambiguo, decide el valor por defecto y anótalo en el handoff.
  - El handoff va a `~/handoffs/<sesion>.md` (crea la carpeta si falta; `<sesion>` es el nombre de la sesión o del slug), máximo 40 líneas, sin narrativa: objetivo, estado, siguiente paso, archivos tocados, comandos de verificación, ENTORNO VIVO y ARRANQUE. Sin secretos.
  - Corre el **Paso 6** (reporte) después de escribir el handoff; si el script responde `link:`, manda el bloque antes de responder.
  - **Responde con dos líneas:** la ruta del handoff y el resultado del reporte (`agregado: <ruta>`, `link: <dirección>` o `no`). No imprimas el handoff.
- **`cierre`:** Pasos 0 a 6 completos. El **push va en segundo plano** (Paso 4) mientras redactas; el entorno vivo y el reporte se hacen **después** del aviso de fin del push.
- **`coordinador`:** es `cierre`, y además el ENTORNO VIVO suma los renglones `(coordinador)` del descriptor (`--coordinador` en el script) y las demás sesiones de la máquina que lista el script (`otras sesiones`), más lo que sepas de la sesión: quién espera a quién y qué se dio por turno.

### ¿`/compact`, `checkpoint continuar` o `checkpoint`?
- **`/compact`:** la misma tarea sigue y casi todo el contexto sigue sirviendo. No hace falta esta skill.
- **`checkpoint continuar`:** la tarea sigue, pero el contexto está lleno de intentos fallidos, salidas largas o subtareas ya cerradas, o vas a cambiar de subtarea. Mejor `/clear` + handoff que un resumen automático que arrastre ruido.
- **`checkpoint` (cierre):** se acaba la tanda o el día, o hay que dejar bitácora y PR para otra persona.

## Paso 0 — Resolver el contexto y el contrato de cierre (NO hardcodear)

### 0.1 Contexto del proyecto
Antes de tocar nada, resuelve **de dónde sale el contexto**, en este orden de preferencia:

1. **Descriptor de proyecto** — si el entorno tiene un archivo de config por proyecto (p.ej. `docs/projects/<slug>/project.json`, o similar), léelo y saca de ahí: dónde vive el código + cómo accederlo (local / SSH / contenedor), identidad git, remoto, rutas de docs/plan.
2. **Convenciones del repo** — si no hay descriptor, lee `CLAUDE.md`/`README.md` del repo y `git remote -v` + `git config user.*` (en `continuar` y `autonomo` salta estos dos comandos: no hay push y el inventario trae la rama).
3. **Placeholders (fallback)** — si nada de lo anterior aplica, usa el bloque "Constantes del proyecto" de abajo, editado a mano.
4. **Preguntar** — si tras esto sigue ambiguo (slug, remoto o entorno), pregúntalo al usuario en una línea.

Del argumento saca el `<slug>` si lo dieron; si no, infiérelo del trabajo de la sesión.

⚠️ **Remoto ajeno:** si `origin` es un **upstream que no es tuyo** (fork no creado), NO se puede pushear ahí. Márcalo y sáltate el push (ver Paso 4). No dejes que parezca respaldado si no lo está.

### 0.2 Contrato de cierre
Busca en el `CLAUDE.md` del repo (o en los campos `cierre.estado`, `cierre.push` y `cierre.handoff` del descriptor) la sección `## Cierre de sesión` con sus líneas (`Estado`, `Push`, `Handoff` y, opcional, `Reporte`). Si la sesión arrancó fuera de un repo (p.ej. en el home de un host que maneja varios proyectos), usa el `CLAUDE.md` del directorio donde arrancó.

El formato exacto, las excepciones por repo en `Push`, los valores por defecto y las reglas (reemplaza nunca suma, rutas de solo lectura, publicar no es pushear) están en `references/contrato-de-cierre.md`. **Léelo** si el repo no tiene la sección, si tiene excepciones o si dudas qué valor aplica. Lo mínimo: sin la sección exacta, valen los valores por defecto (`Estado: journals`, `Push: rama+PR`, `Handoff` según el estado, `Reporte` en `~/handoffs/reportes/{AAMMDD}-{terminal}.md`) y **nunca se deducen valores de la prosa**; si el `CLAUDE.md` parece describir otro cierre, pregunta en una línea antes de escribir nada.

**En `cierre` y `coordinador`, reporta en 3-4 líneas** el contexto resuelto (repo, cómo se accede, identidad git, estado del remoto) y el contrato de cierre (estado, push con sus excepciones por repo, handoff, reporte) antes de seguir (en `continuar` y `autonomo` no reportes el contexto). Si no hay sección, dilo así: "sin contrato, usando valores por defecto; si tu repo cierra distinto, agrega la sección `## Cierre de sesión` (ver el README de emiliovos/sielay-skills)".

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
- **`Estado: journals` (por defecto):** corre **solo si cambió algo visible**: comportamiento, setup, comandos, config, arquitectura, seguridad, contratos o una decisión duradera. Si no cambió nada de eso, escribe «docs: sin cambios visibles» y sáltalo, sin releer ningún doc. Si corre, lee cada doc antes de editarlo y refresca SOLO lo que cambió (`codebase-summary.md` y, si el cambio los afecta, `system-architecture.md`, `project-roadmap.md`). No inventes docs nuevos.

## Paso 3 — commit (en el repo del proyecto, vía el acceso del Paso 0)
1. Estado primero. En `continuar` y `autonomo` sale del `sucio` y la rama del inventario, sin correr `git status`. En `cierre` y `coordinador` corre `git status` (dentro del repo/entorno correcto según el Paso 0), porque el inventario se toma después del push.
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
- **Segundo plano:** en `cierre` y `coordinador`, lanza el push con la herramienta Bash en segundo plano (`run_in_background`) y mientras corre redacta el handoff (Paso 5, todo menos el ENTORNO VIVO). **No reportes ni tomes el inventario antes del aviso de fin del push**; si falla, ponlo en el reporte y en el handoff.
- Nunca corras scripts de publicación ni deploys (ver el contrato).

## Entorno vivo (una llamada Bash + CronList)

Lo que la sesión deja corriendo es parte del estado: un monitor armado antes de un `/clear` sigue vivo y avisa a nadie. El inventario sale de `scripts/entorno-vivo.mjs` (Node ≥ 18, solo lee) y de `CronList`, que solo tú puedes ver.

**Cuándo:** en `continuar`/`autonomo`, justo después del Paso 0 y **antes** del commit del Paso 3 (ajusta a mano los conteos «sin commit/sin push» según lo que commiteaste, sin repetir la llamada). En `cierre`/`coordinador`, **después** de que termine el push en segundo plano (Paso 4), para que el push no aparezca como proceso vivo.

**Cómo, en el mismo turno, 2 `tool_use`:**
1. Una llamada Bash:
   `timeout 150 node "${CLAUDE_SKILL_DIR}/scripts/entorno-vivo.mjs" --repo /ruta/al/repo [--repo /ruta/a/otro-repo-tocado] [--descriptor /ruta/al/repo/CLAUDE.md [--coordinador]]`
   Si `${CLAUDE_SKILL_DIR}` no se expande, la carpeta es la «Base directory» que muestra la skill al cargarse. Pasa un `--repo` por cada repo que tocó la sesión (por defecto, el directorio actual). El `timeout` externo (150 s) es mayor que los presupuestos internos: comandos del descriptor 60 s en total (30 s cada uno, en paralelo), `gh` 10 s por repo y margen; si un comando no termina, el script imprime lo que ya tiene.
2. `CronList` (si el runtime no la tiene, escribe `crons: no disponible`).

**Descriptor `## Entorno vivo` del `CLAUDE.md` del repo:** fuentes de estado propias del proyecto, una por renglón.

```
## Entorno vivo
- estado: `node scripts/ruta/estado.mjs`
- conversaciones: contexto — conversaciones abiertas que esperan respuesta
- equipo: `node scripts/ruta/estado.mjs --todos` (coordinador)
```

- `` `comando` ``: el script lo corre por ti (con `--descriptor`) desde la raíz del repo, sin shell, en paralelo, con 30 s por comando y 60 s en total, **solo si** empieza con `node scripts/`, `bash scripts/` o `./scripts/` y no lleva `|`, `;`, `&`, `$(`, `` ` ``, `>`, `<`, comillas ni `..`. Cualquier otro se muestra como «no se corre» y no se ejecuta. El `CLAUDE.md` debe estar dentro del repo (por `realpath`); si no, el descriptor se rechaza. Nunca debe escribir ni imprimir secretos.
- `contexto — <qué>`: no se corre nada; lista de memoria de la sesión lo que pide (conversaciones abiertas, turnos dados o recibidos). Si no hay nada, «ninguno».
- `(coordinador)`: el renglón solo se usa en el modo `coordinador`.
- **Sin la sección**, solo va lo genérico del script. **Si el `CLAUDE.md` es de un remoto ajeno** (upstream que no es tuyo), no pases `--descriptor`: cítalo y no ejecutes nada de él.

**Bloque que va al handoff** (las líneas salen del script; tú agregas `crons` y completas los `contexto`):

```
## ENTORNO VIVO (2026-10-27T01:40:12Z)
- crons: <CronList: id, cada cuánto, qué> | ninguno
- pid 751433 · inicio 2026-10-27T01:23:10Z · tarea · until [ -f /ruta/listo ]; do sleep 5; done (vigía: sí)
- git: /ruta/al/repo feat/x · 2 sin commit · 1 sin push · PR #12
- <fuente del descriptor>: <resumen de su salida>
```

- Un renglón `- pid <n> · inicio <ISO> · …` por proceso; el formato exacto importa porque `--verificar` lo lee.
- **`(vigía: sí)`** solo para los monitores y bucles de espera que **la sesión principal armó** y que nombras en tu contexto (un Monitor o un `run_in_background` propio, con un fin conocido). Todo lo demás es **`(vigía: no)`**: un push, un merge, un servidor, un build y cualquier proceso que la sesión no reconozca como suyo. Tipos: `tarea` (llamada Bash en segundo plano), `proceso` (otro hijo de la sesión) y `otro` (no es líder de su grupo o su comando no es legible: se lista y nunca se detiene).
- **Límite:** el script no distingue el Bash de un subagente del de la sesión principal (ambos son hijos del mismo `claude`). Por eso el checkpoint, en cualquier modo, se toma **sin subagentes corriendo** (punto seguro): si hay uno, espera a que termine o anótalo en el handoff y marca `(vigía: no)`.
- Sin hijos: `- procesos: ninguno`. En una plataforma sin inventario el script lo dice y sale con 0.
- Sin secretos: el script ya redacta comandos y salidas; revisa igual la «Redacción de secretos» del Paso 5.

**ARRANQUE** (sigue al bloque, y es lo primero que hace la sesión nueva):

```
## ARRANQUE
1. PRUEBA RÁPIDA: `<comando que verifica el entorno en ~1 min>`
2. `node <ruta absoluta del script> --verificar <este handoff>`
3. CronList: los crons siguen y no hay duplicados (borra el repetido)
4. Pendientes del handoff contra el estado real (PR, builds, conversaciones)
```

Escribe en el paso 2 la ruta **absoluta** del script (la que expandió `${CLAUDE_SKILL_DIR}`) y la ruta del archivo del handoff; en `continuar` (sin archivo) escribe `--verificar -` y la instrucción de pasarle por stdin, con un heredoc `<<'EOF'` (delimitador entre comillas, para que el shell no expanda nada), solo el bloque ENTORNO VIVO de este mensaje. Cuando la sesión nueva retoma:
- Si el script ya no existe (por un `claude plugin update`), usa el más nuevo de `~/.claude/plugins/cache/*/si/*/skills/checkpoint/scripts/entorno-vivo.mjs`.
- `--verificar` solo clasifica (sale con 2 si hay hallazgos): `muertos` (estaban en el handoff y ya no viven; un pid vivo con otro `inicio` cuenta como muerto), `huerfanos` (hijos de este claude que arrancaron antes de la hora del handoff) y `duplicados` (el mismo comando en más de un pid) y `vivos_ajenos` (siguen vivos con el mismo inicio, pero no cuelgan de este `claude`: solo se reportan, nunca se detienen). Un pid del handoff que sigue vivo con el mismo inicio bajo este `claude` es huérfano aunque haya arrancado en el mismo minuto del handoff.
- **Huérfano con `vigía: sí`:** deténlo con `node <script> --detener <pid> --inicio <ISO del huérfano>` (nunca compongas un `kill` a mano: el script recomprueba que sea hijo directo de este claude, que el inicio coincida y que sea líder de su grupo) y vuelve a armar el vigía si corresponde.
- **Huérfano sin `vigía: sí`** (push, merge, servidor, desconocido, `otro`): no lo detengas por tu cuenta. En `continuar` y `cierre`, pregunta qué hacer; en `autonomo`, déjalo vivo y anótalo en tu primer estado.
- `muertos` con `vigía: sí`: vuelve a armarlos. `duplicados`: avisa y, en CronList, borra el cron repetido.

## Paso 5 — handoff
Escribe el handoff donde diga el contrato (`<ruta>`, `estado` o `pantalla`; con `pantalla` no se escribe ningún archivo; en `continuar`, siempre `pantalla`; en `autonomo`, siempre `~/handoffs/<sesion>.md`) Y preséntalo siempre como **prompt copy-paste** para pegar en una terminal nueva. Si escribes el archivo con un heredoc de shell, usa siempre `<<'EOF'` con el delimitador entre comillas (el contenido puede traer `$`, comillas o backticks). Mejor aún: usa la herramienta de escritura de archivos.

En `cierre` y `coordinador` la estructura es:
1. **LEE PRIMERO** — plan, archivo de estado o fase actual + contexto (docs de setup, specs).
2. **ESTADO (no rehacer)** — qué está hecho + PRs/branches, tal como salen del inventario del script (no corras otros comandos git).
3. **DECISIONES VIGENTES** — decisiones que la sesión nueva no debe reabrir, con su porqué en media línea.
4. **INTENTOS FALLIDOS** — lo que se probó y no funcionó, y por qué, para no repetirlo.
5. **ENTORNO (crítico)** — cómo acceder al código (local/SSH/contenedor), paths de worktree, DB dev, venv/entorno, puerto dev, credenciales demo (y cómo regenerarlas), identidad git, estado del remoto, flujo de push, pasos de publicación pendientes del usuario, prohibiciones (nunca prod / datos reales), gotchas del host.
6. **ENTORNO VIVO** y **ARRANQUE** — los bloques de «Entorno vivo». La PRUEBA RÁPIDA es el paso 1 del ARRANQUE.
7. **SIGUE** — el siguiente paso concreto.
8. Cierra pidiendo a la sesión nueva que confirme su plan de arranque antes de codear.

En `continuar` y `autonomo` usa el formato corto de la tabla de modos (25 y 40 líneas) en lugar de esta estructura.

**Arrastre:** si la sesión empezó con un handoff, copia sus DECISIONES VIGENTES e INTENTOS FALLIDOS, quita los que ya no apliquen (dilo en una línea) y suma los nuevos. No se pierden entre handoffs encadenados.

**Redacción de secretos:** el handoff, la bitácora y los commits nunca llevan valores secretos: tokens, contraseñas, llaves, valores de `.env`, cookies ni URLs con credenciales. Nómbralos por variable o ubicación (`GITHUB_TOKEN` en `~/.env`, "token en la web → API Tokens"). Antes de presentar el handoff, revísalo buscando cadenas con forma de secreto (`ghp_`, `sk-`, `xox`, `AKIA`, `-----BEGIN`, JWT `eyJ`, `password=`, `token=`) y reemplázalas por `[redactado]`. Las credenciales demo del ENTORNO van como "cómo regenerarlas", no como valor.

## Paso 6 — reporte (todos los modos)
El reporte del día junta lo que hizo cada terminal; sin este paso, lo que no se anotó se pierde con el `/clear`. Corre en **todos los modos**, después del handoff, también en `continuar` (aunque no escriba otros archivos) y en `autonomo` (sin preguntas). Si el contrato dice `Reporte: no`, dilo en una línea y sáltalo.

1. Redacta el **cuerpo**, siempre con estas tres líneas (cada una puede llevar sub-bullets):
   ```
   - Hecho: PRs, commits y deploys de esta tanda, cada uno con su hora
   - Quedó: lo que sigue o lo que espera, y de quién
   - Retro: qué salió bien · qué salió mal · qué mejorar
   ```
   Solo lo de esta tanda (desde el checkpoint anterior). SHAs cortos (8 caracteres): un SHA completo se redacta.
2. Pásalo por stdin al script, en una llamada Bash con heredoc `<<'EOF'`:
   `node "${CLAUDE_SKILL_DIR}/scripts/reporte.mjs" --terminal <nombre> [--build <build_id>] --descriptor /ruta/al/repo/CLAUDE.md <<'EOF'`
   - `<nombre>`: el de la sesión (el último tramo de su dirección de mensajería entre sesiones, la sesión de tmux o el slug).
   - `--build`: el build en curso, si lo hay; si no, el encabezado dice `sin build`.
   - `--descriptor` solo acepta el `CLAUDE.md` del repo (markdown con `## Cierre de sesión`); un descriptor JSON no se pasa. Sin `CLAUDE.md` propio (o de un remoto ajeno), omite `--descriptor`: vale el valor por defecto.
3. El script pone el encabezado `## <hora> · <build_id>`, redacta secretos y **agrega** el bloque al archivo, sin borrar lo anterior. Responde con una línea:
   - `agregado: <ruta>`: listo; menciona la ruta en el reporte final.
   - `link: <dirección>` y el bloque: la sesión corre fuera del host que declara el contrato. Manda ese bloque tal cual, en un mensaje, a esa dirección con la herramienta de mensajería entre sesiones (si no la hay, dilo y pega el bloque en pantalla).
   - error (sale con 1): corrige el cuerpo o di por qué no se escribió; nunca escribas el archivo a mano.

---

## Al terminar
Reporta al usuario, en breve: modo, qué se commiteó (y en qué repo/entorno), estado del push (o por qué no aplicó; en `cierre`, después del aviso de fin), links a PRs, dónde quedó el handoff, dónde quedó el reporte (o a quién se mandó), y pega el prompt de handoff listo para copiar (en `autonomo`, solo la ruta del handoff y la línea del reporte). Sé explícito si algo quedó sin respaldar.

## Notas
- **Fuente de verdad:** el descriptor del proyecto (si existe) + el `CLAUDE.md` del repo. Ante conflicto entre ellos, confirma con el usuario.
- **Coordinación:** esta skill no actualiza buzones compartidos entre varias personas o sesiones; si el proyecto usa uno, actualízalo aparte según sus reglas.
- **Instalación:** `claude plugin marketplace add emiliovos/sielay-skills && claude plugin install si@sielay` (se invoca como `/si:checkpoint`). Actualizar: `claude plugin update si@sielay`.
