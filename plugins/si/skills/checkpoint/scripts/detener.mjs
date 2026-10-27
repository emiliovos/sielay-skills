// --detener <pid>: único camino que mata algo. Solo hijos directos del claude
// propio, líderes de su grupo, y con el inicio recomprobado justo antes.
export function detener({ pid, inicioEsperado, claudePid, propioPid, leerTabla, procesos, kill }) {
  const recientes = (tabla) => tabla.find((p) => p.pid === pid);
  const antes = recientes(leerTabla());
  if (!antes) return { ok: false, motivo: `el pid ${pid} ya no existe` };
  if (pid === claudePid || pid === propioPid) return { ok: false, motivo: 'ese pid es la sesión o esta llamada' };
  const item = procesos().find((p) => p.pid === pid);
  if (!item) return { ok: false, motivo: `el pid ${pid} no es hijo directo del claude propio (${claudePid})` };
  if (item.tipo === 'otro') return { ok: false, motivo: 'tipo otro: no se detiene nunca, solo se lista' };
  const ahora = recientes(leerTabla());
  if (!ahora) return { ok: false, motivo: `el pid ${pid} ya no existe` };
  if (ahora.ppid !== claudePid) return { ok: false, motivo: 'el padre cambió: ya no es hijo del claude propio' };
  if (ahora.pgid !== pid) return { ok: false, motivo: 'no es líder de su grupo (pgid distinto del pid)' };
  if (ahora.inicioMs !== antes.inicioMs) return { ok: false, motivo: 'el inicio cambió: pid reciclado' };
  if (inicioEsperado != null && Math.abs(ahora.inicioMs - inicioEsperado) > 2000) {
    return { ok: false, motivo: 'el inicio no coincide con el esperado: pid reciclado' };
  }
  try { kill(-ahora.pgid, 'SIGTERM'); } catch (e) { return { ok: false, motivo: `kill falló: ${e.code ?? e.message}` }; }
  return { ok: true, pid, grupo: ahora.pgid };
}
