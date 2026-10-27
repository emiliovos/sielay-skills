// Inventario de los procesos que cuelgan del claude propio.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redactar, recortar } from './redactar.mjs';

export const SIN_COMANDO = '(no legible)';
const INICIO_EVAL = "|| true && eval '";
const ENVOLTORIO = /^(?:\S*\/)?bash -c source \S*snapshot/;

// El envoltorio de cada llamada Bash del claude es
//   bash -c source <snapshot> && <preámbulo de exports> && eval '<comando>' && pwd -P >| <archivo>
// El comando real es lo que va dentro de eval '…', con cada comilla simple
// original escapada como '"'"'. Nunca se devuelve el preámbulo.
export function extraerComando(cmdline) {
  if (!ENVOLTORIO.test(cmdline)) return null;
  // Ancla en el cierre del propio envoltorio (`|| true && eval '`), no en un
  // `eval '` cualquiera: el primero que aparece es el del envoltorio, porque
  // un comando de usuario viene después y lleva sus comillas escapadas.
  const ini = cmdline.indexOf(INICIO_EVAL);
  if (ini < 0) return null;
  const cuerpo = cmdline.slice(ini + INICIO_EVAL.length);
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

// Un sessions/<pid>.json sobrevive a su proceso: solo vale si el proceso que
// hoy tiene ese pid es el mismo que lo escribió. Linux compara `procStart` con
// el campo 22 de stat; macOS compara `startedAt` con el lstart: el
// archivo se escribe poco después de arrancar, así que solo vale una diferencia
// de 0 a 15 s (lstart se trunca al segundo y la sesión tarda en escribirlo).
export function sesionVigente(sesion, rec) {
  if (!sesion || !rec) return false;
  if (rec.ticks != null && sesion.procStart != null) return String(rec.ticks) === String(sesion.procStart);
  if (sesion.startedAt != null) {
    const dif = Number(sesion.startedAt) - rec.inicioMs;
    return dif >= 0 && dif <= 15000;
  }
  return false;
}

export function listarSesiones(dir, io = fs) {
  let nombres;
  try { nombres = io.readdirSync(dir); } catch { return []; }
  return nombres.filter((n) => /^\d+\.json$/.test(n)).map((n) => leerSesion(dir, parseInt(n, 10), io))
    .filter((s) => s && Number.isInteger(s.pid));
}

// claude = ancestro más cercano con comm `claude` o con un sessions/<pid>.json vigente.
export function encontrarClaude(porPid, desdePid, { dir, io = fs } = {}) {
  for (const pid of ancestros(porPid, desdePid)) {
    if (pid === desdePid) continue;
    const rec = porPid.get(pid);
    if (rec.comm === 'claude') return pid;
    if (dir && sesionVigente(leerSesion(dir, pid, io), rec)) return pid;
  }
  return null;
}

export function datosClaude(pid, dir, io = fs, rec = null) {
  const s = leerSesion(dir, pid, io);
  if (!s || (rec && !sesionVigente(s, rec))) return { pid };
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
