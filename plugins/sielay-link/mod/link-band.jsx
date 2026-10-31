// The strip band above the prompt: "link: N en franja", the oldest message's
// short id, sender and first line, and [Ver] [Aceptar <id>] [Rechazar].
//
// Deliberately no hotkeys: a bare digit typed in an empty prompt presses a
// band Button, so a "1" meant as an answer could accept a peer's message.
// The buttons are pressed only with the band focused (ctrl+x tab, then the
// arrows and Enter) or with a click; `/link accept <id>` is the typed way.
// Each button carries the id drawn beside it, and the strip keeps arrival
// order, so the message accepted is the one on screen. Yields to a survey.
// With a build declared it adds one line: "build: etapa N/7 · nombre".

import { sanitizeText, neutralizeBody } from './link-inbound-framing.js'
import { decisionContext } from './link-runtime.js'
import { shortId } from './link-strip-selection.js'
import { PANE_ID } from './link-state-refs.js'
import { BUILD_ENCARGO_STAGES, BUILD_STAGES } from './link-build-validate.js'

// $.state references: literal plugin/key, declared in each file that uses them.
const STRIP = /** @type {const} */ ({ plugin: 'sielay-link', key: 'strip' })
const NOTICE = /** @type {const} */ ({ plugin: 'sielay-link', key: 'notice' })
const SELECTED = /** @type {const} */ ({ plugin: 'sielay-link', key: 'selected' })
const BUILD = /** @type {const} */ ({ plugin: 'sielay-link', key: 'build' })

/** @typedef {import('claude-code').EngineInterface} Engine */
/** @typedef {import('./link-runtime.js').Runtime} Runtime */

/**
 * Accepts or rejects exactly `id`. Called from a person's press or command.
 * @param {Engine} $ @param {Runtime} rt @param {string} id @param {'accept'|'reject'} action
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function decideStripItem($, rt, id, action) {
  /** @type {{ ok: boolean, error?: string }} */
  let r
  try {
    if (!rt.handler) throw new Error('sielay-link no arrancó')
    const ctx = await decisionContext($, rt, id)
    r = action === 'accept' ? await rt.handler.accept(id, ctx) : await rt.handler.reject(id, ctx)
  } catch (err) {
    r = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  await $.state.set(NOTICE, r.ok ? null : `sielay-link: ${r.error}`)
  if (r.ok) await $.state.set(SELECTED, null)
  return r
}

/**
 * Opens the full message in the pane, focused.
 * @param {Engine} $ @param {string} id
 */
export async function showStripItem($, id) {
  await $.state.set(SELECTED, id)
  await $.ui.open({ id: PANE_ID, title: 'sielay-link', focus: true })
}

/**
 * A peer's body on one line, neutralized exactly as the model will read it
 * (a spoofed header never looks real in the band either).
 * @param {unknown} body @param {number} max
 */
export function bodyPreview(body, max) {
  return oneLine(neutralizeBody(body), max)
}

/** @param {unknown} text @param {number} max */
export function oneLine(text, max) {
  const flat = sanitizeText(text).replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * The build line, or null without a build (or once it went out as done): "build: etapa 4/7 · implementar",
 * plus the status when it is not running.
 * @param {import('../types/index.js').LinkBuildState | null} build
 */
export function buildLine(build) {
  if (build?.closed) return null
  const stage = build?.declared.stage
  if (typeof stage !== 'number' || !Number.isInteger(stage) || stage < 1 || stage > BUILD_STAGES.length) return null
  const status = build?.declared.status
  const extra = typeof status === 'string' && status !== 'running' ? ` · ${status}` : ''
  const names = build?.declared.flow === 'encargo' ? BUILD_ENCARGO_STAGES : BUILD_STAGES
  return `build: etapa ${stage}/${names.length} · ${names[stage - 1] ?? BUILD_STAGES[stage - 1]}${extra}`
}

/**
 * @param {Engine} $
 * @param {import('claude-code').RenderInput<'AbovePrompt'>} e
 * @param {Runtime} rt
 * @returns {Promise<import('claude-code').RenderElement | null>} null: draw nothing of ours
 */
export async function renderBand($, e, rt) {
  if (e.props.hasSurvey) return null
  const [{ value: strip = [] }, { value: notice = null }, { value: build = null }] = await Promise.all([
    $.state.get(STRIP),
    $.state.get(NOTICE),
    $.state.get(BUILD),
  ])
  const progress = buildLine(build)
  if (strip.length === 0 && !notice && !progress) return null
  const { Box, Text, Button } = $.ui.resolve(e)
  const first = strip[0]
  const width = Math.max(20, (e.props.bodyColumns || 80) - 4)
  const sid = first ? shortId(first.id) : ''
  return (
    <Box flexDirection="column">
      {notice ? <Text color="red">{oneLine(notice, width)}</Text> : null}
      {progress ? <Text dimColor>{oneLine(progress, width)}</Text> : null}
      {first ? (
        <Box flexDirection="column">
          <Text>
            link: {strip.length} en franja · {sid} de {oneLine(first.from?.address ?? '?', 60)} (turno {first.turn ?? '?'}/{first.max_turns ?? '?'})
          </Text>
          <Text dimColor>{bodyPreview(first.body, width)}</Text>
          <Box>
            <Button key={`show-${first.id}`} label="Ver completo" onPress={() => showStripItem($, first.id)} />
            <Text> </Text>
            <Button key={`accept-${first.id}`} label={`Aceptar ${sid}`} variant="primary" onPress={() => decideStripItem($, rt, first.id, 'accept')} />
            <Text> </Text>
            <Button key={`reject-${first.id}`} label="Rechazar" onPress={() => decideStripItem($, rt, first.id, 'reject')} />
          </Box>
          <Text dimColor>ctrl+x tab para enfocar · o /link accept {sid}</Text>
        </Box>
      ) : null}
    </Box>
  )
}
