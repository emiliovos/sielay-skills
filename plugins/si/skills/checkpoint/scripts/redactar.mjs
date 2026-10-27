// Redacción de secretos para todo texto que sale del script (comandos de
// procesos, salida de comandos del descriptor). Se redacta ANTES de recortar:
// recortar primero podría dejar un fragmento de secreto sin reconocer.
const REGLAS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[redactado]'],
  [/Authorization:\s*\S+(\s+\S+)?/gi, 'Authorization: [redactado]'],
  [/Bearer\s+\S+/g, 'Bearer [redactado]'],
  [/--token[= ]\S+/g, '--token=[redactado]'],
  [/\b(token|password|passwd|secret|api[_-]?key)=\S+/gi, '$1=[redactado]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[redactado]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[redactado]'],
  [/\bsk-[A-Za-z0-9-]{20,}/g, '[redactado]'],
  [/\b(AKIA|ASIA)[0-9A-Z]{16}/g, '[redactado]'],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/g, '[redactado]'],
  [/\beyJ[A-Za-z0-9_-]{8,}(\.[A-Za-z0-9_-]+)*/g, '[redactado]'],
  [/[A-Za-z0-9_-]{32,}/g, '[redactado]'],
];

export function redactar(texto) {
  let t = String(texto ?? '');
  for (const [re, por] of REGLAS) t = t.replace(re, por);
  return t;
}

export function recortar(texto, max = 160) {
  const t = String(texto).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
