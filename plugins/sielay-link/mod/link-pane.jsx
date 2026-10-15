// The sielay-link pane: connection status, the pairing flow (user code, the
// approval link, the token only while it must be shown), and the strip. The
// selected strip message is shown in full (sanitized and neutralized) with
// Aceptar/Rechazar acting on that id, so a person reads before accepting.

import { neutralizeBody } from './link-inbound-framing.js'
import { shortId } from './link-strip-selection.js'
import { decideStripItem, showStripItem, oneLine, bodyPreview } from './link-band.jsx'

// $.state references: literal plugin/key, declared in each file that uses them.
const STATUS = /** @type {const} */ ({ plugin: 'sielay-link', key: 'status' })
const PAIRING = /** @type {const} */ ({ plugin: 'sielay-link', key: 'pairing' })
const STRIP = /** @type {const} */ ({ plugin: 'sielay-link', key: 'strip' })
const SELECTED = /** @type {const} */ ({ plugin: 'sielay-link', key: 'selected' })

/** @typedef {import('claude-code').EngineInterface} Engine */
/** @typedef {import('./link-runtime.js').Runtime} Runtime */

/**
 * @param {Engine} $
 * @param {import('claude-code').RenderInput<'Pane'>} e
 * @param {Runtime} rt
 * @returns {Promise<import('claude-code').RenderElement>}
 */
export async function renderPane($, e, rt) {
  const [{ value: st }, { value: pairing = null }, { value: strip = [] }, { value: selectedId = null }] = await Promise.all([
    $.state.get(STATUS),
    $.state.get(PAIRING),
    $.state.get(STRIP),
    $.state.get(SELECTED),
  ])
  const { Box, Text, Button } = $.ui.resolve(e)
  const selected = strip.find(d => d.id === selectedId)

  return (
    <Box flexDirection="column">
      <Text bold>sielay-link · {st?.loop ?? 'iniciando'}</Text>
      {st?.detail ? <Text dimColor>{oneLine(st.detail, 200)}</Text> : null}
      <Text>Dirección: {oneLine(st?.address ?? '(sin asignar)', 120)} · hub: {st?.hub ?? '—'} · entrega: {st?.adapter ?? '—'}</Text>
      {pairing?.phase === 'waiting' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>Emparejando el slot {pairing.slot}. Código: <Text bold>{oneLine(pairing.user_code, 40)}</Text></Text>
          <Text dimColor>Un admin lo aprueba {pairing.verification_uri ? `en ${oneLine(pairing.verification_uri, 200)}` : 'en el dashboard'} (con 2FA).</Text>
        </Box>
      ) : null}
      {pairing?.phase === 'done' ? (
        <Box flexDirection="column" marginTop={1}>
          {pairing.token ? <Text bold>Token de sielay-link (cópialo ahora):</Text> : null}
          {pairing.token ? <Text>{pairing.token}</Text> : null}
          <Text dimColor>{pairing.note}</Text>
          {pairing.token ? <Button key="hide-token" label="Ocultar token" onPress={() => $.state.set(PAIRING, null)} /> : null}
        </Box>
      ) : null}
      {pairing?.phase === 'error' ? <Text color="red">{pairing.message}</Text> : null}
      {selected ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>
            Mensaje {shortId(selected.id)} de {oneLine(selected.from?.address ?? '?', 80)} · conv {oneLine(selected.conversation_id, 40)} · turno {selected.turn ?? '?'}/{selected.max_turns ?? '?'}
          </Text>
          <Text>{neutralizeBody(selected.body)}</Text>
          <Box marginTop={1}>
            <Button key={`pane-accept-${selected.id}`} label={`Aceptar ${shortId(selected.id)}`} variant="primary" onPress={() => decideStripItem($, rt, selected.id, 'accept')} />
            <Text> </Text>
            <Button key={`pane-reject-${selected.id}`} label="Rechazar" onPress={() => decideStripItem($, rt, selected.id, 'reject')} />
            <Text> </Text>
            <Button key="pane-close" label="Cerrar" onPress={() => $.state.set(SELECTED, null)} />
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Text>En franja: {strip.length}{strip.length ? ' (elige uno para leerlo completo)' : ''}</Text>
          {strip.slice(0, 8).map(d => (
            <Button key={`pick-${d.id}`} plain onPress={() => showStripItem($, d.id)}>
              {shortId(d.id)} de {oneLine(d.from?.address ?? '?', 60)} <Text dimColor>{bodyPreview(d.body, 60)}</Text>
            </Button>
          ))}
        </Box>
      )}
    </Box>
  )
}
