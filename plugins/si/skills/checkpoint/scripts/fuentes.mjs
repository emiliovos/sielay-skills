// Tabla de procesos por plataforma. Cada fuente devuelve
//   { plataforma, listar(): [{pid, ppid, pgid, inicioMs, comm}], cmdline(pid): string|null }
// y se puede inyectar para probar sin el sistema real.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const CLK_TCK = 100; // USER_HZ de Linux: 100 en todas las arquitecturas comunes

// /proc/<pid>/stat: "pid (comm) estado ppid pgrp ...". El comm puede traer
// espacios y paréntesis, así que se corta en el ÚLTIMO ')'. Después de él,
// el campo 3 (estado) es el índice 0, de modo que el 22 (starttime) es el 19.
export function parseStat(texto) {
  const fin = texto.lastIndexOf(')');
  const ini = texto.indexOf('(');
  if (fin < 0 || ini < 0) return null;
  const campos = texto.slice(fin + 2).trim().split(/\s+/);
  const pid = parseInt(texto, 10);
  const ppid = Number(campos[1]);
  const pgid = Number(campos[2]);
  const ticks = Number(campos[19]);
  if (![pid, ppid, pgid, ticks].every(Number.isFinite)) return null;
  return { pid, ppid, pgid, ticks, comm: texto.slice(ini + 1, fin) };
}

export function parseBtime(procStat) {
  const m = /^btime\s+(\d+)/m.exec(procStat);
  return m ? Number(m[1]) : null;
}

export function parseCmdline(crudo) {
  return crudo.replace(/\0$/, '').split('\0').join(' ').trim();
}

export function fuenteLinux(io = fs) {
  let btime = null;
  const leer = (p) => { try { return io.readFileSync(p, 'utf8'); } catch { return null; } };
  return {
    plataforma: 'linux',
    listar() {
      btime ??= parseBtime(leer('/proc/stat') ?? '');
      if (btime == null) throw new Error('no se pudo leer btime de /proc/stat');
      const out = [];
      for (const nombre of io.readdirSync('/proc')) {
        if (!/^\d+$/.test(nombre)) continue;
        const txt = leer(`/proc/${nombre}/stat`);
        const s = txt && parseStat(txt);
        if (!s) continue; // el proceso murió entre el listado y la lectura
        out.push({ pid: s.pid, ppid: s.ppid, pgid: s.pgid, comm: s.comm, ticks: s.ticks,
          inicioMs: Math.floor(btime + s.ticks / CLK_TCK) * 1000 });
      }
      return out;
    },
    cmdline(pid) {
      const crudo = leer(`/proc/${pid}/cmdline`);
      return crudo == null ? null : parseCmdline(crudo);
    },
  };
}

// ps -A -o pid=,ppid=,pgid=,lstart=,command= (macOS). lstart ocupa 5 campos:
// "Mon Oct 26 19:21:19 2026", en hora local.
const LINEA_PS = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.*)$/;

export function parsePs(texto) {
  const out = [];
  for (const linea of texto.split('\n')) {
    const m = LINEA_PS.exec(linea);
    if (!m) continue;
    const inicioMs = Date.parse(m[4].replace(/\s+/g, ' '));
    if (!Number.isFinite(inicioMs)) continue;
    const comando = m[5];
    out.push({ pid: +m[1], ppid: +m[2], pgid: +m[3], inicioMs, cmdline: comando,
      comm: path.basename(comando.split(/\s+/)[0]) });
  }
  return out;
}

// -ww: sin recorte de línea (el envoltorio de Bash es largo). LC_ALL=C: lstart
// en inglés y con formato fijo, sea cual sea el idioma del sistema.
export const PS_ARGS = ['-ww', '-A', '-o', 'pid=,ppid=,pgid=,lstart=,command='];

export function fuenteMac(ejecutar = (cmd, args, opts) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 10000, maxBuffer: 64 * 1024 * 1024, ...opts })) {
  let cache = null;
  const cargar = () => (cache ??= parsePs(ejecutar('ps', PS_ARGS, { env: { ...process.env, LC_ALL: 'C' } })));
  return {
    plataforma: 'darwin',
    listar: () => cargar().map(({ cmdline, ...resto }) => resto),
    cmdline: (pid) => cargar().find((p) => p.pid === pid)?.cmdline ?? null,
  };
}

// null: plataforma sin inventario (el script sale con 0 y lo avisa).
export function fuenteDelSistema(plataforma = process.platform) {
  if (plataforma === 'linux') return fuenteLinux();
  if (plataforma === 'darwin') return fuenteMac();
  return null;
}
