import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHandoff, verificar } from '../../plugins/si/skills/checkpoint/scripts/verificar.mjs';
import { inventario } from '../../plugins/si/skills/checkpoint/scripts/procesos.mjs';
import { correr } from '../../plugins/si/skills/checkpoint/scripts/entorno-vivo.mjs';
import { arbol, T0 } from './helpers.mjs';

const HANDOFF = `# Handoff
## ENTORNO VIVO (2026-10-27T01:25Z)
- crons: ninguno
- pid 300 · inicio 2026-10-27T01:05:00Z · tarea · until [ -f /tmp/listo ]; do sleep 5; done; echo 'fin' (vigía: sí)
- pid 310 · inicio 2026-10-27T00:10:00Z · proceso · node server.js (vigía: no)
- pid 999 · inicio 2026-10-27T01:01:00Z · tarea · tail -f /tmp/otro (vigía: sí)
- git: /ruta/al/repo feat/x · 0 sin commit
## ARRANQUE
- pid 777 · inicio 2026-10-27T01:01:00Z · fuera del bloque
`;

function contexto() {
  const { tabla, fuente } = arbol();
  const procesos = inventario({ tabla, fuente, claudePid: 100, propioPid: 201, ahoraMs: T0 + 3600000 });
  return { tabla, fuente, procesos };
}

test('parseHandoff lee solo el bloque ENTORNO VIVO, con hora y marca de vigía', () => {
  const h = parseHandoff(HANDOFF);
  assert.equal(h.desde, Date.parse('2026-10-27T01:25:00Z'));
  assert.deepEqual(h.filas.map((f) => [f.pid, f.vigia]), [[300, true], [310, false], [999, true]]);
  assert.equal(h.filas[0].comando.endsWith('(vigía: sí)'), false);
});

test('parseHandoff sin bloque no inventa filas', () => {
  assert.deepEqual(parseHandoff('# nada'), { desde: null, filas: [], bloque: false });
});

test('verificar: muertos, pid reciclado, huérfanos anteriores a desde y duplicados', () => {
  const { tabla, procesos } = contexto();
  const h = parseHandoff(HANDOFF);
  const v = verificar({ filas: h.filas, desde: h.desde, tabla, procesos });
  // 999 no existe; 310 vive pero con otro inicio (T0+10min, no 00:10): reciclado = muerto.
  assert.deepEqual(v.muertos.map((m) => m.pid), [310, 999]);
  assert.deepEqual(v.huerfanos.map((x) => x.pid), [300, 310, 320, 330]);
  assert.equal(v.huerfanos.find((x) => x.pid === 300).vigia, true);
  assert.equal(v.huerfanos.find((x) => x.pid === 310).vigia, null); // su inicio no coincide con la fila
  assert.equal(v.huerfanos.find((x) => x.pid === 320).vigia, null);
  assert.deepEqual(v.duplicados.map((d) => d.pids), [[300, 340]]);
  assert.deepEqual(v.nuevos.map((n) => n.pid), [340]);
});

test('verificar: con el inventario al día no hay hallazgos', () => {
  const { tabla } = contexto();
  const v = verificar({ filas: [], desde: T0 + 60 * 60000, tabla, procesos: [] });
  assert.deepEqual([v.muertos, v.huerfanos, v.duplicados, v.nuevos], [[], [], [], []]);
});

function cli(args, archivos = { '/h.md': HANDOFF }) {
  const { fuente } = arbol();
  const io = {
    readFileSync: (p) => { if (p in archivos) return archivos[p]; throw Object.assign(new Error('x'), { code: 'ENOENT' }); },
    readdirSync: () => [],
  };
  const run = () => ({ ok: false, salida: '', error: 'x' });
  return correr(args, { fuente, io, run, propioPid: 201, ahora: T0 + 3600000, sesionesDir: '/s', cwd: '/ruta/al/repo' });
}

test('CLI --verificar sale con 2 si hay hallazgos', () => {
  const r = cli(['--verificar', '/h.md', '--json']);
  assert.equal(r.codigo, 2);
  assert.equal(JSON.parse(r.out).verificacion.huerfanos.length, 4);
});

test('CLI --verificar: con --desde anterior a todo no hay huérfanos y los nuevos no fallan', () => {
  const r = cli(['--desde', '2026-10-27T00:00:00Z', '--verificar', '/h2.md', '--json'], { '/h2.md': '## ENTORNO VIVO\n' });
  const v = JSON.parse(r.out).verificacion;
  assert.deepEqual([v.muertos.length, v.huerfanos.length, v.nuevos.length], [0, 0, 5]);
  assert.equal(v.duplicados.length, 1); // 300 y 340 repiten el comando
  assert.equal(r.codigo, 2);
});

test('CLI: errores salen con 1', () => {
  assert.equal(cli(['--verificar', '/no-existe.md']).codigo, 1);
  assert.equal(cli(['--verificar', '/h2.md'], { '/h2.md': '## ENTORNO VIVO\n' }).codigo, 1); // sin hora
  assert.equal(cli(['--nope']).codigo, 1);
  assert.equal(cli(['--detener', 'abc']).codigo, 1);
});

test('CLI sin --json imprime el bloque con los renglones de proceso y vigía', () => {
  const r = cli([]);
  assert.equal(r.codigo, 0);
  assert.match(r.out, /^## ENTORNO VIVO \(2026-10-27T02:00Z\)/);
  assert.match(r.out, /- pid 300 · inicio 2026-10-27T01:05:00Z · tarea · until \[ -f \/tmp\/listo \]; do sleep 5; done; echo 'fin' \(vigía: no\)/);
  assert.ok(!r.out.includes('CK_'));
});

test('CLI en una plataforma sin inventario sale con 0 y lo avisa', () => {
  const r = correr(['--json'], { fuente: null, io: { readFileSync() { throw new Error('x'); }, readdirSync: () => [] },
    run: () => ({ ok: false, salida: '' }), propioPid: 1, sesionesDir: '/s' });
  assert.equal(r.codigo, 0);
  const j = JSON.parse(r.out);
  assert.equal(j.procesos, null);
  assert.match(j.nota, /sin inventario de procesos en esta plataforma/);
});

test('CLI --verificar acepta el handoff por stdin con «-» y sale con 0 si está limpio', () => {
  const tabla = [{ pid: 100, ppid: 1, pgid: 100, comm: 'claude', inicioMs: T0 }, { pid: 200, ppid: 100, pgid: 200, comm: 'bash', inicioMs: T0 },
    { pid: 201, ppid: 200, pgid: 200, comm: 'node', inicioMs: T0 }];
  const fuente = { listar: () => tabla, cmdline: () => 'node x' };
  const io = { readFileSync: (p) => { assert.equal(p, 0); return '## ENTORNO VIVO (2026-10-27T01:25Z)\n- crons: ninguno\n'; }, readdirSync: () => [] };
  const r = correr(['--verificar', '-'], { fuente, io, run: () => ({ ok: false, salida: '' }), propioPid: 201, sesionesDir: '/s', ahora: T0 });
  assert.equal(r.codigo, 0);
  assert.match(r.out, /limpio/);
});
