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
