// Inventario de los procesos que cuelgan del claude propio.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redactar, recortar } from './redactar.mjs';

export const SIN_COMANDO = '(no legible)';
const ENVOLTORIO = /^(?:\S*\/)?bash -c source \S*snapshot/;

// El envoltorio de cada llamada Bash del claude es
//   bash -c source <snapshot> && <preámbulo de exports> && eval '<comando>' && pwd -P >| <archivo>
// El comando real es lo que va dentro de eval '…', con cada comilla simple
// original escapada como '"'"'. Nunca se devuelve el preámbulo.
export function extraerComando(cmdline) {
  if (!ENVOLTORIO.test(cmdline)) return null;
  const ini = cmdline.indexOf("eval '");
  if (ini < 0) return null;
  const cuerpo = cmdline.slice(ini + 6);
  let fin = -1;
  for (const m of cuerpo.matchAll(/'(?:\s*<\s*\S+)?\s*&&\s*pwd -P/g)) fin = m.index;
  if (fin < 0) return null;
  const comando = cuerpo.slice(0, fin).split(`'"'"'`).join("'");
  return comando.trim() === '' ? null : comando;
}

export function esEnvoltorio(cmdline) {
  return ENVOLTORIO.test(cmdline ?? '');
}

export function ancestros(porPid, pid) {
  const cadena = [];
  const visto = new Set();
  for (let p = porPid.get(pid); p && !visto.has(p.pid); p = porPid.get(p.ppid)) {
    visto.add(p.pid);
    cadena.push(p.pid);
  }
  return cadena;
}

export function dirSesiones(home = os.homedir()) {
  return path.join(home, '.claude', 'sessions');
}

export function leerSesion(dir, pid, io = fs) {
  try {
    const j = JSON.parse(io.readFileSync(path.join(dir, `${pid}.json`), 'utf8'));
    return j && typeof j === 'object' ? j : null;
  } catch { return null; }
}

export function listarSesiones(dir, io = fs) {
  let nombres;
  try { nombres = io.readdirSync(dir); } catch { return []; }
  return nombres.filter((n) => /^\d+\.json$/.test(n)).map((n) => leerSesion(dir, parseInt(n, 10), io))
    .filter((s) => s && Number.isInteger(s.pid));
}

// claude = ancestro más cercano con comm `claude` o con un sessions/<pid>.json.
export function encontrarClaude(porPid, desdePid, { dir, io = fs } = {}) {
  for (const pid of ancestros(porPid, desdePid)) {
    if (pid === desdePid) continue;
    if (porPid.get(pid).comm === 'claude') return pid;
    if (dir && leerSesion(dir, pid, io)) return pid;
  }
  return null;
}

export function datosClaude(pid, dir, io = fs) {
  const s = leerSesion(dir, pid, io);
  if (!s) return { pid };
  return { pid, session_id: s.sessionId, name: s.name, tmux: s.tmux };
}

function clasificar(p, cmdline) {
  const lider = p.pgid === p.pid;
  if (esEnvoltorio(cmdline)) {
    const c = extraerComando(cmdline);
    if (c == null) return { tipo: 'otro', comando: SIN_COMANDO };
    return { tipo: lider ? 'tarea' : 'otro', comando: recortar(redactar(c)) };
  }
  return { tipo: lider ? 'proceso' : 'otro', comando: recortar(redactar(cmdline ?? '')) || SIN_COMANDO };
}

// Descendientes DIRECTOS del claude, sin la cadena de la llamada actual.
export function inventario({ tabla, fuente, claudePid, propioPid, ahoraMs }) {
  const porPid = new Map(tabla.map((p) => [p.pid, p]));
  const cadena = new Set(ancestros(porPid, propioPid));
  return tabla
    .filter((p) => p.ppid === claudePid && !cadena.has(p.pid))
    .sort((a, b) => a.inicioMs - b.inicioMs || a.pid - b.pid)
    .map((p) => ({
      pid: p.pid,
      pgid: p.pgid,
      inicio: new Date(p.inicioMs).toISOString().replace('.000Z', 'Z'),
      edad_s: Math.max(0, Math.floor((ahoraMs - p.inicioMs) / 1000)),
      ...clasificar(p, fuente.cmdline(p.pid)),
    }));
}
