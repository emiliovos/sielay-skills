// The sielay-link pane: connection status, the pairing flow (user code, the
// approval link, and the token shown once), and the strip.

// $.state references: literal plugin/key, declared in each file that uses them.
const STATUS = /** @type {const} */ ({ plugin: 'sielay-link', key: 'status' })
const PAIRING = /** @type {const} */ ({ plugin: 'sielay-link', key: 'pairing' })
const STRIP = /** @type {const} */ ({ plugin: 'sielay-link', key: 'strip' })

/** @typedef {import('claude-code').EngineInterface} Engine */

/**
 * @param {Engine} $
 * @param {import('claude-code').RenderInput<'Pane'>} e
 * @returns {Promise<import('claude-code').RenderElement>}
 */
export async function renderPane($, e) {
  const [{ value: st }, { value: pairing = null }, { value: strip = [] }] = await Promise.all([
    $.state.get(STATUS),
    $.state.get(PAIRING),
    $.state.get(STRIP),
  ])
  const { Box, Text, Button } = $.ui.resolve(e)

  return (
    <Box flexDirection="column">
      <Text bold>sielay-link · {st?.loop ?? 'iniciando'}</Text>
      {st?.detail ? <Text dimColor>{st.detail}</Text> : null}
      <Text>Dirección: {st?.address ?? '(sin asignar)'} · hub: {st?.hub ?? '—'} · entrega: {st?.adapter ?? '—'}</Text>
      {pairing?.phase === 'waiting' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>Emparejando el slot {pairing.slot}. Código: <Text bold>{pairing.user_code}</Text></Text>
          <Text dimColor>Un admin lo aprueba {pairing.verification_uri ? `en ${pairing.verification_uri}` : 'en el dashboard'} (con 2FA).</Text>
        </Box>
      ) : null}
      {pairing?.phase === 'done' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Token de sielay-link (se muestra una sola vez):</Text>
          <Text>{pairing.token}</Text>
          <Text dimColor>{pairing.note}</Text>
          <Button key="hide-token" label="Ocultar token" onPress={() => $.state.set(PAIRING, null)} />
        </Box>
      ) : null}
      {pairing?.phase === 'error' ? <Text color="red">{pairing.message}</Text> : null}
      <Box flexDirection="column" marginTop={1}>
        <Text>En franja: {strip.length}</Text>
        {strip.slice(0, 5).map(d => (
          <Text key={d.id} dimColor>
            · de {d.from?.address ?? '?'} (conv {d.conversation_id}, turno {d.turn ?? '?'})
          </Text>
        ))}
      </Box>
    </Box>
  )
}
