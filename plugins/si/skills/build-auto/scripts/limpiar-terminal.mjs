#!/usr/bin/env node
// Limpia una terminal de Claude Code en tmux y la retoma desde su handoff.
// Lo lanza corte-contexto.mjs, desacoplado, desde el gancho Stop: espera a que el
// turno termine, comprueba que el pane sigue corriendo Claude, manda /clear y luego el
// prompt de retomar. Tras un /clear el primer Enter a veces se pierde, así que repite
// Enter (en un prompt vacío no hace nada). Al confirmar el /clear borra el estado del
// corte; el resultado queda en la bitácora («limpio» o «limpiar-fallo»).
//
// Uso: node limpiar-terminal.mjs <pane> <handoff> <build_id> <archivo de estado>
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { leer, escribir, bitacora, conControl } from './corte-estado.mjs';

const [pane, handoff, buildId, estado] = process.argv.slice(2);
if (!pane || !handoff || !buildId || !estado || conControl(handoff)) process.exit(2);

const espera = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const tmux = (...args) => execFileSync('tmux', args, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString();
const teclas = (...k) => tmux('send-keys', '-t', pane, ...k);
const prompt = `Retoma desde ${handoff} (corte de contexto automático; build_id ${buildId}). Lee el handoff y sigue donde quedó.`;

// El binario nativo de Claude Code aparece con su versión como nombre de comando.
const corriendoClaude = () => /^(claude|node|\d+\.\d+\.\d+)$/.test(tmux('display-message', '-p', '-t', pane, '#{pane_current_command}').trim());
// En modo copia o de vista las teclas no llegan al prompt.
const salirDeModo = () => { if (tmux('display-message', '-p', '-t', pane, '#{pane_in_mode}').trim() === '1') teclas('-X', 'cancel'); };
const prepararPrompt = () => { salirDeModo(); teclas('Escape'); espera(1000); teclas('C-u'); espera(500); };

function fallo(motivo) {
  bitacora('limpiar-fallo', { build: buildId, pane, handoff, motivo });
  // Sin la marca, el siguiente Stop lo vuelve a intentar.
  const st = leer(estado);
  if (st) escribir(estado, { ...st, limpiando: null });
  process.exit(1);
}

try {
  espera(3000);
  if (!corriendoClaude()) fallo('el pane no corre claude');
  prepararPrompt();
  teclas('-l', '/clear'); teclas('Enter'); espera(6000);
  if (!corriendoClaude()) fallo('claude salió tras el /clear');
  rmSync(estado, { force: true }); // la sesión nueva empieza sin el corte pendiente
  prepararPrompt();
  teclas('-l', prompt);
  teclas('Enter'); espera(4000); teclas('Enter'); espera(6000); teclas('Enter');
  if (!tmux('capture-pane', '-p', '-J', '-t', pane, '-S', '-200').includes(`Retoma desde ${handoff}`)) {
    fallo('el prompt de retomar no aparece en el pane');
  }
  bitacora('limpio', { build: buildId, pane, handoff });
} catch (e) {
  fallo(String(e?.message || e).slice(0, 200));
}
