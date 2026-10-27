import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  RUTA_POR_DEFECTO, parseReporte, diaDelReporte, rutaDelReporte, armarBloque, redactarReporte, reportar,
} from '../../plugins/si/skills/checkpoint/scripts/reporte.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../plugins/si/skills/checkpoint/scripts/reporte.mjs');
const CONTRATO = `# Repo
## Cierre de sesión
- Estado: journals
- Push: rama+PR
- Reporte: ~/notas/dia-{AAMMDD}/reportes/{terminal}.md; corte 08:00 America/Mexico_City; fuera de srv1: link ana/srv1/coord
## Otra
- Reporte: no
`;
const CUERPO = '- Hecho: PR #12 mergeado a las 22:30\n- Quedó: deploy, de coord\n- Retro: bien · mal · mejorar';
// 22:28 del 26-oct en CDMX (UTC-6) y 07:45 / 08:00 del 27-oct.
const NOCHE = Date.parse('2026-10-27T04:28:00Z');
const ANTES_DEL_CORTE = Date.parse('2026-10-27T13:45:00Z');
const EN_EL_CORTE = Date.parse('2026-10-27T14:00:00Z');

test('parseReporte lee ruta, corte con zona y el link de fuera del host, solo de su sección', () => {
  assert.deepEqual(parseReporte(CONTRATO), {
    ruta: '~/notas/dia-{AAMMDD}/reportes/{terminal}.md',
    corte: { h: 8, m: 0 },
    zona: 'America/Mexico_City',
    fuera: { host: 'srv1', link: 'ana/srv1/coord' },
  });
});

test('sin la línea vale el valor por defecto; «no» apaga el reporte; una parte rara es error', () => {
  assert.deepEqual(parseReporte('# sin contrato'), { ruta: RUTA_POR_DEFECTO, porDefecto: true });
  assert.deepEqual(parseReporte('## Cierre de sesión\n- Push: rama+PR\n'), { ruta: RUTA_POR_DEFECTO, porDefecto: true });
  assert.deepEqual(parseReporte('## Cierre de sesión\n- Reporte: no\n'), { no: true });
  assert.throws(() => parseReporte('## Cierre de sesión\n- Reporte: ~/r.md; cada hora\n'), /no se entiende/);
  assert.throws(() => parseReporte('## Cierre de sesión\n- Reporte: ~/r.md; corte 25:00\n'), /no se entiende/);
});

test('con corte, lo de la noche y lo de antes del corte van al mismo día; desde el corte, al siguiente', () => {
  const c = { corte: { h: 8, m: 0 }, zona: 'America/Mexico_City' };
  assert.equal(diaDelReporte(NOCHE, c), '261027');
  assert.equal(diaDelReporte(ANTES_DEL_CORTE, c), '261027');
  assert.equal(diaDelReporte(EN_EL_CORTE, c), '261028');
  assert.equal(diaDelReporte(NOCHE, { zona: 'America/Mexico_City' }), '261026');
  assert.equal(diaDelReporte(Date.parse('2026-12-31T23:30:00Z'), { corte: { h: 20, m: 0 }, zona: 'UTC' }), '270101');
});

test('rutaDelReporte expande ~ y rechaza terminal rara, .. y rutas relativas', () => {
  assert.equal(rutaDelReporte('~/r/{AAMMDD}-{terminal}.md', { dia: '261027', terminal: 't-2', home: '/h' }), '/h/r/261027-t-2.md');
  assert.throws(() => rutaDelReporte('~/r/{terminal}.md', { dia: '1', terminal: '../x', home: '/h' }), /terminal inválido/);
  assert.throws(() => rutaDelReporte('~/r/../{terminal}.md', { dia: '1', terminal: 't', home: '/h' }), /\.\./);
  assert.throws(() => rutaDelReporte('r/{terminal}.md', { dia: '1', terminal: 't', home: '/h' }), /absoluta/);
});

test('el bloque lleva hora de la zona y build, y exige Hecho, Quedó y Retro', () => {
  const b = armarBloque(CUERPO, { ahoraMs: NOCHE, zona: 'America/Mexico_City', build: 'demo-261027-x' });
  assert.equal(b, `## 22:28 · demo-261027-x\n${CUERPO}\n`);
  assert.match(armarBloque(CUERPO, { ahoraMs: NOCHE, zona: 'UTC' }), /^## 04:28 · sin build\n/);
  assert.throws(() => armarBloque('- Hecho: x\n- Retro: y', { ahoraMs: NOCHE }), /«- Quedó:»/);
  assert.throws(() => armarBloque(CUERPO, { ahoraMs: NOCHE, build: 'a b' }), /build_id inválido/);
});

test('redacta tokens y SHAs largos, pero deja los slugs largos (build_id, ramas)', () => {
  const tok = `ghp_${'a1'.repeat(15)}`;
  const t = redactarReporte(`token ${tok}, slug demo-261027-checkpoint-reporte-x, sha ${'ab12'.repeat(10)}, password=xyz`);
  assert.equal(t.includes(tok), false);
  assert.match(t, /demo-261027-checkpoint-reporte-x/);
  assert.equal(t.includes('ab12'.repeat(10)), false);
  assert.match(t, /password=\[redactado\]/);
  assert.equal(redactarReporte(`xoxb-${'1234567890ab-'.repeat(3)}x`).includes('1234567890ab'), false);
});

test('reportar agrega en el host declarado y, fuera de él, devuelve la dirección sin escribir', () => {
  const escritos = [];
  const base = { cuerpo: CUERPO, terminal: 't-2', build: 'demo-x', descriptor: CONTRATO, ahoraMs: NOCHE, home: '/h',
    escribir: (r, b) => escritos.push([r, b]) };
  const r = reportar({ ...base, host: 'srv1.ejemplo' });
  assert.equal(r.ruta, '/h/notas/dia-261027/reportes/t-2.md');
  assert.equal(escritos.length, 1);
  const l = reportar({ ...base, host: 'otra' });
  assert.equal(l.accion, 'link');
  assert.equal(l.direccion, 'ana/srv1/coord');
  assert.match(l.mensaje, /^link: ana\/srv1\/coord\n\n## 22:28 · demo-x\n/);
  assert.equal(escritos.length, 1);
  assert.equal(reportar({ ...base, host: 'srv1', descriptor: '## Cierre de sesión\n- Reporte: no\n' }).accion, 'no');
});

test('la CLI agrega al archivo sin borrar lo anterior', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reporte-'));
  const desc = path.join(dir, 'CLAUDE.md');
  const ruta = path.join(dir, 'reportes', '{terminal}.md');
  fs.writeFileSync(desc, `## Cierre de sesión\n- Reporte: ${ruta}\n`);
  const correr = (build) => spawnSync(process.execPath,
    [SCRIPT, '--terminal', 't-2', '--build', build, '--descriptor', desc, '--ahora', '2026-10-27T04:28:00Z'],
    { input: CUERPO, encoding: 'utf8', env: { ...process.env, TZ: 'UTC' } });
  for (const b of ['uno-x', 'dos-x']) {
    const r = correr(b);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^agregado: /);
  }
  const txt = fs.readFileSync(path.join(dir, 'reportes', 't-2.md'), 'utf8');
  assert.equal(txt, `## 04:28 · uno-x\n${CUERPO}\n\n## 04:28 · dos-x\n${CUERPO}\n`);
  const malo = spawnSync(process.execPath, [SCRIPT, '--terminal', 't-2'], { input: 'sin secciones', encoding: 'utf8' });
  assert.equal(malo.status, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
