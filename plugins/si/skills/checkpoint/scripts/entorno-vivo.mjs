#!/usr/bin/env node
// Inventario vivo de una sesión de Claude Code para el handoff: procesos que
// cuelgan del claude propio, otras sesiones, estado git y fuentes del
// descriptor. Solo lee; lo único que mata es --detener <pid>.
// Salida: 0 limpio, 2 hay muertos/huérfanos/duplicados, 1 error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuenteDelSistema } from './fuentes.mjs';
import { encontrarClaude, datosClaude, dirSesiones, inventario, listarSesiones, sesionVigente } from './procesos.mjs';
import { estadoGit, ejecutar } from './git.mjs';
import { parseHandoff, verificar, hayHallazgos } from './verificar.mjs';
import { detener } from './detener.mjs';
import { parseDescriptor, resolverDescriptor } from './descriptor.mjs';
import { renderMarkdown } from './render.mjs';

const USO = `uso: entorno-vivo.mjs [--repo <ruta>]... [--json] [--verificar <handoff.md|->] [--desde <ISO>]
       [--descriptor <CLAUDE.md> [--coordinador]] [--detener <pid> [--inicio <ISO>]]`;
const CON_VALOR = new Set(['--repo', '--verificar', '--desde', '--detener', '--inicio', '--descriptor']);

export function parseArgs(argv) {
  const o = { repos: [], json: false, coordinador: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--coordinador') o.coordinador = true;
    else if (CON_VALOR.has(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} necesita un valor`);
      if (a === '--repo') o.repos.push(v);
      else o[a.slice(2)] = v;
    } else throw new Error(`argumento desconocido: ${a}`);
  }
  if (o.detener !== undefined && !/^\d+$/.test(o.detener)) throw new Error('--detener necesita un pid numérico');
  for (const k of ['desde', 'inicio']) {
    if (o[k] !== undefined && !Number.isFinite(Date.parse(o[k]))) throw new Error(`--${k} no es una fecha ISO`);
  }
  return o;
}

function toplevel(repo, d) {
  const r = d.run('git', ['-C', repo, 'rev-parse', '--show-toplevel']);
  if (!r.ok) return null;
  try { return d.io.realpathSync(r.salida.trim()); } catch { return null; }
}

function dentro(raiz, ruta) {
  const rel = path.relative(raiz, ruta);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export async function correr(argv, deps = {}) {
  const d = {
    fuente: deps.fuente === undefined ? fuenteDelSistema() : deps.fuente,
    ahora: deps.ahora ?? Date.now(),
    propioPid: deps.propioPid ?? process.pid,
    sesionesDir: deps.sesionesDir ?? dirSesiones(),
    run: deps.run ?? ejecutar,
    kill: deps.kill ?? process.kill.bind(process),
    io: deps.io ?? fs,
    cwd: deps.cwd ?? process.cwd(),
  };
  let o;
  try { o = parseArgs(argv); } catch (e) { return { codigo: 1, err: `${e.message}\n${USO}` }; }

  const tabla = d.fuente ? d.fuente.listar() : null;
  const porPid = new Map((tabla ?? []).map((p) => [p.pid, p]));
  const claudePid = tabla ? encontrarClaude(porPid, d.propioPid, { dir: d.sesionesDir, io: d.io }) : null;
  const procesos = () => inventario({ tabla, fuente: d.fuente, claudePid, propioPid: d.propioPid, ahoraMs: d.ahora });

  if (o.detener !== undefined) {
    if (!tabla) return { codigo: 1, err: 'sin inventario de procesos en esta plataforma: no se puede detener nada' };
    if (!claudePid) return { codigo: 1, err: 'no hay un claude ancestro: no se detiene nada' };
    const r = detener({ pid: Number(o.detener), inicioEsperado: o.inicio ? Date.parse(o.inicio) : null,
      claudePid, propioPid: d.propioPid, leerTabla: () => d.fuente.listar(), procesos, kill: d.kill });
    return r.ok ? { codigo: 0, out: `detenido el grupo ${r.grupo} (pid ${r.pid}) con SIGTERM` } : { codigo: 1, err: `no se detuvo: ${r.motivo}` };
  }

  let handoff = null;
  if (o.verificar) {
    try { handoff = parseHandoff(d.io.readFileSync(o.verificar === '-' ? 0 : o.verificar, 'utf8')); } catch (e) { return { codigo: 1, err: `no se pudo leer ${o.verificar}: ${e.code ?? e.message}` }; }
    if (!tabla || !claudePid) return { codigo: 1, err: 'verificar necesita el inventario de procesos y un claude ancestro' };
  }
  const desde = o.desde ? Date.parse(o.desde) : handoff?.desde;
  if (o.verificar && !Number.isFinite(desde)) return { codigo: 1, err: 'el handoff no trae la hora en «## ENTORNO VIVO (ISO)»: pásala con --desde' };

  // Con inventario, la sesión debe seguir siendo el mismo proceso (pid reciclado = sesión vieja).
  const vivo = (s) => {
    if (tabla) return sesionVigente(s, porPid.get(s.pid));
    try { process.kill(s.pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
  };
  const lista = tabla && claudePid ? procesos() : tabla ? [] : null;
  const repos = (o.repos.length ? o.repos : [d.cwd]).map((p) => path.resolve(d.cwd, p));
  const r = {
    generado: iso(d.ahora),
    claude: claudePid ? datosClaude(claudePid, d.sesionesDir, d.io, porPid.get(claudePid)) : null,
    procesos: lista,
    sesiones: listarSesiones(d.sesionesDir, d.io).filter((s) => s.pid !== claudePid && vivo(s))
      .map((s) => ({ pid: s.pid, name: s.name, status: s.status, tmux: s.tmux })),
    git: repos.map((p) => estadoGit(p, d.run)),
  };
  if (o.descriptor) {
    const top = toplevel(repos[0], d);
    const archivo = path.resolve(d.cwd, o.descriptor);
    let texto = null;
    let motivo = null;
    try {
      const real = d.io.realpathSync(archivo);
      if (!top) motivo = 'el repo no es un checkout git';
      else if (!dentro(top, real)) motivo = 'el CLAUDE.md no está dentro del repo (se cita, no se ejecuta)';
      else texto = d.io.readFileSync(real, 'utf8');
    } catch (e) { return { codigo: 1, err: `no se pudo leer ${o.descriptor}: ${e.code ?? e.message}` }; }
    if (texto != null) {
      r.descriptor = await resolverDescriptor(parseDescriptor(texto), { repo: top, coordinador: o.coordinador, run: deps.runDescriptor,
        ...(deps.presupuestoMs ? { presupuestoMs: deps.presupuestoMs } : {}) });
    } else r.descriptor_rechazado = motivo;
  }
  if (tabla === null) r.nota = 'sin inventario de procesos en esta plataforma';
  let codigo = 0;
  if (handoff) {
    r.verificacion = verificar({ filas: handoff.filas, desde, tabla, procesos: lista, claudePid });
    if (hayHallazgos(r.verificacion)) codigo = 2;
  }
  return { codigo, out: o.json ? JSON.stringify(r, null, 2) : renderMarkdown(r) };
}

const esPrincipal = () => {
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};

if (esPrincipal()) {
  let res;
  try { res = await correr(process.argv.slice(2)); } catch (e) { res = { codigo: 1, err: `error: ${e.message}` }; }
  // Termina con process.exit tras vaciar la salida: un nieto de un comando del
  // descriptor no debe retener la llamada.
  const salir = () => process.exit(res.codigo);
  if (res.err) process.stderr.write(`${res.err}\n`);
  if (res.out) process.stdout.write(`${res.out}\n`, salir);
  else salir();
}
