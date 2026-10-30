#!/usr/bin/env node
// Corte de contexto automático de una sesión de build (ganchos Stop y PostToolUse de Claude Code).
//
// Al terminar cada turno mide el contexto con el transcript. Si la sesión está en un
// build y pasó el umbral, bloquea el fin del turno una vez y le pide a Claude el
// checkpoint. Cuando el handoff está listo (`--listo`), el siguiente Stop limpia la
// terminal sola si corre en tmux (limpiar-terminal.mjs) y la retoma desde el handoff.
// Fuera de un build no hace nada.
//
// Gancho:  node corte-contexto.mjs            (lee el JSON del evento por stdin)
// CLI:     node corte-contexto.mjs --activar <build_id> | --desactivar | --estado | --listo <handoff>
// Estado:  corte-estado.mjs (${XDG_CACHE_HOME:-~/.cache}/si-build-auto/corte). Sin dependencias.
import { readFileSync, existsSync, rmSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { measure, findTranscript } from './medir-contexto.mjs';
import { leer, escribir, bitacora, clave, archivoActivo, archivoEstado, idPane, buildActivo, scriptDelGancho, conControl } from './corte-estado.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const UMBRAL = Number(process.env.SI_BUILD_CORTE_UMBRAL) || 250000;
const RE_AVISO = 20000; // vuelve a pedir el corte solo si el contexto creció esto desde el último aviso
const LIMPIANDO_MS = 120000; // un limpiador ya lanzado no se repite antes de esto

function instrucciones(k, buildId) {
  const sigue = process.env.TMUX_PANE
    ? 'Al terminar el turno, esta terminal se limpia sola (/clear por tmux) y retoma desde el handoff: no pidas el clear a nadie.'
    : 'Esta sesión no corre en tmux: al terminar, avisa al coordinador por link_send (o, si tú coordinas, a quien te lanzó; si no hay link, a la persona) «listo para clear, handoff en <ruta>».';
  return [
    `Corte de contexto: esta sesión del build ${buildId} va en ${k} K y el umbral es ${Math.round(UMBRAL / 1000)} K.`,
    'Si hay un subagente o una espera corriendo, o algo a medio commitear, termínalo sin empezar nada nuevo y vuelve a parar; el corte se pide de nuevo más adelante.',
    'Si no:',
    '1. /si:checkpoint autonomo: commit local y handoff en ~/handoffs/<sesion>.md con el build_id, la etapa, lo hecho, lo que sigue, las decisiones vigentes y las esperas en segundo plano que haya que relanzar.',
    `2. Solo si coordinas y reportas a sielay: link_build_stage con status "blocked" y waiting {on: "terminal", what: "corte de contexto a ${Math.round(UMBRAL / 1000)} K", next: "retomar desde <handoff>"}.`,
    `3. node "${join(HERE, 'corte-contexto.mjs')}" --listo <ruta del handoff>`,
    '4. Termina el turno sin más trabajo.',
    sigue,
  ].join('\n');
}

// Contexto del último turno, leyendo solo la cola del transcript (el gancho corre en
// cada herramienta); si la cola no trae ningún turno, se lee el archivo entero.
function contextoActual(file) {
  const COLA = 1024 * 1024;
  try {
    const fd = openSync(file, 'r');
    const { size } = fstatSync(fd);
    const buf = Buffer.alloc(Math.min(size, COLA));
    readSync(fd, buf, 0, buf.length, size - buf.length);
    closeSync(fd);
    const lineas = buf.toString('utf8').split('\n');
    if (buf.length < size) lineas.shift(); // la primera puede venir cortada
    for (let i = lineas.length - 1; i >= 0; i--) {
      if (!lineas[i].includes('"usage"')) continue;
      let ev;
      try { ev = JSON.parse(lineas[i]); } catch { continue; }
      const u = ev.type === 'assistant' && ev.message?.model !== '<synthetic>' && ev.message?.usage;
      if (u) return (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    }
  } catch { /* cae a la lectura completa */ }
  return measure(file).contexto_actual;
}

// Stop: bloquea el fin del turno una vez por nivel y, con el handoff listo, limpia.
// PostToolUse: un turno largo puede crecer mucho antes de su Stop, así que avisa a
// mitad del turno sin bloquear la herramienta. Los eventos de un subagente (traen
// agent_id) no cuentan: su contexto no es el de la sesión y no pueden marcarla lista.
function gancho() {
  let ev;
  try { ev = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return; }
  const sesion = ev.session_id;
  if (!sesion || ev.agent_id) return;
  const enStop = ev.hook_event_name !== 'PostToolUse';
  const buildId = buildActivo(sesion, { refrescar: enStop });
  if (!buildId) return;
  const fs = archivoEstado(sesion);
  const st = leer(fs) || {};

  if (st.listo) {
    if (!enStop || !process.env.TMUX_PANE) return;
    if (st.limpiando && Date.now() - st.limpiando < LIMPIANDO_MS) return;
    escribir(fs, { ...st, limpiando: Date.now() });
    const hijo = spawn(process.execPath, [join(HERE, 'limpiar-terminal.mjs'), process.env.TMUX_PANE, st.listo, buildId, fs],
      { detached: true, stdio: 'ignore' });
    hijo.unref();
    bitacora('limpiar', { sesion, build: buildId, pane: process.env.TMUX_PANE, handoff: st.listo });
    return;
  }

  const transcript = ev.transcript_path && existsSync(ev.transcript_path) ? ev.transcript_path : findTranscript(sesion);
  if (!transcript) return;
  const ctx = contextoActual(transcript);
  if (ctx < UMBRAL || (enStop && ev.stop_hook_active)) return;
  const campo = enStop ? 'bloqueado_en' : 'avisado_en';
  if (st[campo] && ctx < st[campo] + RE_AVISO) return;

  // Se relee justo antes de escribir para no pisar un `--listo` que llegó entretanto.
  escribir(fs, { ...(leer(fs) || {}), [campo]: ctx, build_id: buildId });
  bitacora(enStop ? 'corte-pedido' : 'corte-avisado', { sesion, build: buildId, contexto: ctx });
  const texto = instrucciones(Math.round(ctx / 1000), buildId);
  process.stdout.write(JSON.stringify(enStop
    ? { decision: 'block', reason: texto }
    : { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: texto } }));
}

function cli(args) {
  const sesion = process.env.CLAUDE_CODE_SESSION_ID || '';
  const [op, valor] = args;
  const exige = (cond, msg) => { if (!cond) { console.error(`corte-contexto.mjs: ${msg}`); process.exit(2); } };
  if (op === '--activar') {
    exige(/^[a-z0-9][a-z0-9._-]{2,79}$/.test(valor || ''), '--activar pide el build_id');
    exige(sesion || process.env.TMUX_PANE, 'sin CLAUDE_CODE_SESSION_ID ni TMUX_PANE no sé qué sesión activar');
    escribir(archivoActivo(sesion), { build_id: valor, desde: Date.now(), pane: idPane() });
  } else if (op === '--desactivar') {
    rmSync(archivoActivo(sesion), { force: true });
  } else if (op === '--listo') {
    exige(sesion || process.env.TMUX_PANE, 'sin CLAUDE_CODE_SESSION_ID ni TMUX_PANE');
    exige(valor && !conControl(valor), 'la ruta del handoff trae caracteres de control');
    exige(existsSync(valor) && readFileSync(valor, 'utf8').trim(), `el handoff ${valor} no existe o está vacío`);
    escribir(archivoEstado(sesion), { ...(leer(archivoEstado(sesion)) || {}), listo: valor });
  } else if (op !== '--estado') {
    exige(false, `argumento desconocido: ${op}`);
  }
  const script = scriptDelGancho();
  console.log(JSON.stringify({
    build_id: buildActivo(sesion),
    clave: clave(sesion),
    gancho: Boolean(script),
    script,
    umbral: UMBRAL,
    tmux: Boolean(process.env.TMUX_PANE),
    listo: leer(archivoEstado(sesion))?.listo ?? null,
  }));
}

if (process.argv.length > 2) cli(process.argv.slice(2));
else gancho();
