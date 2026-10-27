import test from 'node:test';
import assert from 'node:assert/strict';
import { detener } from '../../plugins/si/skills/checkpoint/scripts/detener.mjs';
import { inventario } from '../../plugins/si/skills/checkpoint/scripts/procesos.mjs';
import { correr } from '../../plugins/si/skills/checkpoint/scripts/entorno-vivo.mjs';
import { arbol, T0 } from './helpers.mjs';

function armar(mutar = () => {}) {
  const { tabla, fuente } = arbol();
  const llamadas = [];
  let lecturas = 0;
  const base = { claudePid: 100, propioPid: 201, kill: (...a) => llamadas.push(a),
    procesos: () => inventario({ tabla, fuente, claudePid: 100, propioPid: 201, ahoraMs: T0 + 3600000 }),
    leerTabla: () => { lecturas += 1; return mutar(structuredClone(tabla), lecturas); } };
  return { base, llamadas };
}

test('detiene el grupo con kill -TERM -<pgid>', async () => {
  const { base, llamadas } = armar((t) => t);
  const r = detener({ ...base, pid: 300, inicioEsperado: T0 + 5 * 60000 });
  assert.equal(r.ok, true);
  assert.deepEqual(llamadas, [[-300, 'SIGTERM']]);
});

test('rechaza lo que no es hijo directo del claude propio', async () => {
  const { base, llamadas } = armar((t) => t);
  for (const pid of [301, 100, 201, 1, 12345]) assert.equal(detener({ ...base, pid }).ok, false, `pid ${pid}`);
  assert.deepEqual(llamadas, []);
});

test('tipo otro nunca se detiene', async () => {
  const { base, llamadas } = armar((t) => t);
  assert.equal(detener({ ...base, pid: 320 }).ok, false);
  assert.equal(detener({ ...base, pid: 330 }).ok, false);
  assert.deepEqual(llamadas, []);
});

test('rechaza un pid reciclado: inicio distinto del esperado', async () => {
  const { base, llamadas } = armar((t) => t);
  const r = detener({ ...base, pid: 300, inicioEsperado: T0 });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /reciclado/);
  assert.deepEqual(llamadas, []);
});

test('recomprueba justo antes: cambia el inicio, el padre o el grupo', async () => {
  for (const [nombre, mut] of [
    ['inicio', (p) => { p.inicioMs += 60000; }],
    ['padre', (p) => { p.ppid = 1; }],
    ['grupo', (p) => { p.pgid = 1; }],
    ['murió', null],
  ]) {
    const { base, llamadas } = armar((t, n) => {
      if (n < 2) return t;
      if (mut === null) return t.filter((p) => p.pid !== 300);
      mut(t.find((p) => p.pid === 300));
      return t;
    });
    assert.equal(detener({ ...base, pid: 300 }).ok, false, nombre);
    assert.deepEqual(llamadas, [], nombre);
  }
});

test('CLI --detener usa las fuentes inyectadas y no toca procesos reales', async () => {
  const { fuente } = arbol();
  const llamadas = [];
  const base = { fuente, io: { readFileSync() { throw new Error('x'); }, readdirSync: () => [] }, propioPid: 201,
    sesionesDir: '/s', kill: (...a) => llamadas.push(a), ahora: T0 };
  assert.equal((await correr(['--detener', '300', '--inicio', '2026-10-27T01:05:00Z'], base)).codigo, 0);
  assert.deepEqual(llamadas, [[-300, 'SIGTERM']]);
  assert.equal((await correr(['--detener', '320'], base)).codigo, 1);
  assert.equal((await correr(['--detener', '300'], { ...base, fuente: null })).codigo, 1);
});
