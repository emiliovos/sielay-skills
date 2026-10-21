# sielay-link

Conecta sesiones de Claude Code a través de un hub de [sielay](https://sielay.cloud). Una sesión le escribe a otra con `link_send`. El mensaje llega a la otra terminal con un encabezado verificado por el hub. Lo que pase después lo deciden el hub y la persona que está en esa terminal.

**Es opcional y va aparte del plugin `si`.** Trae un módulo de hooks, un ejecutable pequeño de Node y tráfico de red. Todo eso está acotado por `tools/check-sielay-link.sh` (ver «Seguridad»).

## Instalar

```
claude plugin marketplace add emiliovos/sielay-skills && claude plugin install sielay-link@sielay
```

La entrada del marketplace va fijada al tag `sielay-link-v1.1.1`. Solo cambia por un PR revisado.

**Requisitos:**
- **Claude Code 2.1.300.** La API de módulos es de acceso anticipado y cambia entre versiones. Antes de actualizar Claude Code, corre el smoke de abajo.
- **Node 20 o más reciente** en el `PATH`, para el adaptador `socket` (probado con v20 y v22; el escritor solo usa `node:net`). El plugin solo revisa que `node --version` corra: sin Node, los mensajes entran como prompt (modo de respaldo) y el plugin lo avisa.
- **Linux o macOS** para el adaptador `socket`. En Windows no hay socket unix: se usa el modo `prompt`.

## Emparejar esta máquina

1. Un admin crea un **slot** en el dashboard (`/admin/link`). El slot fija la persona y la máquina, por ejemplo `ana-laptop`.
2. En la sesión: `/link pair <slot>`. El panel muestra un código.
3. El admin aprueba ese código en el dashboard, con 2FA.
4. El plugin guarda el token en `~/.claude/sielay-link/token`, con permisos 0600, dentro de una carpeta 0700. El token viaja por stdin, nunca en la línea de comandos.
   - Si el archivo se escribió, el panel dice «Emparejado» y el token ya no se muestra.
   - Si no se pudo escribir, el token queda en pantalla 5 minutos para que lo copies y lo pegues en `/plugin` → sielay-link → `link_token`. Después se oculta.
   - Si `link_token` tiene un valor, gana sobre el archivo.

El token nunca se guarda en `$.store` ni en un campo de configuración en claro. Solo pasa por el estado de la sesión mientras se escribe el archivo, o durante esos 5 minutos si falla, porque ese estado lo puede leer cualquier plugin.

## Nombre de la sesión

Tu dirección es `persona/máquina/sesión`. La persona y la máquina las fija el slot. El nombre de la sesión sale de la primera fuente que exista:

1. la variable `SIELAY_LINK_NAME`;
2. `/link name <nombre>`, guardado para esta carpeta;
3. `.claude/sielay-link.json` del proyecto: `{"name": "api", "project": "Mi proyecto"}`;
4. el nombre de la sesión de tmux;
5. el nombre que le diste con `/rename`. Llega con el siguiente prompt, no al instante;
6. el nombre de la carpeta.

Si otra carpeta ya usa ese nombre y está en línea, el hub te asigna `nombre-2`.

**La misma sesión sigue siendo la misma.** El plugin guarda en `$.store` la identidad de la instancia, por carpeta y nombre.

- Si recargas el plugin, haces `/clear`, usas `--resume` o reinicias en la misma carpeta, el hub te ve como la misma instancia y no pasas a `nombre-2`.
- Dos terminales abiertas a la vez en la misma carpeta y con el mismo nombre sí son instancias distintas. La segunda recibe `nombre-2`.

## Comandos y herramientas

| | Qué hace |
|---|---|
| `/link` | Estado: hub, dirección, modo y si está fresco, adaptador y mensajes en franja. Abre el panel |
| `/link name <x>` | Fija el nombre de la sesión para esta carpeta |
| `/link off` / `on` | Apaga o enciende la recepción en esta sesión. `SIELAY_LINK_OFF=1 claude` lo apaga del todo, sin herramientas |
| `/link peers` | Sesiones con las que puedes hablar (solo pares) |
| `/link pair <slot>` | Empareja la máquina |
| `/link show <id>` | Abre en el panel el mensaje completo de la franja con ese id |
| `/link accept <id>` / `reject <id>` | Acepta o rechaza ese mensaje. Solo cuenta si lo tecleas tú en el prompt |
| `link_send`, `link_reply`, `link_peers` | Las herramientas del modelo para hablar con otras sesiones. **No existe ninguna para aceptar, rechazar ni liberar** |
| `link_build_stage` | Le dice al hub en qué va el build de `/si:build-auto` de esta sesión. Solo informa: no controla nada (ver «Reporte del build») |

Para que el modelo las use sin preguntarte cada vez, agrégalas a `permissions.allow` en `~/.claude/settings.json`:

```json
{ "permissions": { "allow": ["mcp__sielay-link__link_send", "mcp__sielay-link__link_reply", "mcp__sielay-link__link_peers", "mcp__sielay-link__link_build_stage"] } }
```

## Cuándo se ejecuta solo un mensaje

Un mensaje entra a tu sesión sin preguntar solo si se cumple todo esto:

- el par tiene auto-ejecución, y un admin la encendió con 2FA;
- el remitente estaba en `bypassPermissions` al enviar;
- tu sesión está en `bypassPermissions` y esa lectura está **fresca** al momento de entregar.

Cualquier otro mensaje va a la **franja** de arriba del prompt. La franja muestra «link: N en franja», el id corto del mensaje más antiguo (8 caracteres), quién lo manda y su primera línea. Abajo están **[Ver completo]**, **[Aceptar `id`]** y **[Rechazar]**.

- **Lee antes de aceptar.** «Ver completo» o `/link show <id>` abre el mensaje entero en el panel. Ahí también puedes aceptarlo o rechazarlo.
- **Los botones no tienen tecla.** Un número tecleado en el prompt nunca acepta nada. Para usarlos, enfoca la franja con ctrl+x tab, muévete con las flechas y pulsa Enter, o haz clic.
- **Para teclearlo:** `/link accept <id>` o `/link reject <id>`, con el id que muestra la franja. El comando solo cuenta si lo tecleas tú; si lo lanza otro plugin o el modelo, se rechaza.
- **Siempre actúa sobre el id que ves.** La franja respeta el orden de llegada, así que un mensaje nuevo no reemplaza al que tienes en pantalla.
- **Aceptar es tu confirmación:** el mensaje se entrega sea cual sea tu modo.
  - Si la entrega falla después de aceptar, el plugin la reintenta en cada poll, también si se recarga.
  - Mientras no reciba el ack `injected`, el hub vuelve a entregar el mensaje marcado como `accepted`. El plugin lo entrega tal cual, sin pasar por la franja ni mirar el modo, porque ya lo aceptaste; el dedupe por id evita que corra dos veces.
- **Liberar no ejecuta:** «Liberar» desde el dashboard solo manda el mensaje a tu franja.

**Frescura del modo.** Claude Code solo informa el modo de permisos en los hooks de un turno: al enviar un prompt, al usar una herramienta y al terminar. Con la sesión en idle no hay lectura en vivo: un shift+tab no avisa a nadie. La regla vigente (`IDLE_POLICY` en `mod/link-mode-freshness.js`) es «último modo visto»:

- si al terminar el último turno la sesión estaba en bypass, sigue contando como bypass fresco hasta **12 h** en idle;
- pasado ese tiempo, o con otro modo, el mensaje va a la franja.

El fin de turno se toma de `turn.complete`, que también llega cuando interrumpes con Esc o cuando un error de API corta el turno; `classic.Stop` no llega en esos casos. El tope de 12 h vale en todos los casos: una lectura más vieja nunca cuenta como fresca, aunque el turno parezca seguir abierto.

El hub recibe en cada poll el modo, si está fresco y su antigüedad (`mode_age_s`), para mostrarlo en el dashboard. Al arrancar, el modo es desconocido hasta el primer prompt.

**Organizaciones.** Donde una organización gestiona Claude Code, los hooks `classic.*` de un plugin instalado por la persona no corren. Ahí el modo queda desconocido y no hay auto-ejecución: todo va a la franja.

## Cómo entra un mensaje

El cuerpo se normaliza antes de entrar y antes de mostrarse:

- se quitan las secuencias de terminal (ANSI y OSC), los caracteres de control y los invisibles o bidi;
- se aplica NFKC;
- se rompe cualquier etiqueta `<…` y cualquier `[sielay…`, para que un cuerpo no pueda falsificar el encabezado ni una etiqueta del sistema.

El encabezado es:

```
[sielay-link de=ana/laptop/api conv=<id> turno=3/10 verificado-por-hub — responde con link_reply]

<texto>
```

- **Adaptador `socket`, el de por omisión.** El plugin corre `bin/sielay-link-socket-write.mjs` con Node. Ese proceso escribe en el socket de mensajes de la sesión (`CLAUDE_CODE_MESSAGING_SOCKET`).
  - Claude Code lo presenta como un mensaje de otra sesión, verificado.
  - A media tarea entra en el siguiente límite de herramienta. Con la sesión en idle abre un turno.
  - El ack `injected` significa «escrito en el socket».
- **`crossSessionInbound`** (en `/config`: «Messages from your other sessions»). En `hold` o `refuse`, Claude Code retiene o descarta los mensajes de otras sesiones. Déjalo sin valor o en `accept`; si no, usa el modo `prompt`, sin Node.
- **Adaptador `prompt`, el de respaldo.** Usa `$.prompt.submit`, nunca como si lo escribieras tú. El plugin agrega un contexto fijo que dice que el texto viene de otra sesión.

## Reporte del build

Desde la 1.1.0, `/si:build-auto` llama a `link_build_stage` en cada cambio de etapa, de estado o de entrega. El plugin guarda el build en el estado de la sesión y lo manda como `session.build` en cada poll, así que el hub lo ve en 25 s o menos. El visor de builds de sielay lo muestra.

- **Solo informa.** La herramienta no aprueba etapas, no mergea y no dispara nada. Si la sesión no está emparejada o sielay-link está apagado, guarda el build igual y responde `{ "ok": true, "reported": false }`.
- **Qué pone el plugin:**
  - **`started_at`**, al declarar el build. **`stage_since`**, al cambiar de etapa, si la skill no la manda.
  - **Los subagentes vivos.** El alta llega con `SubagentStart`, que trae el tipo, y la descripción con el resultado de `agent.spawn`; los dos se emparejan por el id del agente. La baja llega con `SubagentStop` o con el `turn.complete` del subagente. Un subagente sin señal durante 30 min sale de la lista.
  - **`subagents_peak`**, el pico de subagentes vivos a la vez.
  - **`usage`**, la suma de `turn.complete.usage` de todos los turnos de la sesión (hilo principal y subagentes) mientras hay un build. Un turno sin `usage` (por Esc o un error de API) no suma nada. Si nunca hubo uso, va `null`, no cero. `model` es el del último turno del hilo principal y nunca se inventa.
  - **`usage.active_ms`** (desde la 1.1.1), la suma de `turn.complete.durationMs` de esos mismos turnos, también los que se cortan con Esc. Es el tiempo activo de la sesión, y el hub lo usa para las horas a mano cuando no ve el estado «trabajando» (por ejemplo, si otro plugin no le pasa a este los hooks clásicos). Un turno sin `durationMs` no suma. No cambia cómo se calcula el estado idle/working de la sesión, que sigue gobernando la auto-ejecución. Un hub anterior ignora el campo.
- **Validación antes de mandar.** El plugin aplica las mismas reglas y topes que el hub: campos obligatorios, etapa de 1 a 7, fechas que no vayan más de 5 min en el futuro, textos con los secretos quitados antes de recortarlos y 8 KB como máximo. Los links solo pueden ser rutas relativas o `https:`; los demás se descartan. Si el build no es válido, no se manda y el log dice qué campo falló, sin su contenido. Si es demasiado grande, primero se quitan las descripciones de los subagentes y luego los más viejos.
- **Ciclo de vida.**
  - `/clear` conserva el build.
  - Un `build_id` nuevo empieza otro build.
  - Después de mandar `done`, el plugin borra su build, porque en el hub un build cerrado no se puede cambiar. Una segunda corrida sobre el mismo plan usa un `build_id` con sufijo `-r2`.
- **En la franja** aparece una línea `build: etapa N/7 · nombre` mientras hay un build.

## Seguridad

- **Lista permitida del hub:** `hub_url` solo acepta `https://sielay.cloud` o `https://sielay.vostec.mx`.
  - Cualquier otro valor se rechaza al cargar.
  - Las redirecciones las sigue Claude Code, no el plugin. Entre orígenes distintos quita todas las cabeceras salvo accept y content-type, así que el token no sale de esos orígenes.
- **Red y procesos acotados:** solo `mod/link-hub-client.js` hace peticiones de red, y solo `mod/link-delivery-adapter.js` corre procesos del sistema: Node para el socket, `sh` para el archivo del token, y `tmux` y `hostname` para el nombre.
- **El CI lo revisa en cada PR.** `tools/check-sielay-link.sh` exige todo lo anterior y además prohíbe:
  - `asUser`, `eval` y URL fuera de la lista;
  - tokens escritos en el código;
  - que el token se guarde en `$.store`.

  Es defensa en profundidad, no una prueba. Las reglas de texto se pueden esquivar con código escrito a propósito. Por eso el CI también usa la lista de llamadas a `$` que reporta el parser de Claude Code, y la compara con una lista permitida exacta.
- **Dueño:** CODEOWNERS nombra al dueño del plugin y de las piezas que lo protegen. La versión instalada solo cambia cuando la entrada del marketplace apunta a un tag nuevo.
- **Apagado de emergencia:** `SIELAY_LINK_OFF=1`. Para revocar una máquina, el admin lo hace en el dashboard.

## Desinstalar

```
claude plugin uninstall sielay-link@sielay && rm -rf ~/.claude/sielay-link
```

## Smoke antes de actualizar Claude Code

```
claude plugin validate --strict plugins/sielay-link && claude plugin test plugins/sielay-link
```
