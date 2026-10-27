// Salida en markdown del inventario, lista para pegar en el handoff.
// Con segundos: un vigía armado en el mismo minuto del handoff debe quedar antes de `desde`.
const hora = (iso) => iso;

function lineaGit(g) {
  if (g.error) return `- git: ${g.repo} · ${g.error}`;
  const partes = [`${g.repo} ${g.rama ?? '(sin rama)'}`, `${g.sucio_total} sin commit`];
  if (g.sin_upstream) partes.push(`sin upstream${g.adelante == null ? '' : ` (${g.adelante} sin push vs origin/HEAD)`}`);
  else partes.push(`${g.adelante ?? '?'} sin push`);
  if (g.prs === null) partes.push('PRs: sin datos');
  else if (g.prs.length) partes.push(g.prs.map((p) => `PR #${p.n}${p.rama === g.rama ? '' : ` (${p.rama})`}`).join(', '));
  return `- git: ${partes.join(' · ')}`;
}

function lineasDescriptor(d) {
  if (d.tipo === 'contexto') return [`- ${d.fuente}: contexto — ${d.texto} (completar con lo que sabe la sesión)`];
  if (!d.ejecutado) return [`- ${d.fuente}: no se corre (${d.motivo}): ${d.comando}`];
  const cuerpo = d.salida ? d.salida.split('\n').map((l) => `  ${l}`) : ['  (sin salida)'];
  return [`- ${d.fuente}${d.ok ? '' : ' (el comando falló)'}:`, ...cuerpo];
}

export function renderMarkdown(r) {
  const out = [`## ENTORNO VIVO (${hora(r.generado)})`];
  if (r.claude) {
    const c = r.claude;
    out.push(`- claude: pid ${c.pid}${c.name ? ` · sesión ${c.name}` : ''}${c.tmux ? ` · tmux ${c.tmux}` : ''}`);
  } else out.push('- claude: no se encontró un claude ancestro');
  if (r.procesos === null) out.push('- procesos: sin inventario de procesos en esta plataforma');
  else if (!r.procesos.length) out.push('- procesos: ninguno');
  for (const p of r.procesos ?? []) {
    out.push(`- pid ${p.pid} · inicio ${p.inicio} · ${p.tipo} · ${p.comando} (vigía: no)`);
  }
  for (const g of r.git) out.push(lineaGit(g));
  if (r.sesiones.length) {
    out.push(`- otras sesiones: ${r.sesiones.map((s) => `${s.name ?? s.pid} (${s.status ?? '?'}${s.tmux ? `, ${s.tmux}` : ''})`).join('; ')}`);
  }
  if (r.descriptor_rechazado) out.push(`- descriptor: rechazado (${r.descriptor_rechazado})`);
  for (const d of r.descriptor ?? []) out.push(...lineasDescriptor(d));
  const v = r.verificacion;
  if (v) {
    out.push(`## VERIFICACIÓN (handoff de ${hora(v.desde)})`);
    for (const m of v.muertos) out.push(`- muerto: pid ${m.pid} · ${m.comando}`);
    for (const h of v.huerfanos) {
      out.push(`- huérfano: pid ${h.pid} · inicio ${h.inicio} · ${h.tipo} · vigía: ${h.vigia === true ? 'sí' : h.vigia === false ? 'no' : 'desconocido'} · ${h.comando}`);
    }
    for (const d of v.duplicados) out.push(`- duplicado: pids ${d.pids.join(', ')} · ${d.comando}`);
    for (const a of v.vivos_ajenos) out.push(`- vivo ajeno (no cuelga de este claude, solo se reporta): pid ${a.pid} · inicio ${a.inicio} · ${a.comando}`);
    for (const n of v.nuevos) out.push(`- nuevo: pid ${n.pid} · inicio ${n.inicio} · ${n.comando}`);
    if (!v.muertos.length && !v.huerfanos.length && !v.duplicados.length) out.push('- limpio: nada muerto, huérfano ni duplicado');
  }
  return out.join('\n');
}
