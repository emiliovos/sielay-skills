# Reporte a sielay (`link_build_stage`)

Si la sesión tiene la herramienta `link_build_stage` (la publica el plugin `sielay-link`), el coordinador le cuenta a sielay en qué va el build, para que se vea en su visor de builds. Solo informa: no aprueba, no entrega y no dispara nada. Una aprobación siempre viene del usuario, nunca de la herramienta.

## Cuándo no aplica
- **Sin la herramienta** (no está `sielay-link` o la sesión no la expone): no la llames ni la menciones. El flujo sigue igual, sin error y sin preguntar.
- **`reported: false`** (la sesión no está emparejada o el plugin está apagado): sigue igual; no reintentes ni avises.
- **Rechazo por un campo** (`el campo <x> no es válido`): corrige u omite ese campo una vez y sigue. Un reporte nunca detiene ni cambia el build.

## `build_id`
- `<repo>-<carpeta-del-plan>`: el nombre del repo sin el dueño y la carpeta del plan (`{AAMMDD}-{slug}`). Ejemplo: `<repo>-260101-<slug>`.
- En minúsculas; cualquier carácter fuera de `a-z 0-9 . _ -` pasa a `-`; de 3 a 80 caracteres.
- Fija la carpeta del plan en el Frame y úsala tal cual en la etapa 3, para que el `build_id` no cambie a mitad del build.
- Anótalo en `plan.md`. Retomar un build que no cerraste (sin `done`) usa el mismo. Un build cerrado no se reabre: una corrida nueva sobre la misma carpeta usa `-r2`, `-r3`… (el siguiente al último anotado).

## Campos
Cada llamada lleva siempre `build_id`, `role`, `stage` (1 a 7) y `status` (`running`, `waiting_approval`, `blocked` o `done`). La herramienta mezcla cada llamada con las anteriores del mismo `build_id`: manda solo lo que cambió. Los subagentes, el uso de tokens y las fechas de inicio los pone el plugin; los subagentes no llaman la herramienta.

Solo el coordinador (`role: "coordinator"`) manda `stage`, `status`, `outcome`, `gate`, `summary`, `delivery`, `plan_progress` y `title`. Una terminal trabajadora usa `role: "worker"` y solo aporta `phase` (ver `terminales.md`).

## Momentos
| Momento | Campos (además de los obligatorios) |
|---|---|
| Arranque (entrada a la etapa 1) | `stage: 1`, `status: "running"`, `title` (el objetivo, máximo 120), `repo` (`<dueño>/<repo>`), `flags`; `branch` y `linear` (clave del issue) si ya se conocen |
| Entrada a cada etapa | `stage: N`, `status: "running"`. En la 3, `plan` (ruta del `plan.md`). En la 4, `plan_progress: { done: 0, total: <fases> }` y `phase` de la primera |
| Pedir aprobación (etapas 1, 2 y 3) | `status: "waiting_approval"` y el `summary` de lo que se presenta |
| Aprobación recibida | `status: "running"`, `gate: { stage: N, approved_by: "<quien-aprobó>", approved_at: "<ISO 8601 UTC, ahora>" }` (`approved_by` es el nombre del usuario si lo conoces; si no, `usuario`); luego, la entrada a la etapa siguiente |
| Cierre de cada fase (etapa 4) | `plan_progress` con `done` + 1 y `phase` de la que sigue en curso (con varias en paralelo, la de número menor) |
| PR abierto | `pr: <número>`, `branch`, `delivery: { merge_pr: "pending" }` |
| Comando de entrega corriendo / terminado | `delivery.merge_pr`: `"running"`, luego `"merged"` o `"failed"`; `stamp` con el SHA del sello si la compuerta lo produce (si no, `null`) |
| Deploy pendiente o hecho | `delivery.deploy_pending: true` mientras falte publicar; `false` cuando el comando de publicación termina bien |
| Bloqueo fuera de un gate | `status: "blocked"` y un `summary` con el motivo (un momento humano, un Critical/High tras el tope de revisión, un guardarraíl) |
| Fin | `status: "done"`, `outcome` y el `summary` final; `stage` es la etapa donde terminó |

Notas:
- En `main directo` no hay PR: `pr` queda fuera y `merge_pr` sigue el push a main por la compuerta.
- Con varios PRs, `pr` es el que se entrega ahora.
- Con `--chico` no hay etapa 2: se pasa de la 1 a la 3.
- Volver a una etapa (por ejemplo, de Revisar a Implementar) es otra entrada: se reporta igual.
- `links` es opcional: hasta 10 `{ label, href }` hacia reportes del plan, con ruta relativa (sin `/` inicial) o URL `https:`.

## `outcome`
- `delivered`: se llegó al alcance acordado (merge, o merge y publicación con `produccion`).
- `stopped`: se detuvo a propósito antes del alcance: lo paró el usuario, quedó un Critical/High tras el tope, un guardarraíl o falta autoridad.
- `failed`: algo falló y no se pudo entregar (compuerta en rojo sin arreglo dentro del plan, entrega o publicación fallida).

Después de `done` el build queda cerrado: no vuelvas a reportar con ese `build_id`.

## `summary`
Al cerrar cada etapa (en las de aprobación, al pedirla), de 1 a 3 frases sobre qué se hizo y cómo, en el idioma del usuario y en máximo 600 caracteres. Es el único texto narrativo que escribes; el resto de los campos son datos del repo y del plan. Nunca secretos, tokens, URLs con credenciales ni datos personales o de clientes.
