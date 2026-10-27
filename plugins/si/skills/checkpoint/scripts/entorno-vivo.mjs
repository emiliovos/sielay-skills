#!/usr/bin/env node
// Inventario vivo de una sesión de Claude Code para el handoff: procesos que
// cuelgan del claude propio, otras sesiones, estado git y fuentes del
// descriptor. Solo lee; lo único que mata es --detener <pid>.
// Salida: 0 limpio, 2 hay muertos/huérfanos/duplicados, 1 error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuenteDelSistema } from './fuentes.mjs';
import { encontrarClaude, datosClaude, dirSesiones, inventario, listarSesiones } from './procesos.mjs';
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

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export function correr(argv, deps = {}) {
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
  const claudePid = tabla ? encontrarClaude(new Map(tabla.map((p) => [p.pid, p])), d.propioPid, { dir: d.sesionesDir, io: d.io }) : null;
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

  const vivo = (pid) => {
    if (tabla) return tabla.some((p) => p.pid === pid);
    try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
  };
  const lista = tabla && claudePid ? procesos() : tabla ? [] : null;
  const repos = (o.repos.length ? o.repos : [d.cwd]).map((p) => path.resolve(d.cwd, p));
  const r = {
    generado: iso(d.ahora),
    claude: claudePid ? datosClaude(claudePid, d.sesionesDir, d.io) : null,
    procesos: lista,
    sesiones: listarSesiones(d.sesionesDir, d.io).filter((s) => s.pid !== claudePid && vivo(s.pid))
      .map((s) => ({ pid: s.pid, name: s.name, status: s.status, tmux: s.tmux })),
    git: repos.map((p) => estadoGit(p, d.run)),
  };
  if (o.descriptor) {
    try {
      r.descriptor = resolverDescriptor(parseDescriptor(d.io.readFileSync(o.descriptor, 'utf8')), { repo: repos[0], coordinador: o.coordinador, run: deps.runDescriptor });
    } catch (e) { return { codigo: 1, err: `no se pudo leer ${o.descriptor}: ${e.code ?? e.message}` }; }
  }
  if (tabla === null) r.nota = 'sin inventario de procesos en esta plataforma';
  let codigo = 0;
  if (handoff) {
    r.verificacion = verificar({ filas: handoff.filas, desde, tabla, procesos: lista });
    if (hayHallazgos(r.verificacion)) codigo = 2;
  }
  return { codigo, out: o.json ? JSON.stringify(r, null, 2) : renderMarkdown(r) };
}

const esPrincipal = () => {
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};

if (esPrincipal()) {
  let res;
  try { res = correr(process.argv.slice(2)); } catch (e) { res = { codigo: 1, err: `error: ${e.message}` }; }
  if (res.out) process.stdout.write(`${res.out}\n`);
  if (res.err) process.stderr.write(`${res.err}\n`);
  process.exitCode = res.codigo;
}
