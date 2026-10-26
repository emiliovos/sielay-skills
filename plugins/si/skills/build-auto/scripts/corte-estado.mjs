// Estado del corte de contexto: carpeta, archivos por pane o sesión, activación,
// detección del gancho y bitácora. Lo usan corte-contexto.mjs y limpiar-terminal.mjs.
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

export const DIR = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'si-build-auto', 'corte');
const VIGENCIA_MS = 24 * 3600 * 1000;

const limpio = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');

// Una ruta con saltos de línea o escapes rompería el prompt que se teclea por tmux.
export const conControl = (s) => [...String(s)].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

export function leer(f) { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } }
export function escribir(f, v) {
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(v));
  renameSync(tmp, f);
}
export function bitacora(evento, datos) {
  try {
    mkdirSync(DIR, { recursive: true });
    appendFileSync(join(DIR, 'bitacora.log'), `${new Date().toISOString()} ${evento} ${JSON.stringify(datos)}\n`);
  } catch { /* la bitácora nunca rompe el gancho */ }
}

// En tmux todo va por pane: sobrevive al /clear, que cambia el id de sesión de Claude.
// Sin tmux, por sesión.
const clave = (sesion) => (process.env.TMUX_PANE ? `pane${limpio(process.env.TMUX_PANE)}` : `ses${limpio(sesion)}`);
export const archivoActivo = (sesion) => join(DIR, 'activos', `${clave(sesion)}.json`);
export const archivoEstado = (sesion) => join(DIR, 'sesiones', `${clave(sesion)}.json`);
export { clave };

// tmux reusa los ids de pane (%3) al reiniciar el servidor; la sesión de tmux y el pid
// del pane distinguen el pane que se activó de uno nuevo con el mismo id.
export function idPane(pane = process.env.TMUX_PANE) {
  if (!pane) return null;
  try {
    return execFileSync('tmux', ['display-message', '-p', '-t', pane, '#{session_id} #{pane_pid}'],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).toString().trim() || null;
  } catch { return null; }
}

// El build activo de la sesión: la variable de una terminal abierta por build-auto o el
// marcador de `--activar`, del mismo pane y sin vencer. `refrescar` corre la vigencia.
export function buildActivo(sesion, { refrescar = false } = {}) {
  if (process.env.SI_BUILD_CORTE) return process.env.SI_BUILD_CORTE;
  const f = archivoActivo(sesion);
  const m = leer(f);
  if (!m || Date.now() - m.desde >= VIGENCIA_MS) return null;
  if (m.pane && m.pane !== idPane()) return null;
  if (refrescar) escribir(f, { ...m, desde: Date.now() });
  return m.build_id;
}

// El script que ubica un shim del repo en el plugin si@sielay instalado (la instalación
// del proyecto primero), o null si ninguna versión instalada lo trae.
export function scriptDelPlugin() {
  const config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const entradas = leer(join(config, 'plugins', 'installed_plugins.json'))?.plugins?.['si@sielay'] || [];
  const propio = (e) => Number(e.projectPath === process.env.CLAUDE_PROJECT_DIR);
  for (const e of [...entradas].sort((a, b) => propio(b) - propio(a))) {
    const f = e.installPath && join(e.installPath, 'skills', 'build-auto', 'scripts', 'corte-contexto.mjs');
    if (f && existsSync(f)) return f;
  }
  return null;
}

// ¿Qué script corre el gancho en esta sesión? El de la variable de una terminal abierta
// por build-auto, el que nombra un Stop de la config de usuario o del proyecto, o, si ese
// Stop es un shim del repo, el que el shim encuentra en el plugin. null: no hay gancho.
export function scriptDelGancho() {
  const env = process.env.SI_BUILD_CORTE_SCRIPT;
  if (env) return existsSync(env) ? env : null;
  const config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const proyecto = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const comandos = [join(config, 'settings.json'), join(proyecto, '.claude', 'settings.json'), join(proyecto, '.claude', 'settings.local.json')]
    .flatMap((f) => (leer(f)?.hooks?.Stop || []).flatMap((g) => g.hooks || []).map((h) => String(h.command || '')))
    .filter((c) => c.includes('corte-contexto'));
  const directo = comandos.map((c) => c.match(/[^\s"']*corte-contexto\.mjs/)?.[0]).find((f) => f && existsSync(f));
  if (directo) return directo;
  return comandos.length ? scriptDelPlugin() : null;
}
