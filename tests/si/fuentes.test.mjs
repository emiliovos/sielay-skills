import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStat, parseBtime, parseCmdline, parsePs, fuenteLinux, fuenteMac } from '../../plugins/si/skills/checkpoint/scripts/fuentes.mjs';

// Campos después del último ')': estado ppid pgrp session tty tpgid flags minflt cminflt majflt cmajflt utime stime cutime cstime prio nice threads itrealvalue starttime
const stat = (pid, comm, ppid, pgid, ticks) =>
  `${pid} (${comm}) S ${ppid} ${pgid} 1 0 -1 4194304 10 0 0 0 1 1 0 0 20 0 1 0 ${ticks} 8069120 896`;

test('parseStat lee el campo 22 después del último paréntesis', () => {
  const s = parseStat(stat(42, 'a) (b c', 7, 42, 123456));
  assert.deepEqual(s, { pid: 42, ppid: 7, pgid: 42, ticks: 123456, comm: 'a) (b c' });
});

test('parseStat rechaza texto roto', () => {
  assert.equal(parseStat('basura'), null);
  assert.equal(parseStat('1 (x) S'), null);
});

test('parseBtime y parseCmdline', () => {
  assert.equal(parseBtime('cpu 1 2\nbtime 1793040703\nprocesses 5'), 1793040703);
  assert.equal(parseBtime('nada'), null);
  assert.equal(parseCmdline('node\0a b\0--x\0'), 'node a b --x');
});

test('fuenteLinux arma la tabla con btime + ticks y salta procesos que murieron', () => {
  const archivos = {
    '/proc/stat': 'cpu 0\nbtime 1000\n',
    '/proc/10/stat': stat(10, 'claude', 1, 10, 500),
    '/proc/11/stat': stat(11, 'bash', 10, 11, 1500),
    '/proc/11/cmdline': 'bash\0-c\0eval x\0',
  };
  const io = {
    readdirSync: () => ['10', '11', '12', 'self', 'cpuinfo'],
    readFileSync: (p) => { if (p in archivos) return archivos[p]; throw Object.assign(new Error('x'), { code: 'ENOENT' }); },
  };
  const f = fuenteLinux(io);
  assert.deepEqual(f.listar(), [
    { pid: 10, ppid: 1, pgid: 10, comm: 'claude', ticks: 500, inicioMs: 1005000 },
    { pid: 11, ppid: 10, pgid: 11, comm: 'bash', ticks: 1500, inicioMs: 1015000 },
  ]);
  assert.equal(f.cmdline(11), 'bash -c eval x');
  assert.equal(f.cmdline(99), null);
});

const PS = ` 1     0     1 Mon Oct 26 08:00:00 2026 /sbin/launchd
 500 1 500 Mon Oct 26 09:15:07 2026 /usr/local/bin/claude --resume
 501   500   501 Tue Oct  6 19:21:19 2026 /bin/bash -c source /x/snapshot-1.sh && eval 'sleep 5' && pwd -P >| /tmp/c
linea rara
`;

test('parsePs lee pid, ppid, pgid, lstart y comando', () => {
  const t = parsePs(PS);
  assert.equal(t.length, 3);
  assert.deepEqual([t[1].pid, t[1].ppid, t[1].pgid, t[1].comm], [500, 1, 500, 'claude']);
  assert.equal(t[1].inicioMs, new Date(2026, 9, 26, 9, 15, 7).getTime());
  assert.equal(t[2].inicioMs, new Date(2026, 9, 6, 19, 21, 19).getTime());
  assert.match(t[2].cmdline, /^\/bin\/bash -c source/);
});

test('fuenteMac pide ps sin recorte de línea y fuerza el locale C', () => {
  let llamada;
  const f = fuenteMac((cmd, args, opts) => { llamada = [cmd, args, opts]; return PS; });
  assert.equal(f.listar().length, 3);
  assert.equal(llamada[0], 'ps');
  assert.deepEqual(llamada[1], ['-ww', '-A', '-o', 'pid=,ppid=,pgid=,lstart=,command=']);
  assert.equal(llamada[2].env.LC_ALL, 'C');
  assert.match(f.cmdline(501), /eval 'sleep 5'/);
});

test('fuenteMac: una línea larga llega entera hasta el eval del envoltorio', () => {
  const largo = `/bin/bash -c source /x/shell-snapshots/snapshot-bash-1.sh 2>/dev/null || true && ${'export CK_X="valor largo"\n'.repeat(120)}: && shopt -u extglob 2>/dev/null || true && eval 'until [ -f /tmp/listo ]; do sleep 5; done' && pwd -P >| /tmp/c`;
  assert.ok(largo.length > 3000);
  const t = parsePs(` 77 1 77 Mon Oct 26 09:15:07 2026 ${largo.replace(/\n/g, ' ')}`);
  assert.equal(t.length, 1);
  assert.match(t[0].cmdline, /eval 'until \[ -f \/tmp\/listo \]; do sleep 5; done' && pwd -P/);
});
