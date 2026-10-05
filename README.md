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

## Claude Desktop (chat)

Cada [release](https://github.com/emiliovos/sielay-skills/releases) trae un `.zip` por skill, con su sha256 en las notas. Bájalo y súbelo en la configuración de skills de tu cuenta. Para actualizar, sube el `.zip` del release nuevo.

## Seguridad

- Este repo es la única fuente de las skills. `main` solo cambia por PR y los tags de release no se pueden mover.
- El one-liner oficial siempre apunta a `emiliovos/sielay-skills`. Desconfía de cualquier otro dueño o nombre parecido.
- El plugin no tiene hooks, servidores MCP, ejecutables ni dependencias. El CI (`tools/check-plugin.sh`) lo impide.
- Una skill son instrucciones que Claude sigue con tus permisos. Antes de actualizar, puedes revisar qué cambió en el historial de `plugins/si/skills/`.

## Skills

| Skill | Qué hace |
|---|---|
| `/si:checkpoint` | Cierre de sesión: journal, docs, commit, push y handoff para retomar en otra terminal |
