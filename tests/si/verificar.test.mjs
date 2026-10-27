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

test('parseHandoff lee solo el bloque ENTORNO VIVO, con hora y marca de vigía', async () => {
  const h = parseHandoff(HANDOFF);
  assert.equal(h.desde, Date.parse('2026-10-27T01:25:00Z'));
  assert.deepEqual(h.filas.map((f) => [f.pid, f.vigia]), [[300, true], [310, false], [999, true]]);
  assert.equal(h.filas[0].comando.endsWith('(vigía: sí)'), false);
});

test('parseHandoff sin bloque no inventa filas', async () => {
  assert.deepEqual(parseHandoff('# nada'), { desde: null, filas: [], bloque: false });
});

test('verificar: muertos, pid reciclado, huérfanos anteriores a desde y duplicados', async () => {
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

test('verificar: con el inventario al día no hay hallazgos', async () => {
  const { tabla } = contexto();
  const v = verificar({ filas: [], desde: T0 + 60 * 60000, tabla, procesos: [] });
  assert.deepEqual([v.muertos, v.huerfanos, v.duplicados, v.nuevos], [[], [], [], []]);
});

async function cli(args, archivos = { '/h.md': HANDOFF }) {
  const { fuente } = arbol();
  const io = {
    readFileSync: (p) => { if (p in archivos) return archivos[p]; throw Object.assign(new Error('x'), { code: 'ENOENT' }); },
    readdirSync: () => [],
  };
  const run = () => ({ ok: false, salida: '', error: 'x' });
  return await correr(args, { fuente, io, run, propioPid: 201, ahora: T0 + 3600000, sesionesDir: '/s', cwd: '/ruta/al/repo' });
}

test('CLI --verificar sale con 2 si hay hallazgos', async () => {
  const r = await cli(['--verificar', '/h.md', '--json']);
  assert.equal(r.codigo, 2);
  assert.equal(JSON.parse(r.out).verificacion.huerfanos.length, 4);
});

test('CLI --verificar: con --desde anterior a todo no hay huérfanos y los nuevos no fallan', async () => {
  const r = await cli(['--desde', '2026-10-27T00:00:00Z', '--verificar', '/h2.md', '--json'], { '/h2.md': '## ENTORNO VIVO\n' });
  const v = JSON.parse(r.out).verificacion;
  assert.deepEqual([v.muertos.length, v.huerfanos.length, v.nuevos.length], [0, 0, 5]);
  assert.equal(v.duplicados.length, 1); // 300 y 340 repiten el comando
  assert.equal(r.codigo, 2);
});

test('CLI: errores salen con 1', async () => {
  assert.equal((await cli(['--verificar', '/no-existe.md'])).codigo, 1);
  assert.equal((await cli(['--verificar', '/h2.md'], { '/h2.md': '## ENTORNO VIVO\n' })).codigo, 1); // sin hora
  assert.equal((await cli(['--nope'])).codigo, 1);
  assert.equal((await cli(['--detener', 'abc'])).codigo, 1);
});

test('CLI sin --json imprime el bloque con los renglones de proceso y vigía', async () => {
  const r = await cli([]);
  assert.equal(r.codigo, 0);
  assert.match(r.out, /^## ENTORNO VIVO \(2026-10-27T02:00:00Z\)/);
  assert.match(r.out, /- pid 300 · inicio 2026-10-27T01:05:00Z · tarea · until \[ -f \/tmp\/listo \]; do sleep 5; done; echo 'fin' \(vigía: no\)/);
  assert.ok(!r.out.includes('CK_'));
});

test('CLI en una plataforma sin inventario sale con 0 y lo avisa', async () => {
  const r = await correr(['--json'], { fuente: null, io: { readFileSync() { throw new Error('x'); }, readdirSync: () => [] },
    run: () => ({ ok: false, salida: '' }), propioPid: 1, sesionesDir: '/s' });
  assert.equal(r.codigo, 0);
  const j = JSON.parse(r.out);
  assert.equal(j.procesos, null);
  assert.match(j.nota, /sin inventario de procesos en esta plataforma/);
});

test('CLI --verificar acepta el handoff por stdin con «-» y sale con 0 si está limpio', async () => {
  const tabla = [{ pid: 100, ppid: 1, pgid: 100, comm: 'claude', inicioMs: T0 }, { pid: 200, ppid: 100, pgid: 200, comm: 'bash', inicioMs: T0 },
    { pid: 201, ppid: 200, pgid: 200, comm: 'node', inicioMs: T0 }];
  const fuente = { listar: () => tabla, cmdline: () => 'node x' };
  const io = { readFileSync: (p) => { assert.equal(p, 0); return '## ENTORNO VIVO (2026-10-27T01:25Z)\n- crons: ninguno\n'; }, readdirSync: () => [] };
  const r = await correr(['--verificar', '-'], { fuente, io, run: () => ({ ok: false, salida: '' }), propioPid: 201, sesionesDir: '/s', ahora: T0 });
  assert.equal(r.codigo, 0);
  assert.match(r.out, /limpio/);
});

test('vigía armado en el mismo minuto del handoff: el encabezado sin segundos no lo esconde', () => {
  const tabla = [{ pid: 100, ppid: 1, pgid: 100, comm: 'claude', inicioMs: T0 }, { pid: 500, ppid: 100, pgid: 500, comm: 'bash', inicioMs: Date.parse('2026-10-27T01:44:19Z') }];
  const procesos = [{ pid: 500, inicio: '2026-10-27T01:44:19Z', tipo: 'tarea', comando: 'until x; do sleep 5; done' }];
  const h = parseHandoff('## ENTORNO VIVO (2026-10-27T01:44Z)\n- pid 500 · inicio 2026-10-27T01:44:19Z · tarea · until x; do sleep 5; done (vigía: sí)\n');
  const v = verificar({ filas: h.filas, desde: h.desde, tabla, procesos, claudePid: 100 });
  assert.deepEqual(v.huerfanos.map((x) => [x.pid, x.vigia]), [[500, true]]);
  assert.deepEqual(v.nuevos, []);
});

test('vivos con el mismo inicio que no cuelgan de este claude van en vivos_ajenos y no son muertos', () => {
  const tabla = [{ pid: 100, ppid: 1, pgid: 100, comm: 'claude', inicioMs: T0 }, { pid: 900, ppid: 55, pgid: 900, comm: 'bash', inicioMs: T0 + 60000 }];
  const h = parseHandoff('## ENTORNO VIVO (2026-10-27T01:30:00Z)\n- pid 900 · inicio 2026-10-27T01:01:00Z · tarea · tail -f /tmp/log (vigía: sí)\n');
  const v = verificar({ filas: h.filas, desde: h.desde, tabla, procesos: [], claudePid: 100 });
  assert.deepEqual(v.vivos_ajenos.map((x) => x.pid), [900]);
  assert.deepEqual(v.muertos, []);
});

test('CLI: un descriptor fuera del repo se rechaza y no se ejecuta nada', async () => {
  const { fuente } = arbol();
  const llamadas = [];
  const io = { readFileSync: (p) => { llamadas.push(p); return '## Entorno vivo\n- a: `node scripts/x.mjs`\n'; }, readdirSync: () => [],
    realpathSync: (p) => (p === '/otro/CLAUDE.md' ? '/otro/CLAUDE.md' : p) };
  const run = (c, a) => (a.includes('--show-toplevel') ? { ok: true, salida: '/ruta/al/repo\n' } : { ok: false, salida: '' });
  const r = await correr(['--repo', '/ruta/al/repo', '--descriptor', '/otro/CLAUDE.md', '--json'], { fuente, io, run, propioPid: 201, sesionesDir: '/s', ahora: T0 });
  assert.equal(r.codigo, 0);
  assert.match(JSON.parse(r.out).descriptor_rechazado, /no está dentro del repo/);
  assert.deepEqual(llamadas.filter((p) => p.endsWith('CLAUDE.md')), []);
});

test('CLI: el descriptor del repo corre con cwd en el toplevel', async () => {
  const { fuente } = arbol();
  const corridas = [];
  const io = { readFileSync: () => '## Entorno vivo\n- a: `node scripts/x.mjs`\n', readdirSync: () => [], realpathSync: (p) => p };
  const run = (c, a) => (a.includes('--show-toplevel') ? { ok: true, salida: '/ruta/al/repo\n' } : { ok: false, salida: '' });
  const r = await correr(['--repo', '/ruta/al/repo/sub', '--descriptor', '/ruta/al/repo/CLAUDE.md', '--json'],
    { fuente, io, run, propioPid: 201, sesionesDir: '/s', ahora: T0, runDescriptor: async (argv, cwd) => { corridas.push([argv, cwd]); return { ok: true, salida: 'listo' }; } });
  assert.deepEqual(corridas, [[['node', 'scripts/x.mjs'], '/ruta/al/repo']]);
  assert.equal(JSON.parse(r.out).descriptor[0].salida, 'listo');
});

test('sesiones: un archivo viejo con pid reciclado no sale en otras sesiones', async () => {
  const { fuente } = arbol();
  const tabla = fuente.listar().map((p) => (p.pid === 310 ? { ...p, ticks: 42 } : p));
  const io = { readdirSync: () => ['310.json', '999.json'], readFileSync: (p) => (p.endsWith('/310.json')
    ? JSON.stringify({ pid: 310, name: 'vieja', procStart: '41' }) : JSON.stringify({ pid: 999, name: 'muerta', procStart: '1' })) };
  const r = await correr(['--json'], { fuente: { ...fuente, listar: () => tabla }, io, run: () => ({ ok: false, salida: '' }), propioPid: 201, sesionesDir: '/s', ahora: T0 });
  assert.deepEqual(JSON.parse(r.out).sesiones, []);
});

test('el renglón git solo lista los PRs de la rama actual o de sus worktrees', async () => {
  const { renderMarkdown, prsRelevantes } = await import('../../plugins/si/skills/checkpoint/scripts/render.mjs');
  const g = { repo: '/ruta/al/repo', rama: 'feat/x', sucio: [], sucio_total: 0, adelante: 0, sin_upstream: false,
    worktrees: ['/ruta/al/repo feat/x', '/ruta/wt otra/rama', '/ruta/det (detached)'],
    prs: [{ n: 1, rama: 'feat/x', titulo: 'a' }, { n: 2, rama: 'otra/rama', titulo: 'b' }, { n: 3, rama: 'ajena', titulo: 'c' }] };
  assert.deepEqual(prsRelevantes(g).map((p) => p.n), [1, 2]);
  const md = renderMarkdown({ generado: '2026-10-27T01:40:00Z', claude: null, procesos: [], sesiones: [], git: [g] });
  assert.match(md, /PR #1, PR #2 \(otra\/rama\)/);
  assert.ok(!md.includes('#3'));
});
