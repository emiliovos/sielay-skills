// Descriptor `## Entorno vivo` del CLAUDE.md del repo: fuentes de estado extra.
// Un comando solo corre si es un script del propio repo y no lleva nada que un
// shell interpretaría. Se ejecuta SIN shell, con timeout de 30 s.
import { spawnSync } from 'node:child_process';
import { redactar } from './redactar.mjs';

const PREFIJO = /^(?:node scripts\/|bash scripts\/|\.\/scripts\/)/;
const PROHIBIDO = /[|;&`<>'"\\\n\r]|\$\(|\$\{/;
const SUBIDA = /(?:^|[/\s])\.\.(?:[/\s]|$)/;
const MAX_LINEAS = 20;
const MAX_CHARS = 1500;

export function comandoPermitido(cmd) {
  const c = String(cmd).trim();
  if (!PREFIJO.test(c)) return { ok: false, motivo: 'solo se corren node scripts/…, bash scripts/… o ./scripts/…' };
  if (PROHIBIDO.test(c)) return { ok: false, motivo: 'lleva metacaracteres de shell (| ; & $( ` > < comillas o \\)' };
  if (SUBIDA.test(c)) return { ok: false, motivo: 'sale de la carpeta del repo con ..' };
  return { ok: true, argv: c.split(/\s+/) };
}

export function parseDescriptor(texto) {
  const lineas = texto.split('\n');
  const ini = lineas.findIndex((l) => /^##\s+Entorno vivo\s*$/i.test(l));
  if (ini < 0) return [];
  const fuentes = [];
  for (const l of lineas.slice(ini + 1)) {
    if (/^##\s/.test(l)) break;
    const m = /^\s*-\s+([a-z][a-z0-9-]*):\s+(.*?)\s*$/.exec(l);
    if (!m) continue;
    let resto = m[2];
    const coordinador = /\s*\(coordinador\)\s*$/i.test(resto);
    resto = resto.replace(/\s*\(coordinador\)\s*$/i, '');
    const cmd = /^`([^`]+)`$/.exec(resto);
    const ctx = /^contexto\s*[—-]\s*(.+)$/i.exec(resto);
    if (cmd) fuentes.push({ fuente: m[1], tipo: 'comando', comando: cmd[1], coordinador });
    else if (ctx) fuentes.push({ fuente: m[1], tipo: 'contexto', texto: ctx[1], coordinador });
  }
  return fuentes;
}

function correr(argv, repo) {
  const r = spawnSync(argv[0], argv.slice(1), { cwd: repo, timeout: 30000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error) return { ok: false, salida: r.error.code === 'ETIMEDOUT' ? 'timeout de 30 s' : String(r.error.code ?? r.error.message) };
  return { ok: r.status === 0, salida: (r.stdout || r.stderr || '').trim() };
}

function acotar(texto) {
  const lineas = redactar(texto).split('\n');
  const corto = lineas.slice(0, MAX_LINEAS).join('\n');
  return corto.length > MAX_CHARS || lineas.length > MAX_LINEAS ? `${corto.slice(0, MAX_CHARS)}\n…(recortado)` : corto;
}

export function resolverDescriptor(fuentes, { repo, coordinador = false, run = correr }) {
  return fuentes.filter((f) => coordinador || !f.coordinador).map((f) => {
    if (f.tipo === 'contexto') return { fuente: f.fuente, tipo: 'contexto', texto: f.texto };
    const v = comandoPermitido(f.comando);
    if (!v.ok) return { fuente: f.fuente, tipo: 'comando', comando: f.comando, ejecutado: false, motivo: v.motivo };
    const r = run(v.argv, repo);
    return { fuente: f.fuente, tipo: 'comando', comando: f.comando, ejecutado: true, ok: r.ok, salida: acotar(r.salida) };
  });
}
