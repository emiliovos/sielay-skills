#!/usr/bin/env node
// Mide el contexto y el modelo de una sesión de Claude Code y de sus subagentes,
// leyendo el transcript local (~/.claude/projects/<proyecto>/<sesión>.jsonl).
// Contexto de un turno = input_tokens + cache_creation_input_tokens + cache_read_input_tokens.
//
// Uso: node medir-contexto.mjs [--sesion <id|ruta.jsonl>] [--desde <ISO>] [--hasta <ISO>] [--umbral <tokens>]
// Salida: JSON en stdout. Sin dependencias.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';

function parseArgs(argv) {
  const out = { umbral: 150000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`falta el valor de ${a}`);
      return v;
    };
    if (a === '--sesion') out.sesion = next();
    else if (a === '--desde') out.desde = Date.parse(next());
    else if (a === '--hasta') out.hasta = Date.parse(next());
    else if (a === '--umbral') out.umbral = Number(next());
    else if (a === '-h' || a === '--help') out.help = true;
    else throw new Error(`argumento desconocido: ${a}`);
  }
  for (const k of ['desde', 'hasta']) {
    if (k in out && Number.isNaN(out[k])) throw new Error(`--${k} no es una fecha ISO`);
  }
  if (!Number.isFinite(out.umbral) || out.umbral <= 0) throw new Error('--umbral debe ser un número positivo');
  return out;
}

const projectsDir = () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');

// Encuentra el transcript: ruta explícita, id de sesión (del flag o de CLAUDE_CODE_SESSION_ID)
// buscado en todas las carpetas de proyecto, o el más reciente del proyecto del cwd.
function findTranscript(sesion) {
  if (sesion && sesion.endsWith('.jsonl')) return existsSync(sesion) ? sesion : null;
  const id = sesion || process.env.CLAUDE_CODE_SESSION_ID;
  const root = projectsDir();
  if (!existsSync(root)) return null;
  if (id) {
    for (const p of readdirSync(root)) {
      const f = join(root, p, `${id}.jsonl`);
      if (existsSync(f)) return f;
    }
    return null;
  }
  const slug = process.cwd().replace(/[^a-zA-Z0-9]/g, '-');
  const dir = join(root, slug);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f: join(dir, f), t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (files[0]) console.error('medir-contexto.mjs: sin CLAUDE_CODE_SESSION_ID; uso el transcript más reciente del cwd, que puede ser de otra sesión (pasa --sesion)');
  return files[0]?.f || null;
}

function contextOf(usage) {
  if (!usage) return 0;
  return (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
}

// Recorre los turnos del asistente dentro de la ventana y devuelve máximo, último y modelos.
function measure(file, { desde, hasta }) {
  const seen = new Set();
  const res = { turnos: 0, contexto_max: 0, contexto_actual: 0, modelos: {}, inicio: null, fin: null };
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch { return res; }
  for (const line of raw.split('\n')) {
    if (!line.includes('"usage"')) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const msg = ev.message;
    if (ev.type !== 'assistant' || !msg?.usage) continue;
    const model = msg.model || 'desconocido';
    if (model === '<synthetic>') continue;
    const t = Date.parse(ev.timestamp);
    if (desde && !(t >= desde)) continue;
    if (hasta && !(t <= hasta)) continue;
    const ctx = contextOf(msg.usage);
    // Claude Code escribe una línea por bloque de contenido con el mismo message.id.
    const fresh = !msg.id || !seen.has(msg.id);
    if (msg.id) seen.add(msg.id);
    if (fresh) {
      res.turnos++;
      res.modelos[model] = (res.modelos[model] || 0) + 1;
    }
    res.contexto_actual = ctx;
    res.contexto_max = Math.max(res.contexto_max, ctx);
    if (!Number.isNaN(t)) {
      res.inicio ??= ev.timestamp;
      res.fin = ev.timestamp;
    }
  }
  return res;
}

// El modelo con más turnos; si hubo varios, se listan todos en `modelos`.
const mainModel = (modelos) => Object.entries(modelos).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

// Tabla «Modelo fijo por rol» de SKILL.md: familia esperada por tipo de agente.
const EXPECTED = {
  'fullstack-developer': 'sonnet', 'docs-manager': 'sonnet', debugger: 'sonnet',
  Explore: 'haiku', researcher: 'haiku', 'git-manager': 'haiku',
  'code-reviewer': 'opus', planner: 'opus',
};
const offTable = (s) => s.tipo in EXPECTED && !String(s.modelo).includes(EXPECTED[s.tipo]);

function readMeta(file) {
  try { return JSON.parse(readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { return {}; }
}

function subagents(transcript, window) {
  const dir = join(dirname(transcript), basename(transcript, '.jsonl'), 'subagents');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => {
    const file = join(dir, f);
    const m = measure(file, window);
    if (!m.turnos) return null;
    const meta = readMeta(file);
    return {
      agente: basename(f, '.jsonl'),
      tipo: meta.agentType || null,
      descripcion: meta.description || null,
      modelo: mainModel(m.modelos),
      modelos: m.modelos,
      contexto_max: m.contexto_max,
      turnos: m.turnos,
      inicio: m.inicio,
      fin: m.fin,
    };
  }).filter(Boolean).sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
}

function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) {
    console.error(`medir-contexto.mjs: ${e.message}`);
    process.exit(2);
  }
  if (args.help) {
    console.log('node medir-contexto.mjs [--sesion <id|ruta.jsonl>] [--desde <ISO>] [--hasta <ISO>] [--umbral <tokens>]');
    return;
  }
  const transcript = findTranscript(args.sesion);
  if (!transcript) {
    console.error('medir-contexto.mjs: no encontré el transcript de la sesión (pasa --sesion <id|ruta>)');
    process.exit(1);
  }
  const window = { desde: args.desde, hasta: args.hasta };
  const m = measure(transcript, window);
  const subs = subagents(transcript, window);
  console.log(JSON.stringify({
    sesion: basename(transcript, '.jsonl'),
    modelo: mainModel(m.modelos),
    modelos: m.modelos,
    contexto_actual: m.contexto_actual,
    contexto_max: m.contexto_max,
    turnos: m.turnos,
    umbral: args.umbral,
    cortar: m.contexto_actual >= args.umbral,
    subagentes: subs,
    subagentes_fuera_de_tabla: subs.filter(offTable).map((s) => ({ agente: s.agente, tipo: s.tipo, modelo: s.modelo, esperado: EXPECTED[s.tipo] })),
  }, null, 2));
}

main();
