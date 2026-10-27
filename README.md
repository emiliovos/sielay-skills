# sielay-skills

[![validate](https://github.com/emiliovos/sielay-skills/actions/workflows/validate.yml/badge.svg)](https://github.com/emiliovos/sielay-skills/actions/workflows/validate.yml)

Skills de uso diario de [sielay](https://sielay.cloud) para Claude Code. No necesitan npm ni login.

## Instalar (Claude Code)

```
claude plugin marketplace add emiliovos/sielay-skills && claude plugin install si@sielay
```

El plugin trae dos skills: `/si:checkpoint` y `/si:build-auto`. Las que se agreguen se anuncian en la tabla de abajo y en el release correspondiente. Solo te llegan cuando corres `claude plugin update si@sielay`, nunca solas.

Las skills quedan como `/si:<skill>`, por ejemplo `/si:checkpoint`. Conviven con cualquier skill local del mismo nombre en `~/.claude/skills/`.

Requisitos: Claude Code reciente y `git` en el PATH. En Windows sin llave SSH de GitHub, exporta `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` antes de correr el comando.

## Actualizar

Las actualizaciones no son automáticas. Para recibir cambios y skills nuevas:

```
claude plugin update si@sielay
```

## Repos con su propio cierre de sesión

`/si:checkpoint` usa por defecto bitácora en `docs/journals/`, `codebase-summary.md`, rama + PR y `HANDOFF.md` en el plan activo. Si tu repo cierra distinto, copia esta sección en su `CLAUDE.md` con **las tres líneas** y deja en cada una una sola de las opciones:

```
## Cierre de sesión
- Estado: <ruta del archivo de estado> | journals
- Push: rama+PR | main directo | no pushear
- Handoff: <ruta de archivo> | estado | pantalla
```

Ejemplo de un repo que cierra en un solo archivo, trabaja en `main` y entrega el handoff en pantalla:

```
## Cierre de sesión
- Estado: docs/estado-y-siguiente-paso.md
- Push: main directo
- Handoff: pantalla
```

Si unos repos se pushean distinto que otros (por ejemplo, el repo del proyecto va por PR y los de docs y planes van directo a `main`), agrega excepciones a la línea `Push` después de `;`, nombrando cada repo por la carpeta raíz de su checkout. El primer valor aplica a todos los repos que no nombres:

```
- Push: rama+PR; pve2-docs, pve2-plans: main directo
```

El modo `continuar` no usa el estado ni el push del contrato: no escribe bitácora ni docs, no pushea y siempre entrega el handoff en pantalla. El modo `autonomo` (para terminales de un build que reinician su contexto) es `continuar` sin preguntas y con el handoff en `~/handoffs/<sesion>.md`, de 40 líneas como máximo.

Si la sesión arranca fuera de un repo (por ejemplo, en el home de un servidor que maneja varios proyectos), la skill lee el `CLAUDE.md` del directorio donde arrancó.

### Reporte por terminal

Todos los modos, también `continuar` y `autonomo`, terminan agregando un bloque de reporte para el reporte del día. Así no se pierde con cada `/clear` lo que hizo la sesión. El bloque es fijo:

```
## <hora> · <build_id | sin build>
- Hecho: PRs, commits y deploys, con hora
- Quedó: lo que sigue o lo que espera, y de quién
- Retro: qué salió bien · qué salió mal · qué mejorar
```

Lo escribe `scripts/reporte.mjs`, que redacta secretos y solo agrega, nunca borra. Solo escribe en un `.md` dentro del home, sin carpetas ocultas ni symlinks. Por defecto va a `~/handoffs/reportes/{AAMMDD}-{terminal}.md`, con la fecha local. Una cuarta línea opcional en `## Cierre de sesión` lo cambia:

```
- Reporte: ~/handoffs/dia-{AAMMDD}/reportes/{terminal}.md; corte 08:00 America/Mexico_City; fuera de srv1: link ana/srv1/coord
```

- **`corte 08:00 <zona>`:** el reporte de cada día junta lo que pasó desde las 08:00 del día anterior hasta las 07:59 de ese día, y se lee esa mañana.
- **`fuera de <host>: link <dirección>`:** una sesión que corre en otro host no escribe nada. Manda el bloque a esa dirección por mensajería entre sesiones.
- **`Reporte: no`:** apaga el reporte.

Cada valor que pongas reemplaza al de por defecto, nunca se suma: con `Estado` en una ruta no se crean bitácoras ni `codebase-summary.md`, y el handoff va dentro de ese archivo salvo que pongas `Handoff: <ruta>`. Con `Handoff: estado` o `pantalla` no se crea `HANDOFF.md`. La skill nunca escribe rutas de solo lectura ni corre scripts de publicación o deploy.

Solo hay dos caminos: la sección exacta o los valores por defecto. Sin la sección, la skill no deduce nada del texto libre del `CLAUDE.md`: usa los valores por defecto y lo dice al empezar. Si la prosa sugiere otro cierre, pregunta antes de escribir nada.

## Notas automáticas (si-auto, opcional)

**Qué garantiza:** que el contexto de una sesión no se pierda y que la siguiente sesión lo integre, sin que nadie escriba un comando. **Qué no garantiza:** commits ni respaldo; eso sigue siendo trabajo de la sesión (o de `/si:checkpoint`). si-auto nunca escribe dentro del árbol de trabajo ni hace `git add`, `commit` o `push`: `git status` queda idéntico.

```
claude plugin install si-auto@sielay
```

Requisitos: `si@sielay` (se instala como dependencia) y `python3`. Viene apagado: se enciende repo por repo agregando una línea a la sección `## Cierre de sesión` del `CLAUDE.md`:

```
- Automático: sí
```

o `- Automático: sí, cada N min` para cambiar el umbral (30 min por defecto). Cualquier otra redacción cuenta como apagado.

### Qué hace cada gancho

| Gancho | Cuándo dispara | Qué hace |
|---|---|---|
| Stop | Al terminar cada turno | Si pasaron N min desde la última nota y esta sesión trabajó (usó Edit, Write o Bash), bloquea **una vez** y le pide a Claude su nota entre `<si-auto-nota>` y `</si-auto-nota>`, sin herramientas. En el turno siguiente guarda esa nota. Si el turno terminaba en pregunta, Claude la repite después de la nota |
| PreCompact | Antes de compactar | Nunca bloquea; solo lo anota. Después de compactar, SessionStart pide refrescar la nota |
| SessionEnd | Al salir, cerrar, `/clear` | Marca la nota como terminada. No lanza procesos ni usa el modelo |
| SessionStart | Al abrir una sesión | Entrega las notas de sesiones anteriores que terminaron (o cuyo proceso murió) para que Claude las integre al archivo de estado. Cada nota llega con su worktree y su rama, y se presenta como información de otra sesión, no como instrucciones. El commit va en el cierre normal de esa sesión; nunca hace commit ni push al arrancar |

Los ganchos solo leen del repo `git rev-parse` y el `CLAUDE.md`, y solo escriben en `<git-common-dir>/si-auto/` (dentro de `.git`, que git no muestra en `status`; los worktrees comparten esa carpeta). Claude nunca escribe archivos para si-auto: la nota viaja en el texto de su respuesta y la guarda el gancho. Las notas entregadas se borran a los 14 días.

### Apagarlo y revisarlo

- Por repo: quitar la línea `- Automático: sí`.
- Por sesión: `SI_AUTO_OFF=1 claude`.
- Ver notas pendientes, entregadas (con su veredicto) y la bitácora del repo actual:
  `bash "$(ls -td ~/.claude/plugins/cache/sielay/si-auto/*/ | head -1)scripts/ver-notas.sh"`

`SI_AUTO_UMBRAL_MIN` existe solo para pruebas: fuerza el umbral en minutos.

### Qué no queda cubierto

- Lo trabajado después de la última nota y antes de cerrar (hasta N min). Los archivos siguen en disco y la siguiente sesión los ve en `git status`.
- Corte de luz o `kill -9`: se entrega la última nota guardada.
- Commits y respaldo: no son tarea de si-auto.
- Secretos en la nota: la orden le pide a Claude no incluir valores sensibles, pero la nota es texto del modelo y se guarda tal cual dentro de `.git/si-auto/`. La bitácora solo guarda ids y eventos.

## Conectar sesiones (sielay-link, opcional)

Deja que sesiones de Claude Code emparejadas por el hub de sielay se escriban entre sí. Un admin crea un slot por máquina y aprueba el emparejamiento con 2FA. Los mensajes que no se auto-ejecutan esperan en una franja hasta que la persona los acepta.

```
claude plugin install sielay-link@sielay
```

Luego, en la sesión: `/link pair <slot>`. Requiere Claude Code 2.1.300 y Node 20 o más reciente. La entrada va fijada al tag `sielay-link-v1.11.0`. Instalación, nombres, reglas de auto-ejecución y seguridad: [plugins/sielay-link/README.md](plugins/sielay-link/README.md).

## Claude Desktop (chat)

Cada [release](https://github.com/emiliovos/sielay-skills/releases) trae un `.zip` por skill, con su sha256 en las notas. si-auto no aplica aquí: los ganchos solo funcionan en Claude Code. Bájalo y súbelo en la configuración de skills de tu cuenta. Para actualizar, sube el `.zip` del release nuevo.

## Seguridad

- Este repo es la única fuente de las skills. `main` solo cambia por PR y los tags de release no se pueden mover.
- El one-liner oficial siempre apunta a `emiliovos/sielay-skills`. Desconfía de cualquier otro dueño o nombre parecido.
- El plugin `si` no tiene hooks, servidores MCP, ejecutables ni dependencias. El CI (`tools/check-plugin.sh`) lo impide.
- `si-auto` sí trae ganchos, por eso va aparte y es opcional. Su CI (`tools/check-si-auto.sh`) solo acepta sus archivos conocidos, los cuatro ganchos, `git rev-parse` como único comando de git, nada de red y escrituras solo en su carpeta de notas. Nace en este repo; `SOURCE_COMMIT` describe solo la copia de las skills de `si`.
- `sielay-link` trae un módulo de hooks, un ejecutable de Node y red, y va fijado a un tag. Su CI (`tools/check-sielay-link.sh`) exige estas reglas:
  - el hub solo puede estar en `https://sielay.cloud` o `https://sielay.vostec.mx`;
  - solo un módulo hace red y solo otro corre procesos;
  - sin `asUser` y sin el token en `$.store`.

  Es defensa en profundidad. Lo que se instala cambia solo cuando la entrada del marketplace apunta a un tag nuevo.
- Una skill son instrucciones que Claude sigue con tus permisos. Antes de actualizar, puedes revisar qué cambió en el historial de `plugins/si/skills/`.

## Formato del handoff por modo

Todos los modos agregan al handoff un bloque `ENTORNO VIVO` (crons de `CronList`, procesos que la sesión dejó en segundo plano con su PID, estado git de cada repo) y un bloque `ARRANQUE` con el que la sesión nueva lo verifica antes de seguir. El inventario sale de una sola llamada a `scripts/entorno-vivo.mjs` (Node 18 o más, sin dependencias, solo lee) más `CronList`.

| Modo | Qué hace | Handoff | Largo |
|---|---|---|---|
| `/si:checkpoint` (cierre) | Bitácora, docs solo si cambió algo visible, commit y push en segundo plano; el inventario y el reporte llegan cuando el push termina | según tu `## Cierre de sesión` | completo |
| `/si:checkpoint continuar` | Commit local y el bloque de reporte, para seguir la misma tarea tras `/clear` | pantalla: objetivo, estado, siguiente, ENTORNO VIVO, ARRANQUE | hasta 25 líneas |
| `/si:checkpoint autonomo` | Igual que `continuar`, sin preguntas, para terminales de un build | archivo `~/handoffs/<sesion>.md` | hasta 40 líneas |
| `/si:checkpoint coordinador` | Cierre completo y, además, las demás sesiones de la máquina y los renglones marcados `(coordinador)` | según tu `## Cierre de sesión` | completo |

Al retomar, `entorno-vivo.mjs --verificar <handoff>` clasifica lo que quedó: procesos muertos (un PID reciclado con otra hora de inicio cuenta como muerto), huérfanos anteriores al handoff y duplicados. No mata nada por sí solo. La sesión nueva detiene (con `--detener <pid>`, que solo acepta hijos directos de su propio `claude`) los huérfanos que el handoff marca `vigía: sí`, es decir, monitores y bucles de espera que se vuelven a armar; los demás se reportan y se pregunta qué hacer (en `autonomo` se dejan vivos). También reporta, sin detenerlos, los procesos del handoff que siguen vivos con el mismo inicio pero no cuelgan de ese `claude` (`vivos_ajenos`). Hay inventario de procesos en Linux y macOS; en otras plataformas el script lo avisa y sigue con lo demás.

**Límite:** el script no distingue el Bash de un subagente del de la sesión principal, porque ambos son hijos del mismo `claude`. Por eso `vigía: sí` solo va en los monitores y bucles de espera que la sesión principal armó y conoce, y el checkpoint se toma sin subagentes corriendo.

### Fuentes de estado propias del repo

Una sección opcional del `CLAUDE.md` suma fuentes al ENTORNO VIVO. Sin ella solo va lo genérico:

```
## Entorno vivo
- estado: `node scripts/ruta/estado.mjs`
- conversaciones: contexto — conversaciones abiertas que esperan respuesta
- equipo: `node scripts/ruta/estado.mjs --todos` (coordinador)
```

Un renglón con comando entre backticks se ejecuta desde la raíz del repo, en paralelo, con 30 s por comando y 60 s en total, solo si empieza con `node scripts/`, `bash scripts/` o `./scripts/` y no lleva `|`, `;`, `&`, `$(`, backticks, `>`, `<`, comillas ni `..`; cualquier otro se cita y no se corre. Un renglón `contexto — …` se completa de memoria de la sesión. El `CLAUDE.md` debe estar dentro del repo, y el de un remoto ajeno nunca se ejecuta.

## Skills

| Skill | Qué hace |
|---|---|
| `/si:checkpoint` | Cierre de sesión: journal, docs, commit, push y handoff para retomar en otra terminal, con el entorno vivo de la sesión (crons, procesos en segundo plano, estado git) y una verificación al retomar. Modos `continuar`, `autonomo` y `coordinador`: ver «Formato del handoff por modo» |
| `/si:build-auto` | Proyecto autónomo en 7 etapas: tú apruebas Frame, Evidencia y Plan; los agentes implementan, prueban, revisan y entregan hasta merge o producción por la compuerta de pruebas del repo. Funciona con PRs o con push directo a main; AgentKit (`/ak:*`) es recomendado, no obligatorio |
| `si-auto` (plugin aparte) | Nota de sesión automática fuera del repo, entregada a la sesión siguiente |
| `sielay-link` (plugin aparte) | Mensajes entre sesiones de Claude Code emparejadas por el hub de sielay, con franja para aceptar o rechazar |
