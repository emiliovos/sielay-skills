import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// La skill es pública y genérica: las fuentes propias de un repo salen de su
// descriptor «## Entorno vivo», no de la skill.
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../plugins/si/skills/checkpoint');
const PROHIBIDOS = ['mdpush', 'merge-pr', 'aut#', '/api/', 'sielay.cloud', 'tmux ls'];

function archivos(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? archivos(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

test('ningún archivo de la skill nombra herramientas propias de un repo', () => {
  const hallazgos = [];
  for (const f of archivos(RAIZ)) {
    const txt = fs.readFileSync(f, 'utf8');
    for (const t of PROHIBIDOS) if (txt.includes(t)) hallazgos.push(`${path.relative(RAIZ, f)}: ${t}`);
  }
  assert.deepEqual(hallazgos, []);
});

test('SKILL.md declara la versión 2.7.2 y usa la ruta del script con CLAUDE_SKILL_DIR', () => {
  const md = fs.readFileSync(path.join(RAIZ, 'SKILL.md'), 'utf8');
  assert.match(md, /version: "2\.7\.2"/);
  assert.match(md, /\$\{CLAUDE_SKILL_DIR\}\/scripts\/entorno-vivo\.mjs/);
});

// mejora-continua también es pública: la ruta de la bitácora sale del
// «## Cierre de sesión» del repo, nunca de una ruta fija de la skill.
const RAIZ_MC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../plugins/si/skills/mejora-continua');

test('mejora-continua no nombra herramientas ni rutas propias de un repo', () => {
  const hallazgos = [];
  for (const f of archivos(RAIZ_MC)) {
    const txt = fs.readFileSync(f, 'utf8');
    for (const t of [...PROHIBIDOS, '/home/', '~/handoffs']) if (txt.includes(t)) hallazgos.push(`${path.relative(RAIZ_MC, f)}: ${t}`);
  }
  assert.deepEqual(hallazgos, []);
});

test('mejora-continua declara la versión 1.0.3 y usa la ruta del script con CLAUDE_SKILL_DIR', () => {
  const md = fs.readFileSync(path.join(RAIZ_MC, 'SKILL.md'), 'utf8');
  assert.match(md, /version: "1\.0\.3"/);
  assert.match(md, /\$\{CLAUDE_SKILL_DIR\}\/scripts\/bitacora\.mjs/);
});
