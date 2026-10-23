# Reporte a sielay (`link_build_stage`)

Si la sesión tiene la herramienta `link_build_stage` (la publica el plugin `sielay-link`), el coordinador le cuenta a sielay en qué va el build, para que se vea en su visor de builds. Solo informa: no aprueba, no entrega y no dispara nada. Una aprobación siempre viene del usuario, nunca de la herramienta.

## Cuándo no aplica
- **Sin la herramienta** (no está `sielay-link` o la sesión no la expone): no la llames ni la menciones. El flujo sigue igual, sin error y sin preguntar.
- **`reported: false`**: sigue igual; no reintentes ni avises. Desde sielay-link 1.4.0 trae `reason`: `pending` (todavía no hay poll), `too_many_sessions`, `paused`, `unauthorized`, `unpaired`, `off` o `unreachable`. Con `too_many_sessions` (el dispositivo llegó al tope de sesiones), anótalo una vez en la ficha y sigue.
- **`reported: true`** significa que el hub acepta los polls de esta sesión, no que registró el build: puede ignorarlo (por ejemplo, por su tope de builds, un build ya cerrado o el visor apagado).
- **Rechazo por un campo** (`el campo <x> no es válido`): corrige u omite ese campo una vez y sigue. Un reporte nunca detiene ni cambia el build.
- **Plugin anterior a sielay-link 1.3.0** (no conoce `estimate`): si rechaza la llamada por ese campo, repítela sin `estimate` y no lo vuelvas a mandar en ese build; si la acepta, el campo se descarta sin aviso y el visor no muestra horario. En los dos casos el estimado queda solo en el contrato.

## `build_id`
- `<repo>-<carpeta-del-plan>`: el nombre del repo sin el dueño y la carpeta del plan (`{AAMMDD}-{slug}`).
- Se fija en la etapa 1, antes del primer reporte: elige ya la carpeta del plan y anota `build_id: <valor>` en el reporte del brainstorm o del Frame. La etapa 3 usa esa carpeta tal cual y copia el `build_id` a `plan.md`.
- Retomar un build que no cerraste (sin `done`) usa el mismo. Si la carpeta ya tiene un `build_id` anotado por otra corrida (aunque esa parara en el Frame), usa el sufijo siguiente al mayor anotado: `-r2`, `-r3`…
- Normalización:
  - en minúsculas;
  - lo que no sea `[a-z0-9._-]` pasa a `-`;
  - si no empieza con `[a-z0-9]`, se le antepone `x`;
  - se recorta a 80 caracteres sin perder el sufijo `-rN` (se recorta la parte de antes).

  Ejemplo: repo `_Mi.Repo` y carpeta `260101-Exportar PDF`, segunda corrida → `x_mi.repo-260101-exportar-pdf-r2`.

## Campos
Cada llamada lleva siempre `build_id`, `role`, `stage` (1 a 7) y `status` (`running`, `waiting_approval`, `blocked` o `done`). La herramienta mezcla cada llamada con las anteriores del mismo `build_id`: manda solo lo que cambió. Los subagentes, el uso de tokens y las fechas de inicio los pone el plugin; los subagentes no llaman la herramienta.

Toda fecha que mandes (`approved_at`) sale del reloj del sistema con `date -u +%Y-%m-%dT%H:%M:%SZ`, nunca escrita por ti.

Solo el coordinador (`role: "coordinator"`) manda `stage`, `status`, `outcome`, `gate`, `summary`, `delivery`, `plan_progress`, `title` y `estimate`. Una terminal trabajadora usa `role: "worker"` y solo aporta `phase` (ver `terminales.md`). A las terminales solo les das el `build_id` si recibiste `reported: true`; si no, no reportan.

## Momentos
| Momento | Campos (además de los obligatorios) |
|---|---|
| Arranque (entrada a la etapa 1) | `stage: 1`, `status: "running"`, `title` (el objetivo, máximo 120), `repo` (`<dueño>/<repo>`), `flags`; `branch` y `linear` (clave del issue) si ya se conocen |
| Entrada a cada etapa | `stage: N`, `status: "running"`. En la 3, `plan` (ruta del `plan.md`). En la 4, `plan_progress: { done: 0, total: <fases> }` y `phase` de la primera |
| Pedir aprobación (etapas 1, 2 y 3) | `status: "waiting_approval"` y el `summary` de lo que se presenta. En la 1, `estimate` con el estimado grueso del Frame; en la 3, `estimate` con el del plan por fase, con `stage: 3` todavía (ese es el programado, que se congela al entrar a la etapa 4) |
| Aprobación recibida | `status: "running"`, `gate: { stage: N, approved_by: "<quien-aprobó>", approved_at: "<salida de date -u>" }` (`approved_by` es el nombre del usuario si lo conoces; si no, `usuario`); luego, la entrada a la etapa siguiente |
| Cierre de cada fase (etapa 4) | `plan_progress` con `done` + 1 y `phase` de la que sigue en curso (con varias en paralelo, la de número menor) |
| PR abierto | `pr: <número>`, `branch`, `delivery: { merge_pr: "pending" }` |
| Comando de entrega corriendo / terminado | `delivery.merge_pr`: `"running"`, luego `"merged"` o `"failed"`; `stamp` con el SHA del sello si la compuerta lo produce (si no, `null`) |
| Deploy pendiente o hecho | `delivery.deploy_pending: true` mientras falte publicar; `false` cuando el comando de publicación termina bien |
| Reestimación | `estimate` completo con `reason` (motivo corto, máximo 120); `stage` y `status` los vigentes |
| Bloqueo fuera de un gate | `status: "blocked"` y un `summary` con el motivo (un momento humano, un Critical/High tras el tope de revisión, un guardarraíl) |
| Fin | `status: "done"`, `outcome` y el `summary` final; `stage` es la etapa donde terminó |

Notas:
- En `main directo` no hay PR: `pr` queda fuera y `merge_pr` sigue el push a main por la compuerta.
- Con varios PRs, `pr` es el que se entrega ahora.
- Con `--chico` no hay etapa 2: se pasa de la 1 a la 3.
- "Adelante con todo" (aprobaciones 2 y 3 juntas): dos `gate` con el mismo `approved_at`, primero el de la etapa 2 al recibirla y luego el de la 3 al cerrar el plan, en vez de `waiting_approval`.
- Volver a una etapa (por ejemplo, de Revisar a Implementar) es otra entrada: se reporta igual.
- `links` es opcional: hasta 10 `{ label, href }` hacia reportes del plan, con ruta relativa (sin `/` inicial) o URL `https:`.

## `estimate`
```json
{
  "estimate": {
    "total_h": 7,
    "phases": [{ "name": "Hub y API", "h": 1.5 }, { "name": "Visor", "h": 1.5 }],
    "assumption": "El servidor queda libre para la compuerta después de las 16:30",
    "reason": "revisión pidió otra vuelta"
  }
}
```
- Cada envío lleva el estimado **completo**: reemplaza al anterior, no se mezcla con él. `reason` solo en una reestimación.
- Límites: `total_h` mayor que 0 y hasta 999 (se redondea a 0,1); hasta 20 fases, cada una con `name` (máximo 80) y `h` de 0 a 999; `assumption` máximo 200; `reason` máximo 120; el objeto entero, máximo 2048 bytes.
- **Reestima** cuando el total previsto se mueve más que ±max(0,5 h, 10 % del programado), o al cerrar una fase que se pasó de lo estimado. Siempre con `reason`.
- Una reestimación es un dato, no una enmienda: no pide aprobación. Solo la pide si el motivo cambia el Goal, los criterios, los no-goals o la autoridad, y entonces es una enmienda normal.

## `outcome`
- `delivered`: se llegó al alcance acordado (merge, o merge y publicación con `produccion`).
- `stopped`: se detuvo a propósito antes del alcance: lo paró el usuario, quedó un Critical/High tras el tope, un guardarraíl o falta autoridad.
- `failed`: algo falló y no se pudo entregar (compuerta en rojo sin arreglo dentro del plan, entrega o publicación fallida).

Después de `done` el build queda cerrado: no vuelvas a reportar con ese `build_id`.

## `summary`
Al cerrar cada etapa (en las de aprobación, al pedirla), de 1 a 3 frases sobre qué se hizo y cómo, en el idioma del usuario y en máximo 600 caracteres. Es el único texto narrativo que escribes; el resto de los campos son datos del repo y del plan. Nunca secretos, tokens, URLs con credenciales ni datos personales o de clientes.
