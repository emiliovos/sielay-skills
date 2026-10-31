---
name: checkpoint-terminal
description: "Cierra con una sola llamada una terminal de trabajo cuyo encargo ya terminó, sin trabajo abierto. Úsala solo cuando el coordinador o la persona la pidan por su nombre; para cualquier otro cierre va /si:checkpoint."
user-invocable: true
when_to_use: "Solo si te piden '/checkpoint-terminal' por su nombre y el encargo ya terminó. Un corte a media tarea usa /si:checkpoint autonomo."
argument-hint: "--terminal <nombre> [--repo <ruta>]..."
keywords: [cierre, terminal, handoff, reporte, coordinador]
metadata:
  category: workflow
  example: "/checkpoint-terminal --terminal obrera-3 --repo ~/mi-repo"
  deps: "La skill checkpoint del mismo plugin, porque usa sus scripts. git configurado; gh opcional para ver PRs."
  installs: []
  risk: none
  version: "1.0.0"
---

# Checkpoint de terminal

Cierre mínimo de una terminal que ya terminó su encargo: comprueba el entorno, agrega el reporte y deja un handoff de 3 líneas. Nunca reemplaza a `/si:checkpoint`.

**Solo si el encargo terminó y no queda nada que retomar.** Un corte a media tarea nunca entra aquí, aunque git esté limpio: lo que aún no está en el código solo lo guarda el handoff.

Sin leer ni correr nada más, una llamada Bash, con un `--repo` por cada worktree que usaste. `--encargo-cerrado` declara que el encargo terminó y que no quedan crons ni conversaciones de link pendientes; si tienes dudas, no lo pases. `--descriptor` solo acepta el `CLAUDE.md` del repo; sin uno propio, omítelo.

```bash
node "${CLAUDE_SKILL_DIR}/../checkpoint/scripts/ligero.mjs" --terminal <nombre> --encargo-cerrado --repo <ruta> --descriptor /ruta/al/repo/CLAUDE.md <<'EOF_CUERPO'
- Hecho: PRs, commits y deploys de esta tanda, cada uno con su hora
- Quedó: lo que sigue o lo que espera, y de quién
- Retro: qué salió bien · qué salió mal · qué mejorar
EOF_CUERPO
```

Solo lo de esta tanda, con SHAs de 8 caracteres: uno completo se redacta. `<nombre>` es el de la sesión.

| Salida | Qué pasó | Qué haces |
|---|---|---|
| 0 | Cerrado | Responde con una línea: handoff y reporte. Si responde `link:`, manda el bloque antes |
| 2 | No escribió nada: hay trabajo abierto o falta un dato; los motivos dicen cuál | Corre `/si:checkpoint autonomo` o `/si:checkpoint` |
| 1 | Error en los argumentos o el cuerpo | Corrígelo o usa `/si:checkpoint autonomo` |
