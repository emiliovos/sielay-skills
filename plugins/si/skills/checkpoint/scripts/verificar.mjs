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

const mismoInicio = (a, b) => Number.isFinite(a) && Math.abs(a - b) <= TOLERANCIA_MS;

export function verificar({ filas, desde, tabla, procesos, claudePid }) {
  const porPid = new Map(tabla.map((p) => [p.pid, p]));
  const vivaIgual = (f) => {
    const p = porPid.get(f.pid);
    return p && mismoInicio(f.inicioMs, p.inicioMs) ? p : null;
  };
  // Un pid vivo con otro inicio es un pid reciclado: el original murió.
  const muertos = filas.filter((f) => !vivaIgual(f)).map((f) => ({ pid: f.pid, comando: f.comando }));
  // Huérfano: hijo del claude actual anterior al handoff, o que el handoff
  // ya nombra con el mismo pid e inicio (un vigía del mismo minuto del handoff).
  const filaDe = (p) => filas.find((f) => f.pid === p.pid && mismoInicio(f.inicioMs, Date.parse(p.inicio)));
  const esHuerfano = (p) => Date.parse(p.inicio) < desde || Boolean(filaDe(p));
  const huerfanos = procesos.filter(esHuerfano).map((p) => ({
    pid: p.pid, inicio: p.inicio, tipo: p.tipo, comando: p.comando, vigia: filaDe(p)?.vigia ?? null,
  }));
  const porComando = new Map();
  for (const p of procesos) {
    if (p.comando === SIN_COMANDO) continue;
    porComando.set(p.comando, [...(porComando.get(p.comando) ?? []), p.pid]);
  }
  const duplicados = [...porComando].filter(([, pids]) => pids.length > 1).map(([comando, pids]) => ({ comando, pids }));
  const nuevos = procesos.filter((p) => !esHuerfano(p)).map((p) => ({ pid: p.pid, inicio: p.inicio, comando: p.comando }));
  // Vivos con el mismo inicio pero que no cuelgan de este claude: de otra
  // sesión o de otro árbol. Solo se reportan; nunca se detienen.
  const vivos_ajenos = filas.map(vivaIgual).filter((p) => p && p.ppid !== claudePid)
    .map((p) => ({ pid: p.pid, inicio: new Date(p.inicioMs).toISOString().replace('.000Z', 'Z'),
      comando: filas.find((f) => f.pid === p.pid).comando }));
  return { desde: new Date(desde).toISOString().replace('.000Z', 'Z'), muertos, huerfanos, duplicados, nuevos, vivos_ajenos };
}

export function hayHallazgos(v) {
  return v.muertos.length + v.huerfanos.length + v.duplicados.length > 0;
}
