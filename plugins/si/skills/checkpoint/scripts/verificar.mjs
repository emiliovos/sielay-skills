// --verificar: compara el bloque ENTORNO VIVO de un handoff con los procesos
// de ahora. Solo clasifica; no mata nada.
import { SIN_COMANDO } from './procesos.mjs';

const TOLERANCIA_MS = 2000; // el handoff guarda el inicio al segundo
const VIGIA = /\s*\((?:vig[ií]a|rearmar):\s*(s[ií]|no)\)\s*$/i;

export function parseHandoff(texto) {
  const lineas = texto.split('\n');
  const ini = lineas.findIndex((l) => /^##\s+ENTORNO VIVO\b/i.test(l));
  if (ini < 0) return { desde: null, filas: [], bloque: false };
  const cab = /\((\d{4}-\d\d-\d\dT[\d:.]+Z)\)/.exec(lineas[ini]);
  const desde = cab ? Date.parse(cab[1]) : NaN;
  const filas = [];
  for (const l of lineas.slice(ini + 1)) {
    if (/^##\s/.test(l)) break;
    const m = /^\s*-\s+pid\s+(\d+)\s+·\s+inicio\s+(\S+)\s+·\s*(.*)$/.exec(l);
    if (!m) continue;
    const v = VIGIA.exec(m[3]);
    filas.push({
      pid: Number(m[1]),
      inicioMs: Date.parse(m[2]),
      comando: m[3].replace(VIGIA, '').trim(),
      vigia: v ? /^s/i.test(v[1]) : null,
    });
  }
  return { desde: Number.isFinite(desde) ? desde : null, filas, bloque: true };
}

export function verificar({ filas, desde, tabla, procesos }) {
  const porPid = new Map(tabla.map((p) => [p.pid, p]));
  const muertos = filas
    .filter((f) => {
      const vivo = porPid.get(f.pid);
      // Un pid vivo con otro inicio es un pid reciclado: el original murió.
      return !vivo || !Number.isFinite(f.inicioMs) || Math.abs(vivo.inicioMs - f.inicioMs) > TOLERANCIA_MS;
    })
    .map((f) => ({ pid: f.pid, comando: f.comando }));
  const anteriores = procesos.filter((p) => Date.parse(p.inicio) < desde);
  const huerfanos = anteriores.map((p) => {
    const fila = filas.find((f) => f.pid === p.pid && Math.abs(f.inicioMs - Date.parse(p.inicio)) <= TOLERANCIA_MS);
    return { pid: p.pid, inicio: p.inicio, tipo: p.tipo, comando: p.comando, vigia: fila ? fila.vigia : null };
  });
  const porComando = new Map();
  for (const p of procesos) {
    if (p.comando === SIN_COMANDO) continue;
    porComando.set(p.comando, [...(porComando.get(p.comando) ?? []), p.pid]);
  }
  const duplicados = [...porComando].filter(([, pids]) => pids.length > 1).map(([comando, pids]) => ({ comando, pids }));
  const nuevos = procesos.filter((p) => Date.parse(p.inicio) >= desde)
    .map((p) => ({ pid: p.pid, inicio: p.inicio, comando: p.comando }));
  return { desde: new Date(desde).toISOString().replace('.000Z', 'Z'), muertos, huerfanos, duplicados, nuevos };
}

export function hayHallazgos(v) {
  return v.muertos.length + v.huerfanos.length + v.duplicados.length > 0;
}
