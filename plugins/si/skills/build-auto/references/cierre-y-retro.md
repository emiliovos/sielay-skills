# Cierre y retro (etapa 8)

El coordinador cierra el build con cifras, no con impresiones. Todo sale de lo anotado durante la corrida (`plan.md`, reportes, el visor).

## `retro.yaml`
Se escribe en la carpeta del plan:

```yaml
kind: ui | backend | infra | docs | mixed
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
```

- Una propuesta es una regla concreta y accionable ("fijar el tope de tokens por carril desde el Frame"), no una queja.
- Las fallas que la revisión no vio son el dato más útil: di qué clase de bug era y qué lo habría atrapado.

## Qué hacer
1. Escribe `retro.yaml`.
2. Manda `retro` a sielay (`reporte-sielay.md`) junto con `status: "done"`, `stage: 7` y `outcome`.
3. Si el entorno publica artifacts, publica el marcador como una página de cifras con su fuente (de dónde sale cada número). Sin eso, el marcador va en el reporte final.
4. Escribe el reporte final estilo brief: primero lo que necesita a la persona (decisiones, momentos humanos, pendientes), luego lo que pasó.
5. Commitea `retro.yaml` con los demás reportes del plan, según el modo de entrega.
