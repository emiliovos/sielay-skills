import test from 'node:test';
import assert from 'node:assert/strict';
import { extraerComando, inventario, encontrarClaude, esEnvoltorio, SIN_COMANDO } from '../../plugins/si/skills/checkpoint/scripts/procesos.mjs';
import { arbol, envoltorio, T0 } from './helpers.mjs';

test('extrae el comando de eval y desescapa las comillas simples', () => {
  const c = "until [ -f /tmp/listo ]; do sleep 5; done; echo 'fin'";
  assert.equal(extraerComando(envoltorio(c)), c);
});

test('nunca devuelve el preámbulo de exports', () => {
  const c = extraerComando(envoltorio('echo hola', { preambulo: 'export CK_SECRET="zzz"' }));
  assert.equal(c, 'echo hola');
});

test('envoltorio sin eval o sin cierre no es legible', () => {
  assert.equal(extraerComando('/bin/bash -c source /x/snapshot-1.sh && sin eval'), null);
  assert.equal(extraerComando("/bin/bash -c source /x/snapshot-1.sh && eval 'sin cierre"), null);
  assert.equal(extraerComando('node server.js'), null);
  assert.equal(esEnvoltorio('node server.js'), false);
});

test('el claude es el ancestro más cercano con comm claude', () => {
  const { tabla } = arbol();
  assert.equal(encontrarClaude(new Map(tabla.map((p) => [p.pid, p])), 201), 100);
});

test('sin ancestro claude devuelve null', () => {
  const m = new Map([[5, { pid: 5, ppid: 1, comm: 'bash' }], [1, { pid: 1, ppid: 0, comm: 'init' }]]);
  assert.equal(encontrarClaude(m, 5), null);
});

test('un sessions/<pid>.json cuenta como claude aunque el comm sea otro', () => {
  const m = new Map([[5, { pid: 5, ppid: 7, comm: 'bash' }], [7, { pid: 7, ppid: 1, comm: 'node' }], [1, { pid: 1, ppid: 0, comm: 'init' }]]);
  const io = { readFileSync: (p) => { if (p.endsWith('/7.json')) return '{"pid":7}'; throw new Error('no'); } };
  assert.equal(encontrarClaude(m, 5, { dir: '/s', io }), 7);
});

test('inventario: excluye la cadena de la llamada y clasifica por tipo', () => {
  const { tabla, fuente } = arbol();
  const inv = inventario({ tabla, fuente, claudePid: 100, propioPid: 201, ahoraMs: T0 + 3600000 });
  assert.deepEqual(inv.map((p) => p.pid), [300, 310, 320, 330, 340]);
  const por = Object.fromEntries(inv.map((p) => [p.pid, p]));
  assert.equal(por[300].tipo, 'tarea');
  assert.match(por[300].comando, /^until \[ -f/);
  assert.equal(por[310].tipo, 'proceso');
  assert.equal(por[310].comando, 'node server.js --token=[redactado]');
  assert.equal(por[320].tipo, 'otro'); // no es líder de su grupo
  assert.equal(por[330].tipo, 'otro');
  assert.equal(por[330].comando, SIN_COMANDO);
  assert.equal(por[300].edad_s, 3300);
  assert.equal(por[300].inicio, '2026-10-27T01:05:00Z');
});

test('inventario: el nieto (hijo de una tarea) no aparece', () => {
  const { tabla, fuente } = arbol();
  const inv = inventario({ tabla, fuente, claudePid: 100, propioPid: 201, ahoraMs: T0 });
  assert.ok(!inv.some((p) => p.pid === 301));
});

test('el comando se recorta a 160 caracteres', () => {
  const tabla = [{ pid: 100, ppid: 1, pgid: 100, comm: 'claude', inicioMs: T0 }, { pid: 5, ppid: 100, pgid: 5, comm: 'node', inicioMs: T0 }];
  const fuente = { cmdline: () => `node ${'a '.repeat(200)}` };
  const [p] = inventario({ tabla, fuente, claudePid: 100, propioPid: 999, ahoraMs: T0 });
  assert.ok(p.comando.length <= 160);
});
