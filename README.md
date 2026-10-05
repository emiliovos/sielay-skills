# sielay-skills

[![validate](https://github.com/emiliovos/sielay-skills/actions/workflows/validate.yml/badge.svg)](https://github.com/emiliovos/sielay-skills/actions/workflows/validate.yml)

Skills de uso diario de [sielay](https://sielay.cloud) para Claude Code. No necesitan npm ni login.

## Instalar (Claude Code)

```
claude plugin marketplace add emiliovos/sielay-skills && claude plugin install si@sielay
```

Hoy el plugin trae una sola skill: `/si:checkpoint`. Si se agregan otras, se anuncian en la tabla de abajo y en el release correspondiente. Solo te llegan cuando corres `claude plugin update si@sielay`, nunca solas.

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
| Stop | Al terminar cada turno | Si pasaron N min desde la última nota y esta sesión editó al menos un archivo, bloquea **una vez** y le pide a Claude su nota entre `<si-auto-nota>` y `</si-auto-nota>`, sin herramientas. En el turno siguiente guarda esa nota. Si el turno terminaba en pregunta, Claude la repite después de la nota |
| PreCompact | Antes de compactar | Nunca bloquea; solo lo anota. Después de compactar, SessionStart pide refrescar la nota |
| SessionEnd | Al salir, cerrar, `/clear` | Marca la nota como terminada. No lanza procesos ni usa el modelo |
| SessionStart | Al abrir una sesión | Entrega las notas de sesiones anteriores que terminaron (o cuyo proceso murió) para que Claude las integre al archivo de estado. El commit va en el cierre normal de esa sesión; nunca hace commit ni push al arrancar |

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

## Claude Desktop (chat)

Cada [release](https://github.com/emiliovos/sielay-skills/releases) trae un `.zip` por skill, con su sha256 en las notas. si-auto no aplica aquí: los ganchos solo funcionan en Claude Code. Bájalo y súbelo en la configuración de skills de tu cuenta. Para actualizar, sube el `.zip` del release nuevo.

## Seguridad

- Este repo es la única fuente de las skills. `main` solo cambia por PR y los tags de release no se pueden mover.
- El one-liner oficial siempre apunta a `emiliovos/sielay-skills`. Desconfía de cualquier otro dueño o nombre parecido.
- El plugin `si` no tiene hooks, servidores MCP, ejecutables ni dependencias. El CI (`tools/check-plugin.sh`) lo impide.
- `si-auto` sí trae ganchos, por eso va aparte y es opcional. Su CI (`tools/check-si-auto.sh`) solo acepta sus archivos conocidos, los cuatro ganchos, `git rev-parse` como único comando de git, nada de red y escrituras solo en su carpeta de notas. Nace en este repo; `SOURCE_COMMIT` describe solo la copia de las skills de `si`.
- Una skill son instrucciones que Claude sigue con tus permisos. Antes de actualizar, puedes revisar qué cambió en el historial de `plugins/si/skills/`.

## Skills

| Skill | Qué hace |
|---|---|
| `/si:checkpoint` | Cierre de sesión: journal, docs, commit, push y handoff para retomar en otra terminal |
| `si-auto` (plugin aparte) | Nota de sesión automática fuera del repo, entregada a la sesión siguiente |
