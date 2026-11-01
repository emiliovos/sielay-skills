#!/usr/bin/env node
// Rutas y escritura de la skill mejora-continua. Subcomandos:
//   ruta     [--dia AAMMDD] [--descriptor <CLAUDE.md>] [--ahora <ISO>]   imprime JSON {dia, bitacora, reporte}
//   arreglo  [--dia AAMMDD] [...] < datos.json   JSON por stdin: {clave, que, donde, porque, como, evidencia?, tipo?}
//   reporte  --build <id> [--dia AAMMDD] [...] < cuerpo.md   (agrega el bloque, sin borrar lo anterior)
// Solo escribe en la bitácora y en el archivo de reporte que declara el CLAUDE.md del repo, dentro del home.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TERMINAL = 'mejora-continua';
const MAX = { que: 160, donde: 160, porque: 300, como: 300, evidencia: 300 };

function seccion(texto) {
  const l = String(texto ?? '').split('\n');
  const ini = l.findIndex((x) => /^##\s+Cierre de sesión\s*$/i.test(x));
  if (ini < 0) return [];
  const fin = l.findIndex((x, i) => i > ini && /^##\s/.test(x));
  return l.slice(ini + 1, fin < 0 ? undefined : fin);
}
function linea(lineas, nombre) {
  const hits = lineas.map((x) => new RegExp(`^-\\s+${nombre}:\\s*(.*?)\\s*$`, 'i').exec(x)).filter(Boolean);
  if (hits.length > 1) throw new Error(`la línea ${nombre} aparece dos veces`);
  return hits[0] ? hits[0][1] : null;
}
// «<ruta>; corte HH:MM <zona>» → { ruta, corte, zona }
const CORTE = /^corte\s+(\d{1,2}):(\d{2})(?:\s+([A-Za-z_]+(?:\/[A-Za-z_+-]+)+|UTC))?(?:\s.*)?$/;
export function parteDe(valor) {
  if (valor === null) return null;
  const [ruta, ...resto] = valor.split(';').map((p) => p.trim()).filter(Boolean);
  if (!ruta || ruta.toLowerCase() === 'no') return null;
  const r = { ruta };
  for (const p of resto) {
    if (!/^corte\b/i.test(p)) continue;
    const m = CORTE.exec(p);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`parte de corte que no se entiende: «${p}»`);
    if (r.corte) throw new Error('el corte aparece dos veces');
    r.corte = { h: Number(m[1]), m: Number(m[2]) };
    if (m[3]) {
      try { new Intl.DateTimeFormat('en', { timeZone: m[3] }); } catch { throw new Error(`zona desconocida: «${m[3]}»`); }
      r.zona = m[3];
    }
  }
  return r;
}
export function reloj(ms, zona) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}
// Día de reporte de ese momento: desde el corte cuenta el día siguiente (el que se lee esa mañana).
export function diaDelReporte(ms, { corte, zona } = {}) {
  const r = reloj(ms, zona);
  const sumar = corte && r.h * 60 + r.mi >= corte.h * 60 + corte.m ? 1 : 0;
  const d = new Date(Date.UTC(r.y, r.mo - 1, r.d + sumar));
  const dos = (n) => String(n).padStart(2, '0');
  return `${dos(d.getUTCFullYear() % 100)}${dos(d.getUTCMonth() + 1)}${dos(d.getUTCDate())}`;
}
export function resolverRuta(plantilla, dia, home) {
  const r = plantilla.replaceAll('{AAMMDD}', dia).replaceAll('{terminal}', TERMINAL);
  if (r.split(/[\\/]/).some((t) => t.startsWith('.'))) throw new Error('la ruta no puede llevar .. ni partes ocultas');
  const abs = r.startsWith('~/') ? path.join(home, r.slice(1)) : r;
  if (!path.isAbsolute(abs) || !abs.startsWith(path.join(home, path.sep))) throw new Error('la ruta debe estar dentro del home');
  return abs;
}
export function resolver(descriptor, { dia, ahoraMs, home }) {
  const sec = seccion(descriptor);
  const anom = parteDe(linea(sec, 'Anomal[ií]as'));
  const rep = parteDe(linea(sec, 'Reporte'));
  const dato = anom ?? rep;
  if (!dato) return null;
  const d = dia ?? diaDelReporte(ahoraMs, anom?.corte ? anom : rep ?? {});
  if (!/^\d{6}$/.test(d)) throw new Error(`día inválido: «${d}»`);
  const reporte = rep ? resolverRuta(rep.ruta, d, home) : null;
  const bitacora = anom
    ? resolverRuta(anom.ruta, d, home)
    : path.join(path.dirname(reporte), 'anomalias.jsonl');
  return { dia: d, bitacora, reporte };
}

const dentro = (raiz, d) => d === raiz || d.startsWith(raiz + path.sep);
function abrirAgregando(ruta, home) {
  const raiz = fs.realpathSync(home);
  let existente = path.dirname(ruta);
  while (!fs.existsSync(existente)) existente = path.dirname(existente);
  if (!dentro(raiz, fs.realpathSync(existente))) throw new Error(`la carpeta sale del home: ${existente}`);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  if (!dentro(raiz, fs.realpathSync(path.dirname(ruta)))) throw new Error(`la carpeta sale del home: ${path.dirname(ruta)}`);
  const k = fs.constants;
  return fs.openSync(ruta, k.O_WRONLY | k.O_APPEND | k.O_CREAT | (k.O_NOFOLLOW ?? 0), 0o600);
}
function agregar(ruta, texto, home) {
  const fd = abrirAgregando(ruta, home);
  try { fs.writeSync(fd, texto); } finally { fs.closeSync(fd); }
}
// Lock «ruta.lock» (creación exclusiva): reintento corto; uno de más de 30 s es viejo.
function conLock(ruta, home, fn) {
  const lock = `${ruta}.lock`;
  fs.closeSync(abrirAgregando(ruta, home)); // verifica la carpeta antes de crear el lock
  let fd;
  for (let i = 0; i < 60 && fd === undefined; i++) {
    try { fd = fs.openSync(lock, 'wx', 0o600); } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 30000) fs.unlinkSync(lock); } catch { /* otro lo soltó */ }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  if (fd === undefined) throw new Error(`no pude tomar el lock de la bitácora: ${lock}`);
  try { return fn(); } finally { fs.closeSync(fd); try { fs.unlinkSync(lock); } catch { /* ya no está */ } }
}
// Solo cuenta la línea de esta skill: la de otra fuente no cierra un bug_escapado, que aún espera su check.
function yaEsta(ruta, clave) {
  let txt = '';
  try { txt = fs.readFileSync(ruta, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return txt.split('\n').some((l) => { try { const o = JSON.parse(l); return o.clave === clave && o.fuente === TERMINAL; } catch { return false; } });
}
// Una sola línea sin caracteres de control ni secuencias ANSI, recortada.
const limpiar = (s, max) => String(s ?? '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/[\p{Cc}\p{Cf}]+/gu, ' ').trim().slice(0, max);

export const CLAVE = /^[\w.:@/-]{1,200}$/;
export function lineaArreglo(a, ahoraMs) {
  if (typeof a?.clave !== 'string' || !CLAVE.test(a.clave)) throw new Error('clave inválida: usa [A-Za-z0-9_.:@/-], de 1 a 200');
  const tipo = a.tipo === undefined ? 'otro' : String(a.tipo);
  if (!/^[\w-]{1,40}$/.test(tipo)) throw new Error('tipo inválido');
  const o = {
    ts: new Date(ahoraMs).toISOString(), fuente: TERMINAL, tipo,
    clave: `${a.clave.replace(/:arreglo$/, '')}:arreglo`,
    que: limpiar(a.que, MAX.que), donde: limpiar(a.donde, MAX.donde), porque: limpiar(a.porque, MAX.porque),
    causa: 'probada', arreglado: true, como: limpiar(a.como, MAX.como) || null, evidencia: limpiar(a.evidencia, MAX.evidencia) || null,
  };
  if (!o.que || !o.como) throw new Error('faltan «que» y «como»');
  return o;
}
const limpiarCuerpo = (s) => String(s ?? '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/[^\P{Cc}\n\t]|\p{Cf}/gu, '');
export function bloque(cuerpo, build, ahoraMs, zona) {
  const c = limpiarCuerpo(cuerpo);
  const faltan = ['Hecho', 'Quedó', 'Retro'].filter((s) => !new RegExp(`^- ${s}:`, 'm').test(c));
  if (faltan.length) throw new Error(`al bloque le falta: ${faltan.join(', ')}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(build ?? '')) throw new Error('--build inválido');
  const r = reloj(ahoraMs, zona);
  const hora = `${String(r.h).padStart(2, '0')}:${String(r.mi).padStart(2, '0')}`;
  return `## ${hora} · ${build}\n${c.trim()}\n`;
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error(`argumento inesperado: ${argv[i]}`);
    o[argv[i].slice(2)] = argv[i + 1];
  }
  return o;
}
function main() {
  const [cmd, ...resto] = process.argv.slice(2);
  const a = args(resto);
  const home = os.homedir();
  const ahoraMs = a.ahora ? Date.parse(a.ahora) : Date.now();
  const desc = fs.readFileSync(a.descriptor ?? 'CLAUDE.md', 'utf8');
  const rutas = resolver(desc, { dia: a.dia, ahoraMs, home });
  if (cmd === 'ruta') { console.log(JSON.stringify(rutas)); return; }
  if (!rutas) throw new Error('el CLAUDE.md no declara «Anomalías» ni «Reporte»');
  if (cmd === 'arreglo') {
    let datos;
    try { datos = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { throw new Error('stdin debe ser un JSON {clave, que, donde, porque, como, evidencia?, tipo?}'); }
    const o = lineaArreglo(datos, ahoraMs);
    const agregada = conLock(rutas.bitacora, home, () => {
      if (yaEsta(rutas.bitacora, o.clave)) return false;
      agregar(rutas.bitacora, `${JSON.stringify(o)}\n`, home);
      return true;
    });
    console.log(agregada ? `agregada: ${rutas.bitacora}` : 'ya estaba');
  } else if (cmd === 'reporte') {
    if (!rutas.reporte) throw new Error('el CLAUDE.md no declara «Reporte»: no hay dónde dejar el bloque');
    const zona = parteDe(linea(seccion(desc), 'Reporte'))?.zona;
    agregar(rutas.reporte, bloque(fs.readFileSync(0, 'utf8'), a.build, ahoraMs, zona), home);
    console.log(`agregado: ${rutas.reporte}`);
  } else throw new Error('uso: bitacora.mjs ruta|arreglo|reporte [--opcion valor]…');
}
// Node resuelve los symlinks del script principal en import.meta.url, no en
// argv[1]: sin realpath en los dos lados, llamado por un enlace no haría nada.
const esPrincipal = () => {
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};

if (esPrincipal()) {
  try { main(); } catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
}
