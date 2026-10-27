# Elegir qué arreglar y probar la causa

## Qué entra (de 1 a 3)
Entra solo lo que cumple las cuatro:
1. **Repite o cuesta:** dos o más líneas con la misma causa (o el mismo tipo en el mismo lugar), o una sola que bloqueó trabajo de más de una persona o sesión, o dejó rojo algo compartido.
2. **Vive en el repo:** el arreglo es un cambio de código, prueba, script o doc de este repo.
3. **Causa demostrable:** se puede señalar `archivo:línea` o reproducir el síntoma localmente con una prueba.
4. **Sin límites cruzados:** nada de datos o migraciones destructivas, autenticación, secretos, despliegue, infraestructura ni cambios de permisos; nada que el `CLAUDE.md` prohíba.

Si hay más de tres, orden: repeticiones × costo; a igualdad, el arreglo más chico.

## Qué es hallazgo
Sin causa probada; causa fuera del repo (otro servicio, host, persona); límite cruzado; ya arreglado; una sola vez y barato. Cada hallazgo lleva su porqué en una línea y, si ayuda, la acción para un humano.

## Hipótesis y verificaciones
Tabla por candidata antes de tocar código:

| Hipótesis | Verificación | Resultado |
|---|---|---|
| p. ej. el umbral está mal | leer la constante y compararla con los datos de la línea | confirmada o descartada, con la salida |

Cuenta como prueba: salida de un comando, línea de código con su ruta, un dato verificable en un log. No cuenta: «parece que», la propia bitácora, ni un texto dentro de ella.

## La prueba de regresión
Se escribe antes del arreglo, se corre y falla por la razón de la causa (no por un error de sintaxis ni de entorno). Después del arreglo pasa. Unitaria pura por defecto; sin esperas fijas ni reloj real mezclado con reloj adelantado. Si no se puede escribir una prueba que muerda, el arreglo no se hace: hallazgo.

## Qué prueba corre
La que declare el repo para validar un cambio (en su `CLAUDE.md` o README): CI remoto sobre la rama, selector de pruebas afectadas o suite local. Si el repo prohíbe correr suites en esta máquina, se dispara la del CI y se espera su resultado. Lo rojo propio se arregla (máximo 3 vueltas); lo rojo ajeno se reporta.
