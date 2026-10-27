#!/usr/bin/env node
// Bloque de reporte del checkpoint: lo agrega, sin borrar lo anterior, al
// archivo que declara la línea «Reporte» del contrato de cierre, o dice a qué
// dirección mandarlo por link cuando la sesión corre fuera del host declarado.
// El cuerpo llega por stdin; el encabezado (hora · build) lo pone el script.
// Salida: 0 hecho, 1 error. Solo escribe en el archivo del reporte.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactar } from './redactar.mjs';

const USO = 'uso: reporte.mjs --terminal <nombre> [--build <build_id>] [--descriptor <CLAUDE.md>] [--ahora <ISO>] < cuerpo.md';
export const RUTA_POR_DEFECTO = '~/handoffs/reportes/{AAMMDD}-{terminal}.md';
const NOMBRE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SECCIONES = ['Hecho', 'Quedó', 'Retro'];

// Lee «- Reporte: …» de la sección «## Cierre de sesión». Sin la línea, vale
// el valor por defecto; una parte que no se entiende es error (no se adivina).
export function parseReporte(texto) {
  const lineas = String(texto ?? '').split('\n');
  const ini = lineas.findIndex((l) => /^##\s+Cierre de sesión\s*$/i.test(l));
  let valor = null;
  if (ini >= 0) {
    for (const l of lineas.slice(ini + 1)) {
      if (/^##\s/.test(l)) break;
      const m = /^-\s+Reporte:\s*(.*?)\s*$/.exec(l);
      if (m) { valor = m[1]; break; }
    }
  }
  if (valor === null) return { ruta: RUTA_POR_DEFECTO, porDefecto: true };
  const [primera, ...resto] = valor.split(';').map((p) => p.trim()).filter(Boolean);
  if (!primera) throw new Error('la línea Reporte está vacía');
  if (primera === 'no') return { no: true };
  const r = { ruta: primera };
  for (const p of resto) {
    const corte = /^corte\s+(\d{1,2}):(\d{2})(?:\s+(\S+))?$/.exec(p);
    const fuera = /^fuera de\s+([A-Za-z0-9-]+):\s*link\s+(\S+)$/.exec(p);
    if (corte && Number(corte[1]) < 24 && Number(corte[2]) < 60 && Number(corte[1]) + Number(corte[2]) > 0) {
      r.corte = { h: Number(corte[1]), m: Number(corte[2]) };
      if (corte[3]) r.zona = zonaValida(corte[3]);
    } else if (fuera) r.fuera = { host: fuera[1], link: fuera[2] };
    else throw new Error(`parte de Reporte que no se entiende: «${p}»`);
  }
  return r;
}

function zonaValida(zona) {
  try { new Intl.DateTimeFormat('en', { timeZone: zona }); } catch { throw new Error(`zona desconocida: «${zona}»`); }
  return zona;
}

// Fecha y hora de pared en la zona (o la local del proceso, sin zona).
export function relojEn(ahoraMs, zona) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ahoraMs)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute) };
}

// Día del reporte: con corte, lo que pasa a partir de la hora del corte va al
// reporte del día siguiente (la noche se lee en el reporte de la mañana).
export function diaDelReporte(ahoraMs, { corte, zona } = {}) {
  const r = relojEn(ahoraMs, zona);
  const sumar = corte && (r.h * 60 + r.mi >= corte.h * 60 + corte.m) ? 1 : 0;
  const d = new Date(Date.UTC(r.y, r.mo - 1, r.d + sumar));
  const dos = (n) => String(n).padStart(2, '0');
  return `${dos(d.getUTCFullYear() % 100)}${dos(d.getUTCMonth() + 1)}${dos(d.getUTCDate())}`;
}

export function rutaDelReporte(plantilla, { dia, terminal, home }) {
  if (!NOMBRE.test(terminal)) throw new Error(`nombre de terminal inválido: «${terminal}»`);
  const r = plantilla.replaceAll('{AAMMDD}', dia).replaceAll('{terminal}', terminal);
  if (r.split(/[\\/]/).some((t) => t.startsWith('.'))) throw new Error('la ruta del reporte no puede llevar .. ni carpetas o archivos ocultos');
  const abs = r.startsWith('~/') ? path.join(home, r.slice(1)) : r;
  if (!path.isAbsolute(abs)) throw new Error('la ruta del reporte debe ser absoluta o empezar con ~/');
  if (!abs.startsWith(path.join(home, path.sep)) || !abs.endsWith('.md')) throw new Error('el reporte debe ser un .md dentro del home');
  return abs;
}

// Un slug legible (build_id, rama: tramos de solo minúsculas o solo dígitos,
// de hasta 16, unidos por - _ . /) no es un token aunque mida 32 o más; la
// regla genérica de redactar lo borraría. Un tramo mixto (UUID, base64) o un
// prefijo de token conocido en cualquier tramo nunca se guarda como slug.
const SLUG = /(?<![A-Za-z0-9_-])(?:[a-z]{1,16}|[0-9]{1,16})(?:[-_./](?:[a-z]{1,16}|[0-9]{1,16}))+(?![A-Za-z0-9_-])/g;
const PREFIJO_TOKEN = /(?:^|[-_./])(?:gh[pousr]_|github_pat|sk-|xox[abpr]-|aiza|akia|asia|eyj)/i;
export function redactarReporte(texto) {
  const guardados = [];
  const t = String(texto ?? '').replace(SLUG, (s) => {
    if (s.length < 32 || PREFIJO_TOKEN.test(s)) return s;
    guardados.push(s);
    return `\u0000${guardados.length - 1}\u0000`;
  });
  return redactar(t).replace(/\u0000(\d+)\u0000/g, (_, i) => guardados[Number(i)]);
}

export function armarBloque(cuerpo, { ahoraMs, zona, build }) {
  const c = redactarReporte(String(cuerpo ?? '').trim());
  const faltan = SECCIONES.filter((s) => !new RegExp(`^- ${s}:`, 'm').test(c));
  if (faltan.length) throw new Error(`al bloque le falta: ${faltan.map((s) => `«- ${s}:»`).join(', ')}`);
  const r = relojEn(ahoraMs, zona);
  const hora = `${String(r.h).padStart(2, '0')}:${String(r.mi).padStart(2, '0')}`;
  if (build && !NOMBRE.test(build)) throw new Error(`build_id inválido: «${build}»`);
  return `## ${hora} · ${build || 'sin build'}\n${c}\n`;
}

export function reportar({ cuerpo, terminal, build, descriptor, ahoraMs, host, home, escribir }) {
  const c = parseReporte(descriptor);
  if (c.no) return { accion: 'no', mensaje: 'no: el contrato dice «Reporte: no»' };
  const bloque = armarBloque(cuerpo, { ahoraMs, zona: c.zona, build });
  const corto = String(host).split('.')[0].toLowerCase();
  if (c.fuera && corto !== c.fuera.host.toLowerCase()) {
    return { accion: 'link', direccion: c.fuera.link, bloque, mensaje: `link: ${c.fuera.link}\n\n${bloque}` };
  }
  const ruta = rutaDelReporte(c.ruta, { dia: diaDelReporte(ahoraMs, c), terminal, home });
  escribir(ruta, bloque);
  return { accion: 'agregado', ruta, mensaje: `agregado: ${ruta}${c.porDefecto ? ' (valor por defecto)' : ''}` };
}

function agregarAlArchivo(ruta, bloque) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const st = fs.lstatSync(ruta, { throwIfNoEntry: false });
  if (st && !st.isFile()) throw new Error(`el reporte no es un archivo normal: ${ruta}`);
  const previo = Boolean(st && st.size > 0);
  fs.appendFileSync(ruta, previo ? `\n${bloque}` : bloque);
}

export function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!['--terminal', '--build', '--descriptor', '--ahora'].includes(a)) throw new Error(`argumento desconocido: ${a}`);
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) throw new Error(`${a} necesita un valor`);
    o[a.slice(2)] = v;
  }
  if (!o.terminal) throw new Error('falta --terminal');
  if (o.ahora !== undefined && !Number.isFinite(Date.parse(o.ahora))) throw new Error('--ahora no es una fecha ISO');
  return o;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const o = parseArgs(process.argv.slice(2));
    const r = reportar({
      cuerpo: fs.readFileSync(0, 'utf8'),
      terminal: o.terminal,
      build: o.build,
      descriptor: o.descriptor ? fs.readFileSync(o.descriptor, 'utf8') : '',
      ahoraMs: o.ahora ? Date.parse(o.ahora) : Date.now(),
      host: os.hostname(),
      home: os.homedir(),
      escribir: agregarAlArchivo,
    });
    console.log(r.mensaje);
  } catch (e) {
    console.error(`reporte: ${e.message}\n${USO}`);
    process.exit(1);
  }
}
