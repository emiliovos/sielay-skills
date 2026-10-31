// Estado git por repo: porcelain, adelante del upstream, worktrees y PRs.
import { spawnSync } from 'node:child_process';

export function ejecutar(cmd, args, { cwd, timeout = 15000 } = {}) {
  const r = spawnSync(cmd, args, { cwd, timeout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error) return { ok: false, salida: '', error: r.error.code ?? String(r.error.message) };
  return { ok: r.status === 0, salida: r.stdout ?? '', error: r.stderr ?? '' };
}

const MAX_SUCIO = 50;

export function parseWorktrees(texto) {
  return texto.split('\n').filter(Boolean).map((l) => {
    const m = /^(.*?)\s+[0-9a-f]{7,40}\s+(?:\[(.+)\]|\(detached HEAD\))/.exec(l);
    return m ? `${m[1]} ${m[2] ?? '(detached)'}` : l.trim();
  });
}

export function parsePrs(json) {
  const lista = JSON.parse(json);
  if (!Array.isArray(lista)) throw new Error('respuesta de gh inesperada');
  return lista.map((p) => ({ n: p.number, rama: p.headRefName, titulo: p.title }));
}

export function estadoGit(repo, run = ejecutar) {
  const g = (...args) => run('git', ['-C', repo, ...args]);
  if (!g('rev-parse', '--show-toplevel').ok) return { repo, error: 'no es un repo git' };
  const rama = g('rev-parse', '--abbrev-ref', 'HEAD');
  const estado = g('status', '--porcelain');
  const sucio = estado.ok ? estado.salida.split('\n').filter(Boolean) : [];
  let sinUpstream = false;
  let adelante = null;
  const conUpstream = g('rev-list', '--count', '@{u}..');
  if (conUpstream.ok) adelante = Number(conUpstream.salida.trim());
  else {
    sinUpstream = true;
    const contraOrigen = g('rev-list', '--count', 'origin/HEAD..');
    if (contraOrigen.ok) adelante = Number(contraOrigen.salida.trim());
  }
  const wt = g('worktree', 'list');
  const gh = run('gh', ['pr', 'list', '--state', 'open', '--limit', '20', '--json', 'number,headRefName,title'],
    { cwd: repo, timeout: 10000 });
  let prs = null;
  if (gh.ok) { try { prs = parsePrs(gh.salida); } catch { prs = null; } }
  return {
    repo,
    rama: rama.ok ? rama.salida.trim() : null,
    estado_ok: estado.ok,
    sucio: sucio.slice(0, MAX_SUCIO),
    sucio_total: sucio.length,
    adelante,
    sin_upstream: sinUpstream,
    worktrees: wt.ok ? parseWorktrees(wt.salida) : [],
    prs,
  };
}
