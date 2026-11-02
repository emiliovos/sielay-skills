# Reporte a sielay (`link_build_stage`)

Si la sesión tiene la herramienta `link_build_stage` (la publica el plugin `sielay-link`), el coordinador le cuenta a sielay en qué va el build, para que se vea en su visor de builds. Solo informa: no aprueba, no entrega y no dispara nada. Una aprobación siempre viene del usuario, nunca de la herramienta.

Este archivo es el núcleo: lo mínimo que reporta todo build. Versiones, casos en que no aplica, `waiting`, `stage_detail`, `live`, `delivery`, `retro`, `estimate`, el deploy ligero y los demás momentos están en `reporte-sielay-anexo.md`; léelo al llegar a ese momento.

## `build_id`
- `<repo>-<carpeta-del-plan>`: el nombre del repo sin el dueño y la carpeta del plan (`{AAMMDD}-{slug}`).
- Se fija en la etapa 1, antes del primer reporte: elige ya la carpeta del plan y anota `build_id: <valor>` en el reporte del brainstorm o del Frame. La etapa 3 usa esa carpeta tal cual y copia el `build_id` a `plan.md`.

## Campos
Cada llamada lleva siempre `build_id`, `role`, `stage` (1 a 7, con el número real de la etapa en cualquier flujo; la etapa 8, Cierre, se reporta como `stage: 7`) y `status` (`running`, `waiting_approval`, `blocked` o `done`). La herramienta mezcla cada llamada con las anteriores del mismo `build_id`: manda solo lo que cambió.

## Momentos mínimos
| Momento | Campos (además de los obligatorios) |
|---|---|
| Arranque (entrada a la etapa 1) | `stage: 1`, `status: "running"`, `flow` (`full`, `chico` o `fix`; medio y grande van con `full`, chico con `chico`), `title` (el objetivo, máximo 120), `repo` (`<dueño>/<repo>`), `flags` (incluye `nivel:<chico|medio|grande>`); `branch` y `linear` (clave del issue) si ya se conocen |
| Entrada a cada etapa | `stage: N`, `status: "running"`. En la 3, `plan` (ruta del `plan.md`). En la 4, `plan_progress: { done: 0, total: <carriles> }` y `phase` del primero |
| Cierre de cada etapa | `stage_detail` con `items` de evidencia y enlaces (ver el anexo), junto con el `summary` |
| Pedir aprobación (etapa 1 y la conjunta en la 3; la 2 solo con `--pausas` o la pausa automática) | `status: "waiting_approval"` y el `summary` de lo que se presenta. En la 1, `estimate` con el estimado grueso del Frame; en la 3, `estimate` con el del plan por carril, con `stage: 3` todavía (ese es el programado, que se congela al entrar a la etapa 4) |
| Aprobación recibida | `status: "running"`, `gate: { stage: N, approved_by: "<quien-aprobó>", approved_at: "<salida de date -u>" }` (`approved_by` es el nombre del usuario si lo conoces; si no, `usuario`); luego, la entrada a la etapa siguiente |
| Fin (etapa 8) | `stage: 7`, `status: "done"`, `outcome`, el `summary` final (estilo brief) y `retro`. Si el build paró antes, `stage` es la etapa donde terminó y `retro` va igual si hay qué contar |

`outcome`: `delivered`, `stopped` o `failed`. `summary`: de 1 a 3 frases, máximo 600 caracteres, sin secretos ni datos de clientes. Definiciones y el resto de los momentos (esperas, carriles, PR, entrega, reestimación): anexo.

Sin la herramienta o con `reported: false`, el flujo sigue igual, sin error ni pregunta; un reporte nunca detiene ni cambia el build. Después de `done` el build queda cerrado: no vuelvas a reportar con ese `build_id`.
