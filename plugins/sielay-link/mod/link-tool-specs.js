// The JSON schemas of the tools the model gets (link-tools.js runs them).
// Pure.

import { BUILD_TOOL_SPEC } from './link-build-tool.js'
import { WATCH_TOOL_SPEC } from './link-watch-tool.js'
import { READ_TOOL_SPEC } from './link-read-tool.js'

/** The hub's cap for `to` as a list (one conversation per address). */
export const MAX_RECIPIENTS = 10

/** @type {ReadonlyArray<{ name: string, description: string, inputSchema: Record<string, unknown>, isDeferred: false }>} */
export const LINK_TOOL_SPECS = Object.freeze([
  {
    name: 'link_send',
    description:
      'Envía un mensaje a otra sesión de Claude Code emparejada por sielay-link (dirección persona/máquina/sesión; ' +
      'usa link_peers para verlas). Abre una conversación nueva salvo que pases `conversation`. Con `to` como lista ' +
      `(hasta ${MAX_RECIPIENTS} direcciones, sin conversation) abre una conversación con cada una y responde un resultado por destino. ` +
      'El hub decide si el receptor lo ejecuta solo o lo deja en su franja para que una persona lo acepte.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['to', 'text'],
      properties: {
        to: {
          anyOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: MAX_RECIPIENTS },
          ],
          description: 'Dirección destino persona/máquina/sesión, o una lista de hasta 10',
        },
        text: { type: 'string', description: 'Texto del mensaje (máximo 16 KB)' },
        conversation: { type: 'string', description: 'Id de una conversación existente (opcional)' },
        attachment: {
          type: 'object', additionalProperties: false, required: ['name', 'text'],
          description: 'Un adjunto de texto (p. ej. resumen.json) de hasta 64 KB',
          properties: { name: { type: 'string', description: 'Nombre: letras, números, punto, guion' }, text: { type: 'string', description: 'Contenido' } },
        },
      },
    },
    isDeferred: false,
  },
  {
    name: 'link_reply',
    description:
      'Responde en una conversación de sielay-link que llegó con el encabezado [sielay-link de=… conv=…]. ' +
      'Usa el valor de conv como `conversation`. Pon end=true para cerrar la conversación.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['conversation', 'text'],
      properties: {
        conversation: { type: 'string', description: 'El conv= del encabezado' },
        text: { type: 'string', description: 'Texto de la respuesta (máximo 16 KB)' },
        end: { type: 'boolean', description: 'Cierra la conversación después de esta respuesta' },
        attachment: {
          type: 'object', additionalProperties: false, required: ['name', 'text'],
          description: 'Un adjunto de texto (p. ej. resumen.json) de hasta 64 KB',
          properties: { name: { type: 'string', description: 'Nombre: letras, números, punto, guion' }, text: { type: 'string', description: 'Contenido' } },
        },
      },
    },
    isDeferred: false,
  },
  {
    name: 'link_peers',
    description:
      'Lista las sesiones de Claude Code con las que esta sesión puede hablar por sielay-link (las de tus máquinas y las de ' +
      'máquinas conectadas) y tu propia dirección. Úsala antes de link_send cuando te pidan escribirle a otra sesión.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        online_only: { type: 'boolean', description: 'Solo las sesiones en línea, de la más activa a la menos (por defecto). false trae también las desconectadas' },
      },
    },
    isDeferred: false,
  },
  READ_TOOL_SPEC,
  BUILD_TOOL_SPEC,
  WATCH_TOOL_SPEC,
])

/** What SIELAY_LINK_MINIMAL=1 leaves out: the build report and the CI watch, about 3/4 of the schemas' size. */
export const MINIMAL_LEFT_OUT = Object.freeze(['link_build_stage', 'link_watch'])

/**
 * The tools a session registers: all of them, or in minimal mode only the
 * three that send, reply and list peers.
 * @param {{ minimal: boolean }} mode
 */
export function toolSpecsFor({ minimal }) {
  return minimal ? LINK_TOOL_SPECS.filter(s => !MINIMAL_LEFT_OUT.includes(s.name)) : LINK_TOOL_SPECS
}
