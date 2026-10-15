// The strip band above the prompt: "link: N en franja" with [1 Aceptar] and
// [2 Rechazar] on the first message. Only a person's press decides; the
// model has no tool for it. Yields to a survey.

import { neutralizeBody } from './link-inbound-framing.js'
import { decisionContext } from './link-runtime.js'

// $.state references: literal plugin/key, declared in each file that uses them.
const STRIP = /** @type {const} */ ({ plugin: 'sielay-link', key: 'strip' })
const NOTICE = /** @type {const} */ ({ plugin: 'sielay-link', key: 'notice' })

/** @typedef {import('claude-code').EngineInterface} Engine */
/** @typedef {import('./link-runtime.js').Runtime} Runtime */

/**
 * @param {Engine} $ @param {Runtime} rt @param {string} id @param {'accept'|'reject'} action
 */
export async function decideFromBand($, rt, id, action) {
  try {
    if (!rt.handler) throw new Error('sielay-link no arrancó')
    const ctx = await decisionContext($, rt, id)
    const r = action === 'accept' ? await rt.handler.accept(id, ctx) : await rt.handler.reject(id, ctx)
    await $.state.set(NOTICE, r.ok ? null : `sielay-link: ${r.error}`)
  } catch (err) {
    await $.state.set(NOTICE, `sielay-link: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** @param {string} text @param {number} max */
function oneLine(text, max) {
  const flat = neutralizeBody(text).replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * @param {Engine} $
 * @param {import('claude-code').RenderInput<'AbovePrompt'>} e
 * @param {Runtime} rt
 * @returns {Promise<import('claude-code').RenderElement | null>} null: draw nothing of ours
 */
export async function renderBand($, e, rt) {
  if (e.props.hasSurvey) return null
  const [{ value: strip = [] }, { value: notice = null }] = await Promise.all([$.state.get(STRIP), $.state.get(NOTICE)])
  if (strip.length === 0 && !notice) return null
  const { Box, Text, Button } = $.ui.resolve(e)
  const first = strip[0]
  const width = Math.max(20, (e.props.bodyColumns || 80) - 4)
  return (
    <Box flexDirection="column">
      {notice ? <Text color="red">{oneLine(notice, width)}</Text> : null}
      {first ? (
        <Box flexDirection="column">
          <Text>
            link: {strip.length} en franja · de {first.from?.address ?? '?'} (turno {first.turn ?? '?'}/{first.max_turns ?? '?'})
          </Text>
          <Text dimColor>{oneLine(first.body, width)}</Text>
          <Box>
            <Button key="accept" hotkey="1" label="Aceptar" variant="primary" onPress={() => decideFromBand($, rt, first.id, 'accept')} />
            <Text> </Text>
            <Button key="reject" hotkey="2" label="Rechazar" onPress={() => decideFromBand($, rt, first.id, 'reject')} />
          </Box>
        </Box>
      ) : null}
    </Box>
  )
}
