// Datos fijos compartidos por las pruebas de checkpoint.
export const ESC = `'"'"'`;

// Envoltorio que el claude le da a cada llamada Bash.
export function envoltorio(cmd, { preambulo = 'export CK_SESSION="abc"\nexport CK_TOKEN="x"' } = {}) {
  return `/bin/bash -c source /x/shell-snapshots/snapshot-bash-1-ab.sh 2>/dev/null || true && ${preambulo}\n`
    + `: && shopt -u extglob 2>/dev/null || true && eval '${cmd.split("'").join(ESC)}' && pwd -P >| /tmp/claude-e1ac-cwd`;
}

export const T0 = Date.parse('2026-10-27T01:00:00Z');
export const rec = (pid, ppid, pgid, comm, minutos = 0) => ({ pid, ppid, pgid, comm, inicioMs: T0 + minutos * 60000 });

// claude 100 -> [llamada actual 200 -> node 201] + hijos de distinto tipo.
export function arbol() {
  const tabla = [
    rec(1, 0, 1, 'init'),
    rec(100, 1, 100, 'claude'),
    rec(200, 100, 200, 'bash', 40),
    rec(201, 200, 200, 'node', 40),
    rec(300, 100, 300, 'bash', 5),
    rec(301, 300, 300, 'sleep', 5),
    rec(310, 100, 310, 'node', 10),
    rec(320, 100, 999, 'bash', 15),
    rec(330, 100, 330, 'bash', 20),
    rec(340, 100, 340, 'bash', 30),
  ];
  const cmd = new Map([
    [200, envoltorio('node entorno-vivo.mjs')],
    [201, 'node entorno-vivo.mjs'],
    [300, envoltorio("until [ -f /tmp/listo ]; do sleep 5; done; echo 'fin'")],
    [301, 'sleep 5'],
    [310, 'node server.js --token=abc123'],
    [320, envoltorio('tail -f /tmp/log')],
    [330, '/bin/bash -c source /x/shell-snapshots/snapshot-bash-2.sh && sin eval'],
    [340, envoltorio("until [ -f /tmp/listo ]; do sleep 5; done; echo 'fin'")],
  ]);
  const fuente = { plataforma: 'test', listar: () => tabla, cmdline: (pid) => cmd.get(pid) ?? null };
  return { tabla, fuente };
}
