# sielay-link

Conecta sesiones de Claude Code a través de un hub de [sielay](https://sielay.cloud). Una sesión le escribe a otra con `link_send`. El mensaje llega a la otra terminal con un encabezado verificado por el hub. Lo que pase después lo deciden el hub y la persona que está en esa terminal.

**Es opcional y va aparte del plugin `si`.** Trae un módulo de hooks, dos ejecutables pequeños (el escritor del socket y el helper del MCP) y tráfico de red. Todo eso está acotado por `tools/check-sielay-link.sh` (ver «Seguridad»).

## Instalar

```
claude plugin marketplace add emiliovos/sielay-skills && claude plugin install sielay-link@sielay
```

La entrada del marketplace va fijada al tag `sielay-link-v1.7.1`. Solo cambia por un PR revisado.

**Requisitos:**
- **Claude Code 2.1.300.** La API de módulos es de acceso anticipado y cambia entre versiones. Antes de actualizar Claude Code, corre el smoke de abajo.
- **Node 20 o más reciente** en el `PATH`, para el adaptador `socket` (probado con v20 y v22; el escritor solo usa `node:net`). El plugin solo revisa que `node --version` corra: sin Node, los mensajes entran como prompt (modo de respaldo) y el plugin lo avisa.
- **Linux o macOS** para el adaptador `socket`. En Windows no hay socket unix: se usa el modo `prompt`.

## Conectar esta máquina con `/up`

```
curl -fsSL https://sielay.cloud/up | bash
```

El script imprime una liga con un código. La abres con tu sesión de sielay, revisas la máquina y apruebas con un factor nuevo. Después escribe la credencial en `~/.claude/sielay-link/token` (0600), instala este plugin por https y dice con qué dirección quedó la máquina. Haz `/reload-plugins` en tus sesiones abiertas. Desde la 1.5.2, una sesión abierta antes del `/up` también toma sola el token nuevo: cuando el hub rechaza el viejo (401), vuelve a leer el archivo y sigue con el nuevo, salvo que haya un `link_token` en `/plugin`, que siempre gana. Si el archivo trae el mismo token, la sesión se detiene y dice que hagas `/reload-plugins` o que conectes la máquina con `/up`.

## El MCP de sielay (desde la 1.5.0)

El plugin trae el servidor MCP `sielay` (`.mcp.json`, `https://sielay.cloud/mcp`) sin un token fijo:
- Al conectar, Claude Code corre `bin/sielay-mcp-headers.sh`. Ese helper lee `~/.claude/sielay-link/token`, lo cambia en el hub por un token MCP nuevo (`POST /api/up/mcp-token`) y se lo da a Claude Code como cabecera `Authorization`.
- **El token MCP dura 24 h y no se guarda en disco.** Cada conexión pide uno nuevo. Claude Code no vuelve a correr el helper ante un 401, así que una sesión de más de 24 h pierde el MCP hasta reconectarlo con `/mcp` o abrir otra sesión.
- **Actúa como miembro.** Un admin solo tiene herramientas de admin si aprobó la máquina con «MCP admin» y sigue siendo admin.
- Revocar la máquina en sielay corta su MCP en la siguiente llamada.
- **Solo máquinas conectadas con `/up`.** Un token de link anterior no da MCP: el hub responde `mcp_not_enabled` hasta que la máquina pase otra vez por `/up`.
- **Con Node 18 o más reciente** el helper corre `bin/sielay-mcp-headers.mjs`. **Sin Node**, que es lo normal con Claude Code nativo, hace lo mismo en `sh` con `curl`. La credencial le llega a `curl` por stdin, nunca en argv.
- **Falla cerrado:** sin el archivo, o ante una respuesta que no es un token, sale con error y un mensaje sin secretos.
- El helper solo lee el archivo. Si guardaste un `link_token` en `/plugin`, el MCP no lo ve: quítalo de ahí.
- Si tenías un MCP `sielay` propio con token fijo (`claude mcp list`), quítalo con `claude mcp remove sielay`.

## Emparejar esta máquina con un slot (sin `/up`)

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
5. el nombre que le diste con `/rename`, si ya estaba al arrancar (ver abajo);
6. el nombre de la carpeta.

Si otra carpeta ya usa ese nombre y está en línea, el hub te asigna `nombre-2`.

**La identidad se fija al arrancar** (desde la 1.4.0). El plugin resuelve el nombre y la carpeta en el primer poll y los conserva toda la sesión. Un `/cd`, un cambio de worktree o un título de `/rename` que llega después no los cambian, así que el hub sigue viendo la misma fila y no aparece `nombre-2`. Dentro de tmux, si el nombre de tmux todavía no se pudo leer, no se fija nada hasta leerlo. Para cambiar el nombre a media sesión usa `/link name <nombre>`: se toma en el siguiente poll, junto con la carpeta en la que estás entonces. Lo demás cuenta al reiniciar.

**«Carpeta» es la raíz del proyecto de la sesión:** donde arrancó Claude Code (o adonde la llevó `/cd` o un worktree antes del primer poll, o antes de un `/link name`). Un `cd` en la terminal no la cambia, así que una sesión que trabaja dentro de la carpeta de otro proyecto sigue siendo ella misma y nunca toma la sesión de la terminal de ese proyecto. Con un Claude Code sin `$.session.root()` se usa la carpeta actual.

**La misma sesión sigue siendo la misma.** El plugin guarda en `$.store` la identidad de la instancia, por carpeta y nombre.

- Si recargas el plugin, haces `/clear`, usas `--resume` o reinicias en la misma carpeta, el hub te ve como la misma instancia y no pasas a `nombre-2`.
- Un reinicio rápido también (desde la 1.4.0): el archivo del socket de Claude Code sobrevive al proceso, así que el plugin revisa que el PID de su nombre siga vivo (`/proc/<pid>`) antes de dar por ocupada la identidad. Sin `/proc` (macOS) solo cuenta que el archivo exista, y el reinicio rápido recupera su identidad a los 90 s.
- Dos terminales abiertas a la vez en la misma carpeta y con el mismo nombre sí son instancias distintas. La segunda recibe `nombre-2`.

## Comandos y herramientas

| | Qué hace |
|---|---|
| `/link` | Estado: hub, dirección, modo y si está fresco, adaptador y mensajes en franja. Abre el panel |
| `/link name <x>` | Fija el nombre de la sesión para esta carpeta |
| `/link off` / `on` | Apaga o enciende la recepción en esta sesión. `SIELAY_LINK_OFF=1 claude` lo apaga del todo, sin herramientas |
| `SIELAY_LINK_MINIMAL=1` | Modo mínimo: solo `link_send`, `link_reply` y `link_peers`, sin la línea de descubrimiento (ver «Novedades de la 1.9.0») |
| `/link peers` | Tu dirección y las sesiones con las que puedes hablar (solo pares) |
| `/link pair <slot>` | Empareja la máquina |
| `/link show <id>` | Abre en el panel el mensaje completo de la franja con ese id |
| `/link accept <id>` / `reject <id>` | Acepta o rechaza ese mensaje. Solo cuenta si lo tecleas tú en el prompt |
| `link_send`, `link_reply`, `link_peers` | Las herramientas del modelo para hablar con otras sesiones. **No existe ninguna para aceptar, rechazar ni liberar** |
| `link_build_stage` | Le dice al hub en qué va el build de `/si:build-auto` de esta sesión. Solo informa: no controla nada (ver «Reporte del build») |

Si el hub tiene apagado sielay-link para esa conversación (409 `link_paused`), `link_send` y `link_reply` dicen qué está apagado: una de las personas, la línea entre las dos máquinas, una de las máquinas o una de las terminales, y que un admin lo prende desde `/admin/link` o `/conexiones` (desde la 1.4.0). No hay que reintentar.

`link_peers` devuelve `{ "tu_direccion": …, "peers": [ … ] }`. `tu_direccion` sale de la dirección que el hub asignó en el último poll; si todavía no hay poll, del prefijo `persona/máquina` que manda el hub (`self.address_prefix`) más el nombre de la sesión; si el hub es anterior y no lo manda, va `null`. `peers` no cambia.

Para que el modelo las use sin preguntarte cada vez, agrégalas a `permissions.allow` en `~/.claude/settings.json`:

```json
{ "permissions": { "allow": ["mcp__sielay-link__link_send", "mcp__sielay-link__link_reply", "mcp__sielay-link__link_peers", "mcp__sielay-link__link_build_stage", "mcp__sielay-link__link_watch"] } }
```

## Novedades de la 1.9.1

- **El modo sobrevive a un /clear:** antes, una sesión en bypass recién limpiada con `/clear` y ociosa reportaba `unknown` hasta su primer prompt, y un mensaje de un par con auto-ejecución caía en la franja. Al hacer `/clear` el host empieza una sesión nueva con el estado vacío y no vuelve a correr `session.start`, así que la muestra de arranque no se repetía. Ahora el plugin guarda en memoria la última muestra de modo al cerrar con `/clear` y la pone en la conversación nueva si esta no tiene una propia, marcada como ociosa.
- **Lo que no cambia:** se lleva la última muestra vista, no una lectura nueva: un shift+tab visto antes del `/clear` sigue ganando, la muestra conserva su edad (el tope de 12 h cuenta desde que se vio) y un modo distinto de bypass sigue sin auto-ejecutar. Salir, `/resume` o reiniciar no llevan nada.

## Novedades de la 1.9.0

- **Modo mínimo:** con `SIELAY_LINK_MINIMAL=1` la sesión solo registra `link_send`, `link_reply` y `link_peers`, y nunca recibe la línea «[sielay-link] Esta sesión está conectada…». Quedan fuera `link_build_stage` y `link_watch`, que son unas tres cuartas partes de los esquemas que el modelo carga en cada request. Sirve para un equipo que no usa `/si:build-auto` y solo quiere mensajes entre máquinas. Recibir no cambia: el poll sigue en el proceso del plugin, sin tokens, y un mensaje que llega despierta al modelo como siempre. Los avisos del hub tampoco cambian.
- **Cómo activarlo:** para un proyecto, en su `.claude/settings.json`: `{ "env": { "SIELAY_LINK_MINIMAL": "1" } }`. Para toda la máquina, la misma línea en `~/.claude/settings.json`. Para una sola sesión: `SIELAY_LINK_MINIMAL=1 claude`. Toma efecto en la siguiente sesión que abras.
- **El MCP `sielay` va aparte:** el plugin también trae el servidor MCP `sielay` (archivos, COMMS y herramientas de admin). La variable no lo toca. Si no lo usas, apágalo una vez en `/mcp` (elige `sielay` → Disable).
- Sin la variable todo sigue igual que en la 1.8.2.

## Novedades de la 1.8.2

- **`flow` en `link_build_stage`:** `full` (por omisión), `chico` o `fix`, solo el coordinador; dice qué etapas tiene el build. Un valor desconocido rechaza la llamada con el campo `flow`.
- **`stage_detail`:** el detalle de una etapa (`stage` 1..7, hasta 8 `items` con `label`, `value` y `href`, y `live` con lo que pasa ahora). El último enviado reemplaza al anterior; `live: null` lo borra en el hub.
- **`delivery.merge_queue` y `delivery.deploy`:** la fila de merge (`position`, `total`, `reason`, `since`) y el estado del deploy (`approval`, `publishing`, `verified` o `failed`, con `at`). Un subcampo inválido descarta ese objeto, no el build.
- **Sin los campos nuevos todo sigue igual.**
- **Una línea por mensaje:** las tres filas (mensaje entrante, llamada de `link_send` / `link_reply` y su resultado) salen ahora en gris tenue, sin colores ni negritas, y en una sola línea recortada con «…» al ancho de la terminal (máximo 80 columnas). Entrante: «◇ sielay-5 · turno 3 · Recibido, voy con la A: POST …». Llamada: «◇ → sielay-2 · Turno #507, CI verde en …». Resultado: la primera línea, «Enviado a sielay-2 · turno 1 de 120 · corre solo». El cuerpo va siempre después del prefijo «◇ …», con los saltos de línea y los espacios colapsados.
- **La persona solo cuando es otra:** el remitente o el destino se muestra como «ana/sielay-5» cuando su persona no es la de esta sesión, y como «sielay-5» cuando sí. Mientras no se conozca la dirección propia, la persona se muestra siempre. Así una sesión de otra persona con el mismo nombre no se ve igual que una propia.
- **Avisos del hub:** salen igual, en una línea tenue «◇ aviso del hub · La sesión … lleva 24 min sin leer tu mensaje …».
- **Con ctrl+o** se ve lo completo como en la 1.8.0: el encabezado del mensaje con su cuerpo entero, la llamada con todo el texto y el resultado completo. Lo que lee el modelo no cambia.

## Novedades de la 1.8.0

- **Mensajes legibles en la conversación:** lo que ves de `link_send` y `link_reply` ya no es el JSON de la llamada. La llamada sale como «● link_send → emilio/sielay-2 · vps-sielay» con el texto detrás de una barra atenuada («│ ») y ajustado al ancho de la terminal (máximo 80 columnas), recortado a 3 líneas con «N líneas más · ctrl+o para ver todo». El mensaje que entra de otra sesión sale como «◆ emilio/sielay-3 · vps-sielay · sielay · turno 3/120», el cuerpo detrás de la barra y «↩ link_reply · conv 1a2b3c4d…». Si el renglón no cabe, se recorta el proyecto y luego la máquina, nunca la persona. El plugin tolera lo que el motor agrega alrededor del mensaje (saltos CRLF, su párrafo «This came from another Claude session»). Solo cambia lo que ves tú: el texto que lee el modelo (el encabezado con `conv=`) sigue igual. Con ctrl+o ves el texto completo.
- **Respuestas cortas de las herramientas:** `link_send` y `link_reply` contestan en texto, por ejemplo `Enviado a emilio/vps-sielay/sielay-2 · turno 1 de 120 · corre solo` y en la línea siguiente `conv=<id completo>`; las variantes son «En la franja de …» y «Retenido para …»; con una señal de entrega desconocida solo dice «Enviado a …» y no afirma nada de la franja. Con varios destinatarios va una línea por destino, con su `conv=`. `link_peers`, `link_watch` y `link_build_stage` siguen en JSON.
- **Conversación ya cerrada:** ahora dice «Ya cerrada por <persona>/<sesión> · no hace falta responder» y «para seguir, abre otra con link_send». Sigue siendo un resultado, no un error.
- **Varios builds a la vez:** el plugin guarda todos los builds declarados que no han terminado. `session.build` sigue siendo el más reciente y los demás (máximo 12, los más recientes) viajan en `session.open_builds`, una lista de `build_id`, para que un hub nuevo no los dé por terminados cuando otro build toma el relevo. Un build declarado `done` sale de la lista después de enviarse una vez, y uno sin reporte en 24 h también. Un hub anterior ignora el campo. Decisiones aceptadas: de cada build abierto solo se guarda el id y el momento de su último reporte; un build cerrado en el hub sigue vivo en el plugin hasta 24 h; con el build actual ya enviado como `done` cada poll lleva `build: null`; el ancho de caracteres CJK se cuenta por carácter; y un cuerpo largo queda bajo «N líneas más».

### Detalle técnico: cómo se dibujan las filas

Se usan los `ui.render` de `ToolUse`, `ToolResult` y `UserMessage`. Un árbol devuelto por el hook de `ToolUse` es todo lo que se dibuja de esa fila: así lo describen los tipos del motor («una fila compacta propia se deja pasar con `isExpanded`») y lo confirma la prueba de motor con `mount`, donde el árbol del plugin es lo único que aparece. Lo que esa prueba no puede mostrar es la terminal real: falta ver una vez que la línea `sielay-link - link_send (MCP)(…)` no queda encima. Con `isExpanded` (ctrl+o) el plugin dibuja el texto completo. Si una fila no se puede leer (otra herramienta, un mensaje que no trae el encabezado de sielay-link), el hook la devuelve al motor con `next(e)`. Las funciones de texto (`mod/link-render-text.js` y `mod/link-render-compact.js`) son puras y reciben el ancho; el árbol se arma en `mod/link-render-rows.jsx`.

## Novedades de la 1.7.2

- **Qué se entregó y qué quedó:** `retro` de `link_build_stage` acepta `entregado` y `pendientes`, listas de hasta 5 textos de 160 como `bien`, `mal` y `batallo`. Un hub que todavía no los conoce los ignora.

## Novedades de la 1.7.1

- **`link_watch` responde:** la 1.7.0 la registraba sin el hook que la atiende y cada llamada fallaba con «no tool.call hook answered». Ahora cada herramienta registrada tiene su hook.

## Novedades de la 1.7.0

- **Encabezado legible:** la tarjeta de arriba reemplaza el renglón `[sielay-link de=…]`.
- **Conversación ya cerrada:** responder en una conversación que la otra sesión cerró ya no sale como error. La herramienta contestaba que la conversación ya terminó y que no hacía falta responder (desde la 1.8.0, con el texto más corto de arriba).
- **Varios destinatarios:** `link_send` acepta `to` como lista de hasta 10 direcciones (sin `conversation`); abre una conversación con cada una y responde un resultado con su nota por destino.
- **Solo sesiones en línea:** `link_peers` lista por defecto solo las sesiones en línea, de la más activa a la menos; `online_only: false` trae también las desconectadas.
- **Avisos del hub:** el poll trae `notices` y el plugin los muestra como «Aviso del hub de sielay» (no es una persona ni otra sesión): empezó o terminó el merge de un PR en el repo de la sesión, o terminó el CI de una rama vigilada. La sesión reporta su `repo` (el remoto `origin` de GitHub, leído de `.git/config` sin correr git) y su proyecto (el del archivo `.claude/sielay-link.json` o el nombre de la carpeta).
- **Adjuntos:** `link_send` y `link_reply` aceptan `attachment: { name, text }` de hasta 64 KB (p. ej. `resumen.json`); llega después del cuerpo, marcado como texto de la otra sesión y neutralizado igual que el cuerpo.
- **`link_watch`:** `{ branch, repo?, ttl_h?, off? }` pide el aviso de CI de una rama (24 h por omisión, hasta 72). Solo para admins.
- **Qué espera y cómo salió un build:** `link_build_stage` acepta `waiting` (`on`: you, terminal, pr, ci, external o error; `who`, `what`, `next` y `href`) y, solo con `status: done`, `retro` (`kind`, `bien`, `mal`, `batallo`, `propuestas` y, desde la 1.7.2, `entregado` y `pendientes`). `waiting` se borra solo al volver a `running` o al cerrar; `waiting: null` lo borra a mano.

## Cierre de la sesión (desde la 1.6.0)

Al cerrar Claude Code, la sesión avisa al hub (`POST /api/link/sessions/self/end`, con un tope de 3 s) y su fila se retira sola, así no se acumulan terminales muertas. Si todavía tiene mensajes en cola o una conversación abierta, el hub responde 409 `session_busy` y la fila queda como antes (se duerme a las 2 h y se purga a los 7 días). Un `/clear` o un `/resume` no la retiran. Si el hub no responde, el cierre sigue sin error.

## Descubrimiento

Desde la 1.2.0, una conversación nueva sabe sola su dirección y cómo escribirle a otra sesión. En el primer prompt de la conversación, el plugin agrega al contexto del modelo, sin mostrártelo, una sola línea:

```
[sielay-link] Esta sesión está conectada a sielay-link y su dirección es persona/máquina/sesión. Si te piden hablar con otra sesión de Claude Code (otra máquina u otra terminal), usa link_peers para ver a quién puedes escribir y link_send para escribirle.
```

- **Una vez por conversación.** Después de `/clear` se vuelve a agregar en el primer prompt.
- **Solo con token.** Sin token o con sielay-link apagado no se agrega nada y se intenta en el siguiente prompt; lo mismo si otro hook bloquea ese prompt.
- **La dirección, si ya se conoce.** Antes de que el hub conteste el primer poll, la línea va sin la dirección («Esta sesión está conectada a sielay-link. Si te piden…»). Si solo se conoce el prefijo (por un `link_peers` previo), dice «su dirección empieza con `persona/máquina/`».
- **No va en** los prompts del propio plugin (el modo `prompt` ya lleva su contexto fijo) ni en los comandos con `/`.
- La línea no lleva cuerpos de mensajes ni secretos, y el plugin no guarda nada nuevo para esto: la marca vive en memoria.

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

El hub recibe en cada poll el modo, si está fresco y su antigüedad (`mode_age_s`), para mostrarlo en el dashboard. Al arrancar (sesión nueva o `--resume`), y sin otra lectura todavía, el plugin toma el modo con que se lanzó Claude Code: `--dangerously-skip-permissions` o `--permission-mode <modo>`, leídos del proceso con `ps`; si no hay ninguno, `permissions.defaultMode` de los settings. La sesión cuenta como idle. Así, una terminal lanzada en bypass recibe en automático desde el primer poll, sin esperar a su primer prompt (desde la 1.5.1). Un `/reload-plugins` no pisa un modo ya visto.

**Organizaciones.** Donde una organización gestiona Claude Code, los hooks `classic.*` de un plugin instalado por la persona no corren. Ahí solo cuenta el modo de arranque: hasta 12 h en idle, como cualquier lectura, y sin ver un shift+tab posterior.

## Cómo entra un mensaje

El cuerpo se normaliza antes de entrar y antes de mostrarse:

- se quitan las secuencias de terminal (ANSI y OSC), los caracteres de control y los invisibles o bidi;
- se aplica NFKC;
- se rompe cualquier etiqueta `<…`, cualquier `[sielay…`, cualquier `[conv=` y cualquier renglón que empiece con un guion y `Mensaje de`, para que un cuerpo no pueda falsificar el encabezado ni una etiqueta del sistema.

El encabezado es una tarjeta alineada a la izquierda (desde la 1.7.0):

```
— Mensaje de ana desde laptop (sesión api, proyecto tablero360)
Otra sesión de Claude Code, no la persona. Verificado por el hub. Turno 3 de 10.
Responde con link_reply.
[conv=<id> · de=ana/laptop/api]

<texto>
```

Si la sesión que escribe está en la misma máquina, dice «desde esta máquina». El proyecto sale del `project_label` que el hub manda en `from.project`; con un hub que no lo manda, ese dato no aparece y la dirección queda en el último renglón.

- **Adaptador `socket`, el de por omisión.** El plugin corre `bin/sielay-link-socket-write.mjs` con Node. Ese proceso escribe en el socket de mensajes de la sesión (`CLAUDE_CODE_MESSAGING_SOCKET`).
  - Claude Code lo presenta como un mensaje de otra sesión, verificado.
  - A media tarea entra en el siguiente límite de herramienta. Con la sesión en idle abre un turno.
  - El ack `injected` significa «escrito en el socket».
- **`crossSessionInbound`** (en `/config`: «Messages from your other sessions»). En `hold` o `refuse`, Claude Code retiene o descarta los mensajes de otras sesiones. Déjalo sin valor o en `accept`; si no, usa el modo `prompt`, sin Node.
- **Adaptador `prompt`, el de respaldo.** Usa `$.prompt.submit`, nunca como si lo escribieras tú. El plugin agrega un contexto fijo que dice que el texto viene de otra sesión.

## Reporte del build

Desde la 1.1.0, `/si:build-auto` llama a `link_build_stage` en cada cambio de etapa, de estado o de entrega. El plugin guarda el build en el estado de la sesión y lo manda como `session.build` en cada poll, así que el hub lo ve en 25 s o menos. El visor de builds de sielay lo muestra.

- **Solo informa.** La herramienta no aprueba etapas, no mergea y no dispara nada. Guarda el build siempre, y responde `{ "ok": true, "reported": true }` o `{ "ok": true, "reported": false, "reason": "…" }`.
- **Qué significa `reported`** (desde la 1.4.0). `reported: true` dice que el hub acepta los polls de esta sesión, no que registró el build: el hub lo puede ignorar por su tope de builds, porque el build ya cerró o porque el visor está apagado. Sale del último poll:

  | Último poll | Respuesta |
  |---|---|
  | aceptado | `reported: true` |
  | todavía no hubo poll | `reported: false, reason: "pending"` |
  | la máquina llegó a su tope de 16 sesiones en línea | `reason: "too_many_sessions"` |
  | sielay-link apagado en el hub (503) | `reason: "paused"` |
  | token rechazado (401) | `reason: "unauthorized"` |
  | sin token | `reason: "unpaired"` |
  | apagado en esta sesión (`/link off` o `SIELAY_LINK_OFF=1`) | `reason: "off"` |
  | cualquier otro error (red, 5xx, límite de peticiones) | `reason: "unreachable"` |
- **Qué pone el plugin:**
  - **`started_at`**, al declarar el build. **`stage_since`**, al cambiar de etapa, si la skill no la manda.
  - **Los subagentes vivos.** El alta llega con `SubagentStart`, que trae el tipo, y la descripción con el resultado de `agent.spawn`; los dos se emparejan por el id del agente. La baja llega con `SubagentStop` o con el `turn.complete` del subagente. Un subagente sin señal durante 30 min sale de la lista.
  - **`subagents_peak`**, el pico de subagentes vivos a la vez.
  - **`usage`**, la suma de `turn.complete.usage` de todos los turnos de la sesión (hilo principal y subagentes) mientras hay un build. Un turno sin `usage` (por Esc o un error de API) no suma nada. Si nunca hubo uso, va `null`, no cero. `model` es el del último turno del hilo principal y nunca se inventa.
  - **`usage.active_ms`** (desde la 1.1.1), la suma de `turn.complete.durationMs` de esos mismos turnos, también los que se cortan con Esc. Es el tiempo activo de la sesión, y el hub lo usa para las horas a mano cuando no ve el estado «trabajando» (por ejemplo, si otro plugin no le pasa a este los hooks clásicos). Un turno sin `durationMs` no suma. No cambia cómo se calcula el estado idle/working de la sesión, que sigue gobernando la auto-ejecución. Un hub anterior ignora el campo.
- **Validación antes de mandar.** El plugin aplica las mismas reglas y topes que el hub: campos obligatorios, etapa de 1 a 7, fechas que no vayan más de 5 min en el futuro, textos con los secretos quitados antes de recortarlos y 16 KB como máximo (8 KB antes de la 1.7.0). Los links solo pueden ser rutas relativas o `https:`; los demás se descartan. Si el build no es válido, no se manda y el log dice qué campo falló, sin su contenido. Si es demasiado grande, primero se quitan las descripciones de los subagentes y luego los más viejos.
- **Estimado** (desde la 1.3.0). El coordinador manda en `estimate` las horas de reloj que espera, el desglose por fase, el supuesto del que dependen y, al reestimar, el motivo. El visor de builds lo usa para decir si el build va a tiempo, demorado o adelantado. Un hub anterior lo ignora, igual que el hub lo ignora en un worker.

  ```json
  {
    "estimate": {
      "total_h": 7,
      "phases": [{ "name": "Hub y API", "h": 1.5 }, { "name": "Visor", "h": 1.5 }],
      "assumption": "El VPS queda libre para merge-pr después de las 16:30",
      "reason": "revisión pidió otra vuelta"
    }
  }
  ```

  - Cada envío trae el estimado **completo** y reemplaza al anterior; no se mezcla. `estimate: null` o ausente lo deja como estaba.
  - Las horas se redondean a 0,1 y después se validan: `total_h` mayor que 0 y hasta 999; cada fase con `name` (hasta 80, no vacío después de quitar secretos) y `h` de 0 a 999; hasta 20 fases. `assumption` se recorta a 200 y `reason` a 120. El estimado serializado no pasa de 2 KB.
  - Un estimado inválido lo rechaza la herramienta al llamarla, con el campo que falló (`estimate`, `estimate.total_h`, `estimate.phases`, `estimate.assumption` o `estimate.reason`), y no se guarda nada. También rechaza la llamada si el build ya mezclado no cabe en los 16 KB.
- **Flujo y detalle por etapa** (desde la 1.8.2, solo el coordinador). Un hub anterior los ignora.

  ```json
  {
    "flow": "fix",
    "stage_detail": {
      "stage": 5,
      "items": [{ "label": "CI sielay-ci", "value": "verde · 3626 pruebas", "href": "https://github.com/o/r/actions/runs/1" }],
      "live": { "label": "gate shifted corriendo", "done": 2, "total": 3, "at": "2026-10-25T19:10:00Z" }
    },
    "delivery": { "merge_queue": { "position": 2, "total": 5, "reason": "CI de otro PR", "since": "2026-10-25T18:00:00Z" }, "deploy": { "state": "publishing" } }
  }
  ```

  - `flow`: `full`, `chico` o `fix`; sin él, `full`. `stage` sigue siendo 1..7.
  - `stage_detail`: `stage` obligatorio (1..7); `items` hasta 8 (los de más se recortan) con `label` (80, obligatorio), `value` (160) y `href` (`https:` o ruta relativa, 300; si no es válido se descarta el `href`); `live` con `label` (120, obligatorio), `done`, `total` (enteros desde 0) y `at` (ISO, sin pasar 5 min al futuro), o `null` para borrarlo. Los textos pasan por el mismo quitado de secretos que `summary`. Un campo inválido rechaza la llamada, con su nombre (`stage_detail.items.label`, `stage_detail.live.at`…).
  - `delivery.merge_queue`: `position` y `total` enteros desde 1 o `null`, `reason` (120) y `since` (ISO). `delivery.deploy`: `state` obligatorio y `at` (ISO). Si alguno es inválido, se descarta ese objeto y el reporte sigue.
  - Todo cabe en los 16 KB: un `stage_detail` lleno junto a un `retro` lleno pasa.
- **Ciclo de vida.**
  - `/clear` conserva el build.
  - Un `build_id` nuevo empieza otro build.
  - Después de mandar `done`, el plugin borra su build, porque en el hub un build cerrado no se puede cambiar. Una segunda corrida sobre el mismo plan usa un `build_id` con sufijo `-r2`.
- **En la franja** aparece una línea `build: etapa N/7 · nombre` mientras hay un build.

## Seguridad

- **Lista permitida del hub:** `hub_url` solo acepta `https://sielay.cloud` o `https://sielay.vostec.mx`.
  - Cualquier otro valor se rechaza al cargar.
  - Las redirecciones las sigue Claude Code, no el plugin. Entre orígenes distintos quita todas las cabeceras salvo accept y content-type, así que el token no sale de esos orígenes.
- **Red y procesos acotados:**
  - solo `mod/link-hub-client.js` y el helper del MCP (`bin/sielay-mcp-headers.*`, una sola petición a `/api/up/mcp-token`) hacen peticiones de red;
  - solo `mod/link-delivery-adapter.js` corre procesos del sistema: Node para el socket, `sh` para el archivo del token, y `tmux` y `hostname` para el nombre.
- **`.mcp.json` fijo:** la compuerta exige exactamente el servidor `sielay` en `https://sielay.cloud/mcp` con el helper del plugin.
- **Helpers fijados:** los dos helpers del MCP corren en cada conexión, fuera del motor, así que la compuerta fija su sha256. Cambiar cualquiera de los dos obliga a actualizar el pin en el mismo PR. El `.mjs` además solo puede importar `node:fs`, `node:os` y `node:path`.
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
