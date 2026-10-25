# Disciplina de pruebas y reporte final

Una prueba demuestra que la app no se rompe, no que el código hace lo que se acaba de escribir. Muchas pruebas en verde con una app que se rompe es un fracaso.

## Antes de crear una prueba, razona y deja escrito
1. ¿Qué comportamiento cambió realmente?
2. ¿Qué podría romperse de forma realista?
3. ¿Qué pruebas existentes ya lo demuestran?
4. ¿Cuál es la capa más baja y confiable para verificarlo (unitaria, integración, servidor real, E2E)?
5. ¿De verdad hace falta otra prueba?

## Costo de las pruebas
Una suite puede crecer mucho más rápido que el código. El tiempo se va sobre todo en las pruebas que levantan la app y en las esperas.
- **Una sola prueba de servidor real por flujo de punta a punta.** Los casos límite, las ramas de error y las validaciones van como pruebas unitarias puras: funciones o módulos, sin levantar la app ni lanzar subprocesos.
- **Nada de esperas fijas** (`sleep` o `setTimeout` de segundos). Inyecta el reloj o agrega un ajuste solo para pruebas, por ejemplo una variable de entorno que acorta un intervalo de sondeo y que la app solo respeta con `NODE_ENV=test`.
- **Una prueba nueva que tarde más de 5 s se justifica en el PR** (o en el commit, en `main directo`).
- **Sin meta de cobertura fija si el repo tiene selector o carriles.** Verifica con las pruebas afectadas y deja la suite completa a la compuerta de entrega y a la corrida nocturna (`compuerta-de-pruebas.md`). Si las pruebas pesadas ya van en un carril aparte, la prueba nueva de servidor real va en ese carril.
- Lo que un revisor marca como opcional no se convierte en una prueba nueva por defecto (`ejecucion-autonoma.md`, "Durante").

## Prohibido (trampas para poner CI en verde)
- Pruebas tautológicas (`true == true`, afirmar exactamente lo que el código acaba de devolver, mocks que prueban al mock).
- Reescribir una prueba que falla para que sea trivialmente cierta.
- Saltar una prueba (`skip`, `todo`, "falta la herramienta en este host", "no relacionado con mi cambio"). **Una prueba saltada cuenta como roja.** La herramienta se instala en el host que sella (momento humano o fase aprobada) o el chequeo pasa al build.
- Debilitar una aserción o un criterio de aceptación para que pase.

## Cuando una prueba falla
Investiga la causa y repórtala. Nunca debilites una garantía existente, nunca la comentes sin explicar por qué falló y nunca la saltes salvo que el usuario lo autorice explícitamente.

## Cada prueba nueva debe morder
Rompe la implementación a propósito y demuestra que la prueba falla; si no falla, la prueba no sirve. Anota en el PR o en el commit qué mutaciones probaste y qué prueba atrapó cada una.
- Describe cada mutación por el texto o el símbolo que cambia (función, condición, constante) y por su reemplazo, nunca por número de línea: las enmiendas y los arreglos de revisión mueven las líneas.
- Si una mutación no se puede aplicar (el texto ya no está o aparece más de una vez), repórtala como **no aplicada**. Una mutación no aplicada no cuenta como atrapada ni como fallida.
- Después de cada enmienda, revisa la lista de mutaciones: quita las del comportamiento retirado y agrega las del comportamiento nuevo.

## Un reloj por comparación
Si producción compara contra el reloj de la base de datos, la prueba siembra y lee con SQL; si compara contra el reloj de la app, siembra desde la app. No mezcles tiempo real (mtime, fechas externas) con el reloj de la app.

## Borrar e inestables
- Las pruebas sin sentido, tautológicas o que existen solo por tener pruebas se eliminan, con justificación. Las que protegen comportamiento importante nunca se borran por velocidad.
- Las inestables se reportan como hallazgo con causa probable e issue de seguimiento; nunca se silencian.

## Comandos de mantenimiento (AgentKit)
- `/ak:test create [scope]`: crea la cobertura que falta alrededor de comportamiento real.
- `/ak:test audit [scope]`: encuentra pruebas débiles, redundantes, obsoletas, saltadas o sospechosas.
- `/ak:test optimize [scope]`: pruebas más rápidas y baratas, con mediciones.
- `/ak:test optimize --ultra`: cinco enfoques independientes; un verificador elige el más fuerte.

Sin AgentKit, haz lo mismo con el agente del carril y entrega la misma evidencia.

---

## Reporte final (etapa 8)
- **Qué se entregó y dónde:** PRs o commits, URLs, issues, y qué quedó desplegado.
- **Evidencia de cada criterio de aceptación:** pruebas, mutaciones que muerden, capturas, logs, prueba de humo.
- **Cifras medidas** (tiempos, costos) contra los objetivos del plan.
- **Dónde se fue el tiempo:** una tabla por tramo (espera humana, evidencia y plan, implementación, revisión, CI, integración, merge, deploy) con su duración real, el programado contra el real y la ruta crítica que de verdad resultó. Sale de las horas anotadas en `plan.md`. Es lo que permite calibrar el estimado del siguiente build.
- **Riesgos aceptados y pendientes**, cada uno con su issue (*si hay tracker*); momentos humanos que le quedan al usuario.
- **Worktrees y ramas** que borraste y los que quedan.
- **Aprendizajes del flujo** para la próxima vez (guárdalos en la memoria del proyecto si existe).
- **Preguntas abiertas** al final.
