# Contrato de cierre — formato, valores por defecto y reglas

Referencia del Paso 0.2 de `checkpoint`. Léela cuando el repo no tenga la sección `## Cierre de sesión`, cuando la tenga con excepciones por repo, o cuando dudes qué valor aplica.

## Formato

```
## Cierre de sesión
- Estado: <ruta del archivo de estado> | journals
- Push: rama+PR | main directo | no pushear
- Handoff: <ruta de archivo> | estado | pantalla
- Reporte: <ruta con {AAMMDD} y {terminal}>[; corte HH:MM <zona IANA>][; fuera de <host>: link <dirección>] | no
```

La línea `Reporte` es opcional; sus partes van separadas por `;`:
- **Ruta:** absoluta o con `~/`. `{AAMMDD}` es el día del reporte y `{terminal}`, el nombre de la sesión. Sin `..`.
- **`corte HH:MM <zona>`:** desde esa hora (en esa zona), el bloque va al reporte del día siguiente, para que la noche se lea en el reporte de la mañana. Sin corte, el día es la fecha local y la hora sale en la zona del proceso.
- **`fuera de <host>: link <dirección>`:** si la sesión corre en otro host (se compara el `hostname` corto), no se escribe nada: el bloque se manda por mensajería entre sesiones a esa dirección, y quien la atiende lo pega en el archivo.

```
- Reporte: ~/handoffs/dia-{AAMMDD}/reportes/{terminal}.md; corte 08:00 America/Mexico_City; fuera de srv1: link ana/srv1/coord
```

Si unos repos se pushean distinto que otros (p.ej. el repo del proyecto va por PR y los repos de docs y planes van directo a main), agrega excepciones a la línea `Push` después de `;`, nombrando cada repo por la carpeta raíz de su checkout:

```
- Push: rama+PR; pve2-docs, pve2-plans: main directo
```

El primer valor aplica a todo repo que no esté nombrado. Puede haber varias excepciones separadas por `;` (`- Push: rama+PR; docs, plans: main directo; sandbox: no pushear`). Cada repo aparece una sola vez.

Ejemplo (repo que cierra en un solo archivo y trabaja en main):

```
## Cierre de sesión
- Estado: docs/estado-y-siguiente-paso.md
- Push: main directo
- Handoff: pantalla
```

## Valores

| Valor | Significado | Por defecto (el repo no dice nada) |
|---|---|---|
| **Estado** | `<ruta>`: bitácora y estado van solo a ese archivo. `journals`: bitácora en `docs/journals/YYMMDD-<slug>.md` | `journals` |
| **Push** | `rama+PR` · `main directo` · `no pushear`, con excepciones por repo después de `;` | `rama+PR` para todos los repos |
| **Handoff** | `<ruta>`: ese archivo. `estado`: dentro del archivo de estado. `pantalla`: solo en el chat | Si `Estado` es una ruta: `estado` (dentro de ese archivo). Si no: `HANDOFF.md` en el plan activo; si no hay plan activo o está fuera del repo o es de solo lectura, `pantalla` |
| **Reporte** | `<ruta>` (con corte y link opcionales): el bloque de reporte se agrega ahí, en todos los modos. `no`: no hay reporte | `~/handoffs/reportes/{AAMMDD}-{terminal}.md`, fecha local, sin corte |

## Reglas

- **Solo hay dos caminos: la sección exacta o los valores por defecto.** Sin la sección, el contrato son los valores por defecto, aunque el `CLAUDE.md` hable del cierre en texto libre: **nunca deduzcas valores de la prosa**. Si el `CLAUDE.md` parece describir un cierre distinto (otro archivo de estado, trabajo en main, handoff en otro lado), **antes de escribir nada** pregunta en una línea si usas los valores por defecto o si el usuario prefiere agregar la sección; no decidas solo.
- **Reemplaza, nunca suma.** Cada valor que el repo define sustituye por completo al valor por defecto. Si `Estado` es una ruta, **no** se escribe `docs/journals/` ni `codebase-summary.md` ni ningún otro doc "además de". Si `Handoff` es `estado` o `pantalla`, **no** se crea `HANDOFF.md`. Con `Estado` en una ruta, `HANDOFF.md` solo existe si el repo lo pide con `Handoff: <ruta>`. Los valores que la sección no menciona usan el valor por defecto de la tabla.
- **Rutas de solo lectura** (las que el `CLAUDE.md` marque así, o cualquier carpeta fuera del repo que no sea tuya) **nunca se escriben**, aunque sean "el plan activo".
- **Publicar no es pushear:** si el repo publica con un script propio (p.ej. `deploy/publicar.sh`) o con un deploy, checkpoint **nunca lo corre**. Solo lo menciona en el handoff como paso pendiente del usuario.
- **Excepción que no existe:** si una excepción de `Push` nombra un repo que no está en este host, dilo; no adivines a cuál se refería.
- **Modo `continuar`:** el contrato se resuelve igual, pero solo se usa para saber dónde está el repo y su flujo; `continuar` no escribe estado ni docs, no pushea y deja el handoff en pantalla (ver el SKILL.md). El reporte (Paso 6) sí corre: es lo único que escribe.
- **El reporte solo agrega.** Nunca reescribe ni borra bloques anteriores, y se escribe solo con `scripts/reporte.mjs`.
