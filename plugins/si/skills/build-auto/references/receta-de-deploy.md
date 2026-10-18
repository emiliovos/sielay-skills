# Receta de deploy (solo con `--alcance produccion`)

Sigue el procedimiento de deploy que declare el repo y que quedó fijado en el plan aprobado (comando de publicación y de backup); esta receta lo complementa con la verificación. Si el repo no declara cómo publicar o cómo respaldar, no lo inventes: es una pregunta del Frame, y sin respuesta no se publica. Lo marcado *si aplica* depende de cómo se despliega el proyecto (contenedores, servicio en el host, plataforma administrada).

## Antes del build
1. **Integración nueva:** pruébala primero aislada, con la base de datos en memoria o temporal y un archivo de entorno de prueba (permisos 600, borrado después). Si el proyecto usa contenedores, hazlo en un contenedor desechable de la imagen (*si aplica*).
2. **Migraciones:** pruébalas en una base de datos vacía y en una **copia del backup de producción**, nunca en la base real. La copia vive en un entorno desechable del mismo host (contenedor o directorio temporal), se borra al terminar y nunca se commitea ni se sube a otro lado: puede tener datos personales.
3. **Backup justo antes** del deploy, con chequeo de integridad. No vale uno tomado antes: los datos cambian en el camino. Si el backup o su chequeo fallan, no se publica.
4. **Sello:** verifica que el commit a publicar pasó la compuerta (en `main directo`, la constancia de la punta). Sin sello no se publica.
5. **Build sin caché** cuando hay paquetes de sistema o archivos nuevos (*si aplica*).

## Prueba de humo después
- El servicio está sano (contenedor healthy, unidad activa o el health check de la plataforma) y el log muestra la migración aplicada.
- La versión del esquema y los conteos clave se conservaron.
- La ruta nueva responde lo esperado sin sesión (por ejemplo 401, no 404).
- El binario o paquete nuevo existe en el entorno desplegado.
- **Una llamada real a cada proveedor externo nuevo**, desde el entorno desplegado y con su config de producción. Atrapa llaves malas o sin el alcance correcto.

**Si la prueba de humo falla:** ejecuta el rollback documentado (código o montaje, nunca revertir la migración ni restaurar la base de datos sin el usuario) y avisa de inmediato. Nada de arreglos improvisados en producción.

## Funciones nuevas
- Detrás de un interruptor **apagado por defecto**.
- Rollback documentado antes del deploy: revertir el código o el montaje, no la migración.

## Si el servidor depende de un agente instalado en otros hosts
- Los umbrales dependen de la versión del agente: los viejos conviven hasta que se reinstalan.
- Gracia al arrancar el servidor, para que un redeploy no dispare alertas.
- Umbrales medidos con datos de producción, no supuestos.
- La reinstalación por host es un **momento humano** explícito del plan.

## Reporte del deploy
Commit publicado, backup tomado (ruta y chequeo), resultado de cada punto de la prueba de humo y cómo hacer rollback.
