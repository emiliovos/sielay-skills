# Reporte a sielay (`link_build_stage`)

Si la sesión tiene la herramienta `link_build_stage` (la publica el plugin `sielay-link`), el coordinador le cuenta a sielay en qué va el build, para que se vea en su visor de builds. Solo informa: no aprueba, no entrega y no dispara nada. Una aprobación siempre viene del usuario, nunca de la herramienta.

## Versión mínima
Sielay-link 1.7.0. Con esa versión el estimado (en el Frame y el Plan) y la retro (al cerrar) son obligatorios en cada build, no opcionales. Si la ficha muestra una versión anterior, dilo en una línea.

Los campos `flow`, `stage_detail`, `live` y `delivery.merge_queue`/`delivery.deploy` piden sielay-link 1.8.2. Con una versión anterior el plugin puede rechazarlos: repite la llamada sin el campo y no lo vuelvas a mandar en ese build (el build se reporta igual, sin esos detalles).

## Cuándo no aplica
- **Sin la herramienta** (no está `sielay-link` o la sesión no la expone): no la llames ni la menciones. El flujo sigue igual, sin error y sin preguntar.
- **`reported: false`**: sigue igual; no reintentes ni avises. Desde sielay-link 1.4.0 trae `reason`: `pending` (todavía no hay poll), `too_many_sessions`, `paused`, `unauthorized`, `unpaired`, `off` o `unreachable`. Con `too_many_sessions` (el dispositivo llegó al tope de sesiones), anótalo una vez en la ficha y sigue.
- **`reported: true`** significa que el hub acepta los polls de esta sesión, no que registró el build: puede ignorarlo (por ejemplo, por su tope de builds, un build ya cerrado o el visor apagado).
- **Rechazo por un campo** (`el campo <x> no es válido`): corrige u omite ese campo una vez y sigue. Un reporte nunca detiene ni cambia el build.
- **Plugin anterior a sielay-link 1.3.0** (no conoce `estimate`; el mínimo exigido ya es 1.7.0): si rechaza la llamada por ese campo, repítela sin `estimate` y no lo vuelvas a mandar en ese build; si la acepta, el campo se descarta sin aviso y el visor no muestra horario. En los dos casos el estimado queda solo en el contrato.

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
Cada llamada lleva siempre `build_id`, `role`, `stage` (1 a 7, con el número real de la etapa en cualquier flujo; la etapa 8, Cierre, se reporta como `stage: 7`) y `status` (`running`, `waiting_approval`, `blocked` o `done`). La herramienta mezcla cada llamada con las anteriores del mismo `build_id`: manda solo lo que cambió. Los subagentes, el uso de tokens y las fechas de inicio los pone el plugin; los subagentes no llaman la herramienta.

Toda fecha que mandes (`approved_at`) sale del reloj del sistema con `date -u +%Y-%m-%dT%H:%M:%SZ`, nunca escrita por ti.

Solo el coordinador (`role: "coordinator"`) manda `stage`, `status`, `outcome`, `gate`, `summary`, `delivery`, `plan_progress`, `title`, `estimate`, `waiting` y `retro`. Una terminal trabajadora usa `role: "worker"` y solo aporta `phase` (ver `terminales.md`). A las terminales solo les das el `build_id` si recibiste `reported: true`; si no, no reportan.

## Momentos
| Momento | Campos (además de los obligatorios) |
|---|---|
| Arranque (entrada a la etapa 1) | `stage: 1`, `status: "running"`, `flow` (`full`, `chico` o `fix`), `title` (el objetivo, máximo 120), `repo` (`<dueño>/<repo>`), `flags`; `branch` y `linear` (clave del issue) si ya se conocen |
| Entrada a cada etapa | `stage: N`, `status: "running"`. En la 3, `plan` (ruta del `plan.md`). En la 4, `plan_progress: { done: 0, total: <carriles> }` y `phase` del primero |
| Cierre de cada etapa | `stage_detail` con `items` de evidencia y enlaces (ver abajo), junto con el `summary` |
| Espera larga (CI, cola de merge, e2e, deploy) | `stage_detail.live` (ver abajo) |
| Pedir aprobación (etapa 1 y la conjunta en la 3; la 2 solo con `--pausas` o la pausa automática) | `status: "waiting_approval"` y el `summary` de lo que se presenta. En la 1, `estimate` con el estimado grueso del Frame; en la 3, `estimate` con el del plan por carril, con `stage: 3` todavía (ese es el programado, que se congela al entrar a la etapa 4) |
| Aprobación recibida | `status: "running"`, `gate: { stage: N, approved_by: "<quien-aprobó>", approved_at: "<salida de date -u>" }` (`approved_by` es el nombre del usuario si lo conoces; si no, `usuario`); luego, la entrada a la etapa siguiente |
| Cierre de cada carril (etapa 4) | `plan_progress` con `done` + 1 y `phase` del que sigue en curso (con varios en paralelo, el de número menor) |
| PR abierto | `pr: <número>`, `branch`, `delivery: { merge_pr: "pending" }` |
| Comando de entrega corriendo / terminado | `delivery.merge_pr`: `"running"`, luego `"merged"` o `"failed"`; `stamp` con el SHA del sello si la compuerta lo produce (si no, `null`) |
| Cola de merge | `delivery.merge_queue` (ver abajo) |
| Deploy pendiente o hecho | `delivery.deploy_pending: true` mientras falte publicar; `false` cuando el comando de publicación termina bien. Si el build llega a producción, además `delivery.deploy` (ver abajo) |
| Reestimación | `estimate` completo con `reason` (motivo corto, máximo 120); `stage` y `status` los vigentes |
| Espera de cualquier tipo | `waiting` (ver abajo), junto con `waiting_approval` o `blocked` |
| Bloqueo fuera de un gate | `status: "blocked"`, un `summary` con el motivo (un momento humano, un Critical/High tras el tope de revisión, un guardarraíl) y `waiting` |
| Vuelta a `running` | `waiting: null` |
| Fin (etapa 8) | `stage: 7`, `status: "done"`, `outcome`, el `summary` final (estilo brief) y `retro`. Si el build paró antes, `stage` es la etapa donde terminó y `retro` va igual si hay qué contar |

Notas:
- En `main directo` no hay PR: `pr` queda fuera y `merge_pr` sigue el push a main por la compuerta.
- `pr` es siempre el PR final de `build/<slug>`. El estimado cuenta una sola ventana de integración, CI y merge.
- Con `--chico` no hay etapa 2: se pasa de la 1 a la 3. Con `--fix` no hay etapa 3: se pasa de la 2 a la 4 (Síntoma, Causa, Arreglo, Verificar, Revisar, Entregar), y el único `waiting_approval` es el del diagnóstico al cerrar la etapa 2, con su `gate: { stage: 2, … }`. El `estimate` va en ese mismo `waiting_approval`.
- Aprobación conjunta (por defecto, Evidencia y Plan juntos): al pasar de la etapa 2 a la 3 no hay `waiting_approval`; al recibir la aprobación van dos `gate` con el mismo `approved_at`, primero el de la etapa 2 y luego el de la 3. Con `--pausas` o la pausa automática, la etapa 2 tiene su propio `waiting_approval` y su `gate`.
- Volver a una etapa (por ejemplo, de Revisar a Implementar) es otra entrada: se reporta igual.
- `links` es opcional: hasta 10 `{ label, href }` hacia reportes del plan, con ruta relativa (sin `/` inicial) o URL `https:`.

## `waiting`
Cada vez que el build espera algo, manda `waiting` junto con el estado:
```json
{ "waiting": { "on": "you", "who": "<persona, terminal, PR o servicio>", "what": "Aprobar el plan", "next": "Al aprobar, arranca la etapa 4", "href": "https://…" } }
```
- `waiting_approval` → siempre `on: "you"`. `blocked` → `on` según a quién o qué se espera: `you` (decisión o guardarraíl), `terminal` (otra sesión), `pr`, `ci`, `external` o `error` (solo una falla real).
- Al volver a `running` manda `waiting: null`. Al cerrar con `done` el servidor lo borra.
- Límites: `on` obligatorio; `who` máximo 120; `what` y `next` máximo 160; `href` máximo 300, solo `https:` o ruta relativa. Sin secretos.
- Un plugin que no conoce el campo lo rechaza: repite la llamada sin él y no lo vuelvas a mandar en ese build.

## `flow`
`"full" | "chico" | "fix"`, se manda en el arranque (`full` si no hay flag). `stage` sigue siendo 1 a 7; el flujo dice qué etapas existen y cómo se llaman:
| stage | full | chico | fix |
|---|---|---|---|
| 1 | Frame | Frame | Síntoma |
| 2 | Evidencia | — | Causa |
| 3 | Plan | Plan | — |
| 4 | Implementar | Implementar | Arreglo |
| 5 | Verificar | Verificar | Verificar |
| 6 | Revisar | Revisar | Revisar |
| 7 | Entregar | Entregar | Entregar |

## `stage_detail`
Solo el coordinador. Al **cerrar cada etapa** manda la evidencia de esa etapa; reemplaza los `items` anteriores de la misma:
```json
{ "stage_detail": { "stage": 5,
  "items": [ { "label": "CI", "value": "verde · 6 min", "href": "https://…/actions/runs/1" },
             { "label": "Evidencia", "value": "reporte de verificación", "href": "plans/…/reports/verify.md" } ] } }
```
- `stage` es la etapa que se cierra. Hasta 8 `items`; `label` máximo 80, `value` máximo 160, `href` opcional (`https:` o ruta relativa, máximo 300).
- Cada `value` se entiende solo, sin abrir el enlace: el resultado y sus cifras clave («verde · 3626 pruebas · 6 min», «causa: el poll pisa el estado en server/x.js:42», «2 High arreglados, 0 abiertos»). Nunca solo «ver reporte»: el `href` es para quien quiera más. Los `items` hablan del build y sus objetivos, no del paso en abstracto: en Verificar, qué criterios de aceptación pasan o fallan (`c1 pasa · …`); en Arreglo o Implementar, qué cambió para el Goal o el síntoma; en Plan, los carriles y el estimado; en Revisar, los hallazgos abiertos y cerrados. Cuando el item es un criterio, el `label` es el criterio con su estado al inicio (`✓ c1 …`, `◷ c2 …`, `✗ c3 …`) y el `value`, su resultado.
- Qué va como item: el reporte de la etapa, el PR, la corrida de CI, una captura o el archivo:línea de la causa. Cada uno con su enlace si lo tiene.
- Sin secretos, con la misma disciplina que el `summary`.

### `live` (esperas largas)
Dentro de `stage_detail`, mientras el build espera la CI, la cola de merge, el e2e o el deploy:
```json
{ "stage_detail": { "stage": 5, "live": { "label": "gate corriendo", "done": 2, "total": 3, "at": "<salida de date -u>" } } }
```
- `label` dice qué pasa ahora; `done` y `total` son enteros opcionales; `at` sale de `date -u`.
- Se actualiza **cuando cambia de fase** y nunca más de una vez por minuto; no es un latido. Al terminar la espera, o al cerrar la etapa, manda `live: null`.

## `delivery.merge_queue` y `delivery.deploy`
- `delivery.merge_queue`: `{ "position": 2, "total": 3, "since": "<iso>", "reason": "…" }`. Se lee de `--status` del comando de cola de merge del repo, si lo tiene; sin él, no se manda. `since` es la entrada a la fila; `reason` (máximo 120) solo si el PR salió de la cola; `position` y `total` pueden ir `null` si solo hay `reason`. Se actualiza cuando cambia la posición, con el tope de una vez por minuto, y cuando el PR sale de la fila se manda con el `merge_pr` final.
- `delivery.deploy`: solo si el build llega a producción. `{ "state": "approval|publishing|verified|failed", "at": "<iso>" }`: `approval` mientras espera la aprobación de la persona, `publishing` al correr el comando de publicación, `verified` cuando la verificación posterior pasa y `failed` si algo falla. Convive con `deploy_pending`.

## `retro`
Solo con `status: "done"`; sale de `retro.yaml` (`cierre-y-retro.md`):
```json
{ "retro": { "kind": "ui | backend | infra | docs | mixed",
  "entregado": ["…"], "pendientes": ["…"],
  "bien": ["…"], "mal": ["…"], "batallo": ["…"],
  "propuestas": [{ "text": "…", "applies_to": "build-auto | repo | plan" }] } }
```
- Hasta 5 elementos por lista y 4 propuestas; cada texto, máximo 160, con la redacción de `cierre-y-retro.md`. Sin secretos ni datos de clientes.
- `entregado` y `pendientes` necesitan sielay-link ≥ 1.7.2. Si el plugin rechaza la llamada por esos campos, repítela sin ellos y pon lo mismo en el `summary` final como dos bloques de líneas `- ` bajo los encabezados `Entregado:` y `Pendiente:`.
- El `summary` final va en 1 a 3 frases cortas o en líneas que empiezan con `- ` (el visor respeta los saltos de línea y las pinta como lista).
- `applies_to` dice dónde cae la propuesta: `build-auto` (la skill), `repo` (el repo) o `plan` (cómo planear este tipo de cambio). Las de `build-auto` y `plan` se aplican por defecto en el siguiente Frame.

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
- **Reestima** cuando el total previsto se mueve más que ±max(0,5 h, 10 % del programado), o al cerrar un carril que se pasó de lo estimado. Siempre con `reason`.
- Una reestimación es un dato, no una enmienda: no pide aprobación. Solo la pide si el motivo cambia el Goal, los criterios, los no-goals o la autoridad, y entonces es una enmienda normal.

## `outcome`
- `delivered`: se llegó al alcance acordado (merge, o merge y publicación con `produccion`).
- `stopped`: se detuvo a propósito antes del alcance: lo paró el usuario, quedó un Critical/High tras el tope, un guardarraíl o falta autoridad.
- `failed`: algo falló y no se pudo entregar (compuerta en rojo sin arreglo dentro del plan, entrega o publicación fallida).

Después de `done` el build queda cerrado: no vuelvas a reportar con ese `build_id`.

## `summary`
Al cerrar cada etapa (en las de aprobación, al pedirla), de 1 a 3 frases sobre qué se hizo y cómo, en el idioma del usuario y en máximo 600 caracteres. Es el único texto narrativo que escribes; el resto de los campos son datos del repo y del plan. Nunca secretos, tokens, URLs con credenciales ni datos personales o de clientes.
