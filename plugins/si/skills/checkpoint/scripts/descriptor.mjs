// Descriptor `## Entorno vivo` del CLAUDE.md del repo: fuentes de estado extra.
// Un comando solo corre si es un script del propio repo y no lleva nada que un
// shell interpretaría. Se ejecuta SIN shell, en paralelo, con 30 s por comando
// y un presupuesto total de 60 s: lo que no termine se reporta como tal.
import { spawn } from 'node:child_process';
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

const MAX_SALIDA = 1 << 20;
export const POR_COMANDO_MS = 30000;
export const PRESUPUESTO_MS = 60000;

function correr(argv, repo, { timeoutMs = POR_COMANDO_MS, signal } = {}) {
  return new Promise((resolve) => {
    let salida = '';
    let h;
    try {
      h = spawn(argv[0], argv.slice(1), { cwd: repo, signal, timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { resolve({ ok: false, salida: String(e.code ?? e.message) }); return; }
    const juntar = (b) => { if (salida.length < MAX_SALIDA) salida += b; };
    h.stdout.setEncoding('utf8').on('data', juntar);
    h.stderr.setEncoding('utf8').on('data', juntar);
    h.on('error', (e) => resolve({ ok: false, salida: e.name === 'AbortError' ? 'cancelado' : String(e.code ?? e.message) }));
    h.on('close', (code, sig) => resolve(sig
      ? { ok: false, salida: `${salida.trim()}\n(terminado por ${sig}: pasó los ${timeoutMs / 1000} s)`.trim() }
      : { ok: code === 0, salida: salida.trim() }));
  });
}

function acotar(texto) {
  const lineas = redactar(texto).split('\n');
  const corto = lineas.slice(0, MAX_LINEAS).join('\n');
  return corto.length > MAX_CHARS || lineas.length > MAX_LINEAS ? `${corto.slice(0, MAX_CHARS)}\n…(recortado)` : corto;
}

export async function resolverDescriptor(fuentes, { repo, coordinador = false, run = correr,
  presupuestoMs = PRESUPUESTO_MS, porComandoMs = POR_COMANDO_MS }) {
  const items = fuentes.filter((f) => coordinador || !f.coordinador).map((f) => {
    if (f.tipo === 'contexto') return { fuente: f.fuente, tipo: 'contexto', texto: f.texto };
    const v = comandoPermitido(f.comando);
    // El comando rechazado viene de un archivo ajeno: también se redacta.
    if (!v.ok) return { fuente: f.fuente, tipo: 'comando', comando: redactar(f.comando), ejecutado: false, motivo: v.motivo };
    return { fuente: f.fuente, tipo: 'comando', comando: f.comando, ejecutado: true, argv: v.argv };
  });
  const ac = new AbortController();
  const fin = new Set();
  const lanzadas = items.filter((i) => i.argv).map((i) => Promise.resolve(run(i.argv, repo, { timeoutMs: porComandoMs, signal: ac.signal }))
    .catch((e) => ({ ok: false, salida: String(e?.message ?? e) }))
    .then((r) => { i.ok = r.ok; i.salida = acotar(r.salida); fin.add(i); }));
  let reloj;
  const vencido = new Promise((res) => { reloj = setTimeout(() => res('vencido'), presupuestoMs); });
  const resultado = await Promise.race([Promise.all(lanzadas).then(() => 'listo'), vencido]);
  clearTimeout(reloj);
  if (resultado === 'vencido') ac.abort();
  for (const i of items) {
    if (i.argv && !fin.has(i)) { i.ok = false; i.salida = `(no terminó dentro del presupuesto de ${presupuestoMs / 1000} s)`; }
    delete i.argv;
  }
  return items;
}
