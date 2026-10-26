#!/usr/bin/env node
// Limpia una terminal de Claude Code en tmux y la retoma desde su handoff.
// Lo lanza corte-contexto.mjs, desacoplado, desde el gancho Stop. Solo toca una terminal
// libre (sin turno en curso, sin diálogo y con la caja vacía) que siga corriendo Claude;
// si no lo está, sale sin mandar teclas y el siguiente fin de turno lo reintenta.
// Pasos, cada uno confirmado en pantalla: /reload-plugins (la sesión sigue con los plugins
// que cargó al arrancar), /clear, y el prompt de retomar pegado con paste-buffer -p y el
// Enter aparte un segundo después: texto y Enter en una sola ráfaga se toman como pegado
// y se pierden ese Enter y el siguiente. Al confirmar el /clear borra el estado del corte;
// el resultado queda en la bitácora («limpio» o «limpiar-fallo»).
//
// Uso: node limpiar-terminal.mjs <pane> <handoff> <build_id> <archivo de estado>
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { leer, escribir, bitacora, conControl } from './corte-estado.mjs';

const [pane, handoff, buildId, estado] = process.argv.slice(2);
if (!pane || !handoff || !buildId || !estado || conControl(handoff)) process.exit(2);

const espera = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const tmux = (args, input) => execFileSync('tmux', args,
  { input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'], timeout: 5000 }).toString();
const linea = (texto) => { tmux(['send-keys', '-t', pane, '-l', texto]); espera(1000); tmux(['send-keys', '-t', pane, 'Enter']); };
const prompt = `Retoma desde ${handoff} (corte de contexto automático; build_id ${buildId}). Lee el handoff y sigue donde quedó.`;

const pantalla = () => tmux(['capture-pane', '-p', '-t', pane]);
const cuenta = (texto) => pantalla().split(texto).length - 1;
const sinBlancos = (s) => s.replace(/[\s\u00a0]/g, '');
// Lo escrito en la caja: lo que hay entre las dos últimas rayas horizontales, sin el texto
// atenuado (la sugerencia que propone Claude Code no está escrito) ni el «❯».
function caja() {
  const lineas = tmux(['capture-pane', '-e', '-p', '-t', pane])
    .replace(/\x1b\[2m[^\x1b]*/g, '').replace(/\x1b\[[0-9;]*m/g, '').split('\n'); // eslint-disable-line no-control-regex
  const rayas = lineas.flatMap((l, i) => (/^─{20}/.test(l) ? [i] : []));
  if (rayas.length < 2) return '';
  return sinBlancos(lineas.slice(rayas.at(-2) + 1, rayas.at(-1)).join(' ').replace(/^\s*❯/, ''));
}
// El binario nativo de Claude Code aparece con su versión como nombre de comando.
const corriendoClaude = () => /^(claude|node|\d+\.\d+\.\d+)$/.test(tmux(['display-message', '-p', '-t', pane, '#{pane_current_command}']).trim());
const trabajando = () => /^[·✢✳✶✻✽*] \S+…|esc to interrupt/m.test(pantalla());
const dialogo = () => /Enter to (select|confirm)|Esc to cancel|Do you want to|\(y\/n\)|How is Claude doing/.test(pantalla());
const libre = () => !trabajando() && !dialogo() && caja() === '';

function fallo(motivo) {
  bitacora('limpiar-fallo', { build: buildId, pane, handoff, motivo });
  // Sin la marca, el siguiente fin de turno lo vuelve a intentar.
  const st = leer(estado);
  if (st) escribir(estado, { ...st, limpiando: null });
  process.exit(1);
}
function hasta(cond, segundos) {
  for (let i = 0; i < segundos; i++) { if (cond()) return true; espera(1000); }
  return cond();
}

try {
  espera(3000);
  if (!corriendoClaude()) fallo('el pane no corre claude');
  if (tmux(['display-message', '-p', '-t', pane, '#{pane_in_mode}']).trim() === '1') tmux(['send-keys', '-t', pane, '-X', 'cancel']);
  // Una sesión quieta no vuelve a disparar el Stop: se espera un rato antes de rendirse.
  if (!hasta(libre, 30)) fallo('la terminal no está libre (turno, diálogo o texto en la caja)');

  const recargas = cuenta('Reloaded:');
  linea('/reload-plugins');
  hasta(() => cuenta('Reloaded:') > recargas, 20); // si no confirma, sigue: el /clear igual sirve
  if (!libre()) fallo('la terminal cambió durante la recarga');

  linea('/clear');
  espera(1000);
  if (!hasta(libre, 15) || !corriendoClaude()) fallo('el /clear no se confirmó');
  rmSync(estado, { force: true }); // la sesión nueva empieza sin el corte pendiente

  const inicio = sinBlancos(prompt).slice(0, 40);
  const pendiente = () => { const c = caja(); return c.startsWith(inicio) || c.includes('[Pastedtext'); };
  const buffer = `si-corte-${process.pid}`;
  tmux(['load-buffer', '-b', buffer, '-'], prompt);
  tmux(['paste-buffer', '-p', '-d', '-b', buffer, '-t', pane]);
  espera(1000);
  if (!pendiente()) fallo('el prompt de retomar no llegó a la caja');
  for (let i = 0; i < 3 && pendiente(); i++) { tmux(['send-keys', '-t', pane, 'Enter']); espera(4000); }
  if (pendiente()) fallo('el prompt de retomar sigue en la caja');
  bitacora('limpio', { build: buildId, pane, handoff });
} catch (e) {
  fallo(String(e?.message || e).slice(0, 200));
}
