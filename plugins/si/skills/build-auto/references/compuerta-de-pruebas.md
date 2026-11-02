# Compuerta de pruebas

Confirma, antes de la etapa 4, cómo prueba y entrega este repo. Si ya tiene compuerta, **úsala tal cual**: no la reemplaces, no la envuelvas en otro lock y no le agregues pasos que el repo no pidió.

## El modelo de referencia: tres niveles
La garantía va en la entrega, no en cada push, y el deploy solo comprueba un sello.

1. **Push:** corre solo las pruebas que alcanza lo que se empuja. Puede ser un selector por dependencias o carriles fijos (por ejemplo backend, frontend o scripts). Solo docs → nada. Archivos globales (dependencias, migraciones, Dockerfile, la propia compuerta) o código que ninguna prueba alcanza → suite completa.
2. **Entrega:** se corre una verificación más fuerte sobre lo que va a quedar en la rama principal; si pasa, se **sella** el commit resultante.
3. **Deploy:** el checkout de producción exige que el commit tenga un sello válido y sin pruebas saltadas. Nunca corre la suite. Sin sello no se construye.

Además: **un solo lock de suite por host**, tomado por los propios scripts (dos suites a la vez en pocos núcleos se vuelven inestables), y una **corrida nocturna de la suite completa** que cubre lo que el selector o los carriles dejan pasar.

## Variante `rama+PR`
- Con rama de integración, la entrega es **un** PR `build/<slug>` → rama principal y **un** solo merge-pr por build; los carriles no pasan por el script de merge, solo por su CI y su revisión. Si el repo tiene cola de merge, el build entra con una sola entrada (`--enqueue` o el equivalente que el repo declare).
- La entrega es un script de merge que corre, sobre la mezcla de la rama principal con el PR, lo que elige el selector (nada, afectadas o completa). Si el repo lo tiene, también con el **reloj adelantado** (por ejemplo +1 y +30 días). Si pasa, mergea y sella el SHA del merge commit.
- Se lanza en segundo plano desde un **runner limpio**: un worktree aparte, al día con la rama principal antes de cada merge.
- **El merge usa el head que está en el remoto.** Si falló el push del rebase, se mergea el head anterior: confirma que el push llegó antes de lanzar el merge.
- PRs apilados: cambia la base del hijo a la rama principal antes de mergear el padre. Nunca borres una rama sin confirmar que el merge quedó hecho.

## Variante `main directo`
- La entrega es el push a main por la compuerta (los carriles del push son la verificación). La publicación es un paso aparte y **solo ocurre con `--alcance produccion`**. Si el push a main ya publica solo, la entrega misma requiere `produccion`.
- **Publicar es el muro.** Al publicar, HEAD ya es main y el diff contra main está vacío: la publicación exige la **constancia de que ese commit pasó la compuerta**, no un diff.
- **Un push de commits que ya están en main no vuelve a pasar por el gancho** (git no le pasa referencias nuevas). Si un commit llegó a main sin constancia, corre la verificación de la compuerta sobre ese commit y genera la constancia con el comando del repo. Si el único mecanismo es un override manual, es un momento humano: no te autoapruebes. Sin constancia no se publica.
- Si el repo exige una constancia de revisión hecha por máquina (por ejemplo, un gancho que anota la huella del cambio al terminar la revisión), respétala. Esta skill no la impone.

## Variante CI remoto
Cuando la ficha dice que las pruebas corren en CI remoto (un workflow en runners de otra máquina, y un comando de merge que reusa su corrida verde):
- La verificación de cada carril es la corrida del workflow sobre su push. Si el workflow del repo no corre en push, dispárala a mano (`gh workflow run <workflow> --ref <rama>`) o no esperes CI hasta el PR de integración; esa corrida solo muestra la rama y nunca la reusa el merge. Espera como dice `ejecucion-autonoma.md` («Esperar la CI»): `link_watch` si existe y responde, si no `gh pr checks <N> --watch --fail-fast` o `gh run watch <id> --exit-status` en segundo plano; nunca Monitor ni bucles `gh … --json | jq`. Verde es la corrida de `pull_request`, no la de `push`. No corras suites locales para verificar: duplican la carga y no cuentan para la entrega.
- La rama de integración se empuja y su corrida es la que reusa el merge del PR final. Si la rama principal se movió y el merge ya no puede reusarla, rebasa una vez, empuja y espera la corrida nueva; no la fuerces localmente salvo que el repo lo prevea.
- Si los runners quedan fuera de línea a media corrida, el build vuelve a concurrencia local (2) y sigue con la compuerta local del repo; dilo en una línea.
- Un rojo del workflow sobre el mismo árbol bloquea la entrega igual que un rojo local.

## Si el repo no tiene compuerta
No la crees ni la propongas como fase del plan: menciónalo en el Frame y entrega con la verificación que define el plan. Una compuerta nueva, o un cambio a la existente, es una decisión aparte que solo aprueba la persona; las aprobaciones del Frame y del plan no la cubren.

Si la persona la aprueba, al construirla o cambiarla mide antes y después (`/ak:test optimize` o tiempos a mano) y:
- **Prueba los scripts con un push real contra un remoto temporal** (`git init --bare` en un directorio desechable), no leyendo el texto del gancho. Cubre los casos de push de solo docs, push de código, push de un archivo global y push de algo que ya está en el remoto.
- Los ganchos exportan variables `GIT_*`. Las pruebas que lancen git dentro del gancho corren con un entorno mínimo (solo `PATH` y un `HOME` temporal, o `GIT_CONFIG_GLOBAL=/dev/null` y `GIT_CONFIG_NOSYSTEM=1`) o limpian esas variables del proceso hijo; si no, tocarán el repo real o la config global de git.
- Una herramienta que falta en el host no se convierte en una prueba saltada: se instala en el host que sella o el chequeo pasa al build de la imagen. Instalar en un host es un momento humano o una fase aprobada del plan, nunca una decisión del agente a medio camino.

## Reglas del día a día
- Si la suite de otra sesión tiene el lock, espera tu turno; no la mates.
- Tras rebasar sobre la rama principal, reinstala las dependencias antes de empujar: un pre-push "rojo" puede ser solo una dependencia nueva.
- **Un reloj por comparación:** si la compuerta adelanta el reloj, no mezcles tiempo real (mtime, fechas externas) con el reloj de la app. Inyecta `now` o derívalo de los datos.
- Nunca `--no-verify`; nunca `git push | head` (el pipe mata el push a media compuerta). Si quieres el log, redirígelo a un archivo.

## Huecos que hay que conocer desde el día 1
- Un falso negativo del selector o de los carriles entra a main sin correr. Lo cubre la corrida nocturna completa; sin ella, el hueco es real.
- Mergear con el botón del hosting se salta la compuerta. El sello bloquea el deploy, pero no el merge.
- Las pruebas E2E de navegador suelen quedar fuera de la compuerta: van como evidencia del plan.
- El sello es una convención entre sesiones, no un control de seguridad.
- **Un carril que nadie corre puede estar roto sin que nadie lo sepa.** Al agregar o cambiar la compuerta, corre cada carril al menos una vez de punta a punta y revisa su conteo de pruebas saltadas.
- Linters, detectores de patrones y cobertura que cuentan archivos del repo dan resultados falsos si recorren las dependencias instaladas (entornos virtuales, `node_modules`): exclúyelas ahí. El análisis de vulnerabilidades de dependencias sí las revisa.
