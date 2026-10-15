# sielay-link

Conecta sesiones de Claude Code a través de un hub de [sielay](https://sielay.cloud). Una sesión le escribe a otra con `link_send`. El mensaje llega a la otra terminal con un encabezado verificado por el hub. Lo que pase después lo deciden el hub y la persona que está en esa terminal.

**Es opcional y va aparte del plugin `si`.** Trae un módulo de hooks, un ejecutable pequeño de Node y tráfico de red. Todo eso está acotado por `tools/check-sielay-link.sh` (ver «Seguridad»).

## Instalar

```
claude plugin marketplace add emiliovos/sielay-skills && claude plugin install sielay-link@sielay
```

La entrada del marketplace va fijada al tag `sielay-link-v1.0.0`. Solo cambia por un PR revisado.

**Requisitos:**
- **Claude Code 2.1.300.** La API de módulos es de acceso anticipado y cambia entre versiones. Antes de actualizar Claude Code, corre el smoke de abajo.
- **Node 22 o más reciente** en el `PATH`, para el adaptador `socket`. Sin Node, los mensajes entran como prompt (modo de respaldo) y el plugin lo avisa.
- **Linux o macOS** para el adaptador `socket`. En Windows no hay socket unix: se usa el modo `prompt`.

## Emparejar esta máquina

1. Un admin crea un **slot** en el dashboard (`/admin/link`). El slot fija la persona y la máquina, por ejemplo `ana-laptop`.
2. En la sesión: `/link pair <slot>`. El panel muestra un código.
3. El admin aprueba ese código en el dashboard, con 2FA.
4. El panel muestra el **token una sola vez** y luego lo guarda en `~/.claude/sielay-link/token`, con permisos 0600. El token viaja por stdin, nunca en la línea de comandos.
   - Si no se pudo escribir el archivo, el token sigue en pantalla: pégalo en `/plugin` → sielay-link → `link_token`.
   - Si `link_token` tiene un valor, gana sobre el archivo.

El token nunca se guarda en `$.store` ni en un campo de configuración en claro.

## Nombre de la sesión

Tu dirección es `persona/máquina/sesión`. La persona y la máquina las fija el slot. El nombre de la sesión sale de la primera fuente que exista:

1. la variable `SIELAY_LINK_NAME`;
2. `/link name <nombre>`, guardado para esta carpeta;
3. `.claude/sielay-link.json` del proyecto: `{"name": "api", "project": "Mi proyecto"}`;
4. el nombre de la sesión de tmux;
5. el nombre que le diste con `/rename`. Llega con el siguiente prompt, no al instante;
6. el nombre de la carpeta.

Si otra carpeta ya usa ese nombre y está en línea, el hub te asigna `nombre-2`.

## Comandos y herramientas

| | Qué hace |
|---|---|
| `/link` | Estado: hub, dirección, modo y si está fresco, adaptador y mensajes en franja. Abre el panel |
| `/link name <x>` | Fija el nombre de la sesión para esta carpeta |
| `/link off` / `on` | Apaga o enciende la recepción en esta sesión. `SIELAY_LINK_OFF=1 claude` lo apaga del todo, sin herramientas |
| `/link peers` | Sesiones con las que puedes hablar (solo pares) |
| `/link pair <slot>` | Empareja la máquina |
| `link_send`, `link_reply`, `link_peers` | Las herramientas del modelo. **No existe ninguna para aceptar, rechazar ni liberar** |

Para que el modelo las use sin preguntarte cada vez, agrégalas a `permissions.allow` en `~/.claude/settings.json`:

```json
{ "permissions": { "allow": ["mcp__sielay-link__link_send", "mcp__sielay-link__link_reply", "mcp__sielay-link__link_peers"] } }
```

## Cuándo se ejecuta solo un mensaje

Un mensaje entra a tu sesión sin preguntar solo si se cumple todo esto:

- el par tiene auto-ejecución, y un admin la encendió con 2FA;
- el remitente estaba en `bypassPermissions` al enviar;
- tu sesión está en `bypassPermissions` y esa lectura está **fresca** al momento de entregar.

Cualquier otro mensaje va a la **franja** de arriba del prompt: «link: N en franja», con **[1 Aceptar]** y **[2 Rechazar]**.

- Para usar las teclas, enfoca la franja (ctrl+x tab, o un clic) y pulsa 1 o 2.
- Aceptar es tu confirmación: el mensaje se entrega sea cual sea tu modo.
- «Liberar» desde el dashboard nunca ejecuta nada: solo manda el mensaje a tu franja.

**Frescura del modo.** Claude Code solo informa el modo de permisos en los hooks de un turno: al enviar un prompt, al usar una herramienta y al terminar. Con la sesión en idle no hay lectura en vivo: un shift+tab no avisa a nadie. La regla vigente (`IDLE_POLICY` en `mod/link-mode-freshness.js`) es «último modo visto»:

- si al terminar el último turno la sesión estaba en bypass, sigue contando como bypass fresco hasta **12 h** en idle;
- pasado ese tiempo, o con otro modo, el mensaje va a la franja.

El hub recibe en cada poll el modo, si está fresco y su antigüedad (`mode_age_s`), para mostrarlo en el dashboard. Al arrancar, el modo es desconocido hasta el primer prompt.

**Organizaciones.** Donde una organización gestiona Claude Code, los hooks `classic.*` de un plugin instalado por la persona no corren. Ahí el modo queda desconocido y no hay auto-ejecución: todo va a la franja.

## Cómo entra un mensaje

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

## Seguridad

- **Lista permitida del hub:** `hub_url` solo acepta `https://sielay.cloud` o `https://sielay.vostec.mx`.
  - Cualquier otro valor se rechaza al cargar.
  - Las redirecciones nunca se siguen, así que el token no sale de esos orígenes.
- **Red y procesos acotados:** solo `mod/link-hub-client.js` hace peticiones de red, y solo `mod/link-delivery-adapter.js` corre procesos del sistema: Node para el socket, `sh` para el archivo del token, y `tmux` y `hostname` para el nombre.
- **El CI lo impide.** `tools/check-sielay-link.sh` exige todo lo anterior y además prohíbe:
  - `asUser`, `eval` y URL fuera de la lista;
  - tokens escritos en el código;
  - que el token se guarde en `$.store`.
- **Revisión obligatoria:** CODEOWNERS pide la revisión del dueño para cada cambio del plugin.
- **Apagado de emergencia:** `SIELAY_LINK_OFF=1`. Para revocar una máquina, el admin lo hace en el dashboard.

## Desinstalar

```
claude plugin uninstall sielay-link@sielay && rm -rf ~/.claude/sielay-link
```

## Smoke antes de actualizar Claude Code

```
claude plugin validate --strict plugins/sielay-link && claude plugin test plugins/sielay-link
```
