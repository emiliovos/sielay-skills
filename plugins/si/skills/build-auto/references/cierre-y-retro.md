# Cierre y retro (etapa 8)

El coordinador cierra el build con cifras, no con impresiones. Todo sale de lo anotado durante la corrida (`plan.md`, reportes, el visor).

## `retro.yaml`
Se escribe en la carpeta del plan:

```yaml
kind: ui | backend | infra | docs | mixed
entregado: []   # hasta 5: qué quedó en la rama principal o en producción, con PR o SHA
pendientes: []  # hasta 5: qué falta y quién decide ("Deploy: lo decide <persona>")
bien: []        # hasta 5, una línea cada una
mal: []
batallo: []     # donde se perdió tiempo o hubo que rehacer
propuestas:     # hasta 4
  - text: ""
    applies_to: build-auto | repo | plan
marcador:
  toques_de_la_persona: 0     # aprobaciones, respuestas, correcciones
  tokens: 0                   # por carril y total, si el plugin los da
  reloj_idea_a_merge: ""      # de la primera línea del Frame al merge
  estimado_vs_real: ""        # programado contra real, con la razón real/estimado
  fallas_que_la_revision_no_vio: []   # lo que apareció después de la revisión (CI, e2e, producción)
  propuestas_previas:         # de la tabla «Retros previas» del Frame
    leidas: 0                 # filas de la tabla (propuestas y problemas leídos)
    aplicadas: 0              # filas con «sí» que de verdad se aplicaron
    no_aplicadas: 0           # filas con «no», más los «sí» que al final no se aplicaron
fases:          # una por etapa o carril que corrió, en orden
  - fase: ""                  # "1 Frame", "4 carril backend", "6 revisión de integración"…
    modelo: ""                # el que corrió de verdad, según medir-contexto.mjs
    contexto_max: 0           # tokens, el máximo de esa fase
    subagentes: []            # [{tipo, modelo, contexto_max}] de los que corrieron en la fase
    cortes: 0                 # checkpoints por llegar a 150 K (líneas «limpio» del build en ~/.cache/si-build-auto/corte/bitacora.log, más los cortes sin tmux que avisaron «listo para clear»; un «limpiar-fallo» va en `mal`)
```

- **`fases` sale medido, no de memoria.** Con las horas de inicio y fin de cada tramo anotadas en `plan.md`, corre `node <carpeta de la skill>/scripts/medir-contexto.mjs --desde <inicio> --hasta <fin>` por fase (la carpeta es la de «Presupuesto de contexto» en `SKILL.md`; en cada sesión que coordinó, con `--sesion <id>` si hubo cortes; una terminal de carril reporta sus propias cifras al cerrar). Si un subagente corrió en otro modelo que el de la tabla «Modelo fijo por rol», o una fase pasó de 150 K sin cortar, va también en `mal` con su porqué.

- **Redacción de cada lista:** un hecho por ítem, una línea (~100 caracteres, máximo 160), que empiece por lo que pasó o lo que se hizo, con PR o SHA cuando aplique. Sin adjetivos ni jerga ("robusto", "sinergia", "end-to-end"). Lo que no aplica va vacío; no se rellena.
- Una propuesta es una regla concreta y accionable ("fijar el tope de tokens por carril desde el Frame"), no una queja.
- Las fallas que la revisión no vio son el dato más útil: di qué clase de bug era y qué lo habría atrapado.
- **`propuestas_previas` se cuenta de la tabla del Frame**, fila por fila: `leidas` = aplicadas + no aplicadas. Un «sí» que no llegó a aplicarse cuenta como no aplicado y va en `mal` con su porqué. Sin retros previas, los tres en 0.

## Qué hacer
1. Escribe `retro.yaml`.
2. Manda `retro` a sielay (`reporte-sielay.md`) junto con `status: "done"`, `stage: 7` y `outcome`. Si el campo `retro` del plugin no tiene lugar para `fases`, resúmelas en una línea del `summary` final («coordinador opus máx 140 K, 1 corte; carriles sonnet máx 90 K; revisión opus 60 K»). Además, siempre, una línea con `propuestas_previas` (`- Retros previas: 5 leídas, 3 aplicadas, 2 no`), porque el campo `retro` no la lleva.
3. Si el entorno publica artifacts, publica el marcador como una página de cifras con su fuente (de dónde sale cada número). Sin eso, el marcador va en el reporte final.
4. Escribe el reporte final estilo brief: primero lo que necesita a la persona (decisiones, momentos humanos, pendientes), luego lo que pasó.
5. Commitea `retro.yaml` con los demás reportes del plan, según el modo de entrega.
