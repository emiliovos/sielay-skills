#!/usr/bin/env node
// Checkpoint ligero: cierra una terminal sin trabajo abierto con una sola llamada.
// Comprueba el entorno y, solo si está limpio, agrega el reporte y deja un handoff
// corto en lugar del anterior. Falla cerrado: un dato que falta cuenta como abierto.
// Salida: 0 cerrado, 1 error, 2 hay trabajo abierto (no escribió nada; usa el checkpoint normal).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { correr } from './entorno-vivo.mjs';
import { ejecutar } from './git.mjs';
import { agregarAlArchivo, reportar } from './reporte.mjs';

const USO = 'uso: ligero.mjs --terminal <nombre> --encargo-cerrado [--repo <ruta>]... [--descriptor <CLAUDE.md>] [--ahora <ISO>] < cuerpo.md';
const NOMBRE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// La status line de Claude Code es hija directa del claude y vive un instante.
const STATUS_LINE = /statusline/i;
const STATUS_LINE_MAX_S = 10;

export function parseArgs(argv) {
  const o = { repos: [], encargoCerrado: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--encargo-cerrado') { o.encargoCerrado = true; continue; }
    if (!['--terminal', '--repo', '--descriptor', '--ahora'].includes(a)) throw new Error(`argumento desconocido: ${a}`);
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) throw new Error(`${a} necesita un valor`);
    if (a === '--repo') o.repos.push(v);
    else o[a.slice(2)] = v;
  }
  if (!o.terminal) throw new Error('falta --terminal');
  if (!NOMBRE.test(o.terminal)) throw new Error(`nombre de terminal inválido: «${o.terminal}»`);
  if (o.ahora !== undefined && !Number.isFinite(Date.parse(o.ahora))) throw new Error('--ahora no es una fecha ISO');
  return o;
}

// Commits de la rama que aún no llegan a master: empujados sin PR tampoco están cerrados.
function fueraDeOrigen(repo, run) {
  const r = run('git', ['-C', repo, 'rev-list', '--count', 'origin/HEAD..HEAD']);
  const n = r.ok ? Number(r.salida.trim()) : NaN;
  return Number.isInteger(n) ? n : null;
}

// Lista de motivos por los que la terminal no está libre; vacía si se puede cerrar.
export function motivosAbierto(estado, { run = ejecutar } = {}) {
  const m = [];
  if (!estado.claude) m.push('no se identificó el proceso de claude');
  if (estado.procesos === null || estado.procesos === undefined) m.push('sin inventario de procesos');
  for (const p of estado.procesos ?? []) {
    if (p.tipo === 'otro' || (STATUS_LINE.test(p.comando) && p.edad_s <= STATUS_LINE_MAX_S)) continue;
    m.push(`proceso vivo: pid ${p.pid} ${p.comando}`);
  }
  if (!estado.git?.length) m.push('sin estado de git');
  for (const g of estado.git ?? []) {
    if (g.error) { m.push(`${g.repo}: ${g.error}`); continue; }
    if (!g.estado_ok) m.push(`${g.repo}: no se pudo leer git status`);
    if (g.sucio_total > 0) m.push(`${g.repo}: ${g.sucio_total} sin commit`);
    if (g.adelante === null || g.adelante === undefined) m.push(`${g.repo}: no se pudo contar lo que falta por empujar`);
    else if (g.adelante > 0) m.push(`${g.repo}: ${g.adelante} sin push`);
    const fuera = fueraDeOrigen(g.repo, run);
    if (fuera === null) m.push(`${g.repo}: no se pudo comparar con origin/HEAD`);
    else if (fuera > 0) m.push(`${g.repo}: ${fuera} commits fuera de origin/HEAD`);
    if (!g.rama) m.push(`${g.repo}: rama desconocida`);
    if (!Array.isArray(g.prs)) m.push(`${g.repo}: no se pudo consultar los PRs`);
    for (const p of (g.prs ?? []).filter((x) => x.rama === g.rama)) m.push(`${g.repo}: PR #${p.n} abierto en ${g.rama}`);
  }
  return m;
}

export function textoHandoff({ terminal, ahora, reporte, git }) {
  const ramas = git.map((g) => `${g.repo} ${g.rama}`).join(', ');
  return [
    `# ${terminal} · sin trabajo abierto (checkpoint ligero)`,
    `Nada que retomar: espera encargo nuevo. Reporte: ${reporte}. Git limpio: ${ramas}.`,
    `## ENTORNO VIVO (${ahora})`,
    '',
  ].join('\n');
}

// El handoff anterior queda como <terminal>.anterior.md: si el cierre fue un error, se recupera.
export function dejarHandoff({ terminal, texto, home }) {
  const dir = path.join(home, 'handoffs');
  fs.mkdirSync(dir, { recursive: true });
  const ruta = path.join(dir, `${terminal}.md`);
  const nuevo = `${ruta}.${process.pid}.tmp`;
  fs.writeFileSync(nuevo, texto, { mode: 0o600, flag: 'wx' });
  if (fs.existsSync(ruta)) fs.renameSync(ruta, path.join(dir, `${terminal}.anterior.md`));
  fs.renameSync(nuevo, ruta);
  return ruta;
}

export async function cerrar(argv, deps = {}) {
  const d = { correr, run: ejecutar, home: os.homedir(), host: os.hostname(), escribir: agregarAlArchivo, ...deps };
  const o = parseArgs(argv);
  if (!o.encargoCerrado) {
    return { codigo: 2, salida: 'abierto: falta --encargo-cerrado (declara que el encargo terminó y no quedan crons ni conversaciones de link pendientes)' };
  }
  const vivo = await d.correr(['--json', ...o.repos.flatMap((r) => ['--repo', r])]);
  if (vivo.codigo !== 0) throw new Error(vivo.err ?? 'el entorno vivo falló');
  const estado = JSON.parse(vivo.out);
  const motivos = motivosAbierto(estado, { run: d.run });
  if (motivos.length) return { codigo: 2, salida: `abierto: usa el checkpoint normal\n${motivos.map((m) => `- ${m}`).join('\n')}` };

  const ahoraMs = o.ahora ? Date.parse(o.ahora) : Date.now();
  const r = reportar({
    cuerpo: d.cuerpo ?? fs.readFileSync(0, 'utf8'),
    terminal: o.terminal,
    descriptor: o.descriptor ? fs.readFileSync(o.descriptor, 'utf8') : '',
    ahoraMs,
    host: d.host,
    home: d.home,
    escribir: d.escribir,
  });
  const ruta = dejarHandoff({
    terminal: o.terminal,
    home: d.home,
    texto: textoHandoff({ terminal: o.terminal, ahora: new Date(ahoraMs).toISOString(), reporte: r.ruta ?? r.direccion ?? 'no', git: estado.git }),
  });
  return { codigo: 0, salida: `handoff: ${ruta}\n${r.mensaje}` };
}

const esPrincipal = () => {
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};

if (esPrincipal()) {
  let res;
  try { res = await cerrar(process.argv.slice(2)); } catch (e) { res = { codigo: 1, err: `ligero: ${e.message}\n${USO}` }; }
  const salir = () => process.exit(res.codigo);
  if (res.err) process.stderr.write(`${res.err}\n`);
  if (res.salida) process.stdout.write(`${res.salida}\n`, salir);
  else salir();
}
