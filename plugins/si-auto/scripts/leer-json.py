#!/usr/bin/env python3
"""Lector de JSON para los ganchos de si-auto.

Lee el JSON del gancho por stdin (o una transcripción por ruta) e imprime el
resultado. Nunca escribe archivos: las escrituras las hacen los scripts bash.

  campos                  los campos que usan los ganchos, uno por línea (ver CAMPOS)
  nota                    texto entre <si-auto-nota> y </si-auto-nota> del último mensaje
  veredictos              "ID<TAB>valor" por cada <si-auto-veredicto nota="ID">valor</si-auto-veredicto>
  ediciones RUTA EPOCH    cuántos usos de herramientas de ACTIVIDAD hay en la transcripción después de EPOCH
  contexto EVENTO         JSON de additionalContext con el texto de stdin
  bloqueo                 JSON de bloqueo de Stop con el texto de stdin como orden
"""
import json
import re
import sys
from datetime import datetime

# Herramientas que cuentan como actividad de la sesión. Bash cuenta porque hay repos
# donde casi todo se edita por Bash.
ACTIVIDAD = {"Edit", "Write", "MultiEdit", "NotebookEdit", "Bash"}
# Orden fijo: comun.sh los lee por posición.
CAMPOS = ["session_id", "cwd", "transcript_path", "stop_hook_active", "source", "reason", "trigger"]
VEREDICTO = re.compile(
    r'<si-auto-veredicto nota="([A-Za-z0-9-]+)">\s*(ya-reflejada|integrada|parcial)\s*</si-auto-veredicto>'
)


def entrada():
    try:
        return json.load(sys.stdin)
    except ValueError:
        return {}


def ultimo_mensaje():
    return entrada().get("last_assistant_message") or ""


def campos():
    d = entrada()
    for nombre in CAMPOS:
        valor = d.get(nombre, "")
        valor = str(valor).lower() if isinstance(valor, bool) else str(valor)
        print(valor.replace("\n", " ").replace("\r", " "))


def nota():
    # Las marcas deben ir solas en su línea, como las pide la orden de Stop.
    encontradas = re.findall(r"(?m)^<si-auto-nota>[ \t]*$(.*?)^</si-auto-nota>[ \t]*$", ultimo_mensaje(), re.S)
    if encontradas:
        print(encontradas[-1].strip())


def veredictos():
    for nota_id, valor in VEREDICTO.findall(ultimo_mensaje()):
        print(f"{nota_id}\t{valor}")


def ediciones(ruta, desde):
    desde, total = float(desde), 0
    try:
        archivo = open(ruta, encoding="utf-8", errors="ignore")
    except OSError:
        print(0)
        return
    with archivo:
        for linea in archivo:
            if '"tool_use"' not in linea:
                continue
            try:
                d = json.loads(linea)
                t = datetime.fromisoformat(d["timestamp"].replace("Z", "+00:00")).timestamp()
            except (ValueError, KeyError, AttributeError):
                continue
            if d.get("type") != "assistant" or t <= desde:
                continue
            contenido = (d.get("message") or {}).get("content") or []
            total += sum(
                1 for c in contenido
                if isinstance(c, dict) and c.get("type") == "tool_use" and c.get("name") in ACTIVIDAD
            )
    print(total)


def contexto(evento):
    salida = {"hookSpecificOutput": {"hookEventName": evento, "additionalContext": sys.stdin.read()}}
    print(json.dumps(salida, ensure_ascii=False))


def bloqueo():
    print(json.dumps({"decision": "block", "reason": sys.stdin.read()}, ensure_ascii=False))


ORDENES = {"campos": campos, "nota": nota, "veredictos": veredictos,
           "ediciones": ediciones, "contexto": contexto, "bloqueo": bloqueo}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in ORDENES:
        sys.exit(__doc__)
    ORDENES[sys.argv[1]](*sys.argv[2:])
