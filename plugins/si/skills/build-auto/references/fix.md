# Flujo `--fix`

Para arreglar algo que ya existe. Reglas del Frame, la ficha y la precedencia iguales; cambian las etapas y la aprobación. El Frame (etapa 1) se vuelve **Síntoma** y no lleva gate propio: el estimado y la autoridad (alcance, comando de entrega) van en la tarjeta de diagnóstico.

| # | Etapa | Con AgentKit | Modo nativo | Gate |
|---|---|---|---|---|
| 1 | Síntoma | tú: qué falla, cómo se reproduce y el alcance (qué entra y qué no) | igual | Autónomo |
| 2 | Causa | `/ak:debug` | subagente `debugger` | **Aprobación única** del diagnóstico |
| 4 | Arreglo | `/ak:fix`, con prueba de regresión | `fullstack-developer` | Autónomo |
| 5 | Verificar | como la etapa 5 de las 8: la prueba de regresión y la compuerta del repo | igual | Autónomo |
| 6 | Revisar | revisor fresco, con `effort: medium` (`high` si toca auth, seguridad, migraciones o datos de producción), que compara contra la `clave` de la tarjeta | `code-reviewer` | Autónomo; Critical/High se arreglan antes de entregar |
| 7 | Entregar | el comando de entrega de la ficha | igual | Autónomo hasta el alcance |
- **Causa probada antes de tocar código.** Lista de hipótesis (config, payload, estado de los datos, entorno) con una verificación por cada una; se corren y la causa queda confirmada con su evidencia. Si no queda probada, **para y reporta** lo descartado y lo que falta.
- **Diagnóstico = la aprobación.** Se presenta en una tarjeta: síntoma y cómo reproducirlo, causa probada con su evidencia (archivo:línea), arreglo propuesto con los archivos que toca, la prueba de regresión con su valor esperado (su clave, escrita antes del arreglo) o, si nadie puede darlo, peldaño 5, el riesgo, el alcance de entrega y el estimado. Es el gate de la etapa 2 y lo único que se aprueba; aprueba también la autoridad de la tarjeta, nunca más de lo que dice.
- **Prueba de regresión** que falla sin el arreglo: se corre sin él (o se razona por qué falla) y se anota. Sin ella el criterio no pasa.
- **Si el arreglo crece fuera de lo diagnosticado** (otro módulo, una migración, un archivo fuera de lo propuesto), para y pregunta antes de seguir.
- **Un carril, sin paralelo ni red team.** Un PR (o push por la compuerta) por arreglo. Riesgo alto (datos, auth, compuerta, deploy) sube la profundidad de la revisión.
- Se mantienen las "Reglas que nunca se rompen", la compuerta de pruebas y, con `produccion`, la receta de deploy. El cierre (etapa 8) es el de siempre, con retro corta.
- Reporte a sielay con `flow: "fix"`: las etapas se reportan con su número real (1, 2, 4, 5, 6, 7), sin pasar por la 3.
- **Sin retros previas:** `--fix` no lee las retros de builds anteriores (cambio de la versión 2.11.0); el arreglo se justifica con su diagnóstico.
- **Re-revisión:** tras la primera revisión, las siguientes miran solo `git diff <sha revisado>..HEAD`; tras un rebase, `git range-diff` (regla completa en `ejecucion-autonoma.md`).
