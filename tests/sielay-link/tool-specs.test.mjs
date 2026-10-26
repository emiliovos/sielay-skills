import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LINK_TOOL_SPECS, MINIMAL_LEFT_OUT, toolSpecsFor } from '../../plugins/sielay-link/mod/link-tool-specs.js'

const names = specs => specs.map(s => s.name)

test('without minimal mode every tool is registered', () => {
  assert.deepEqual(names(toolSpecsFor({ minimal: false })), ['link_send', 'link_reply', 'link_peers', 'link_read', 'link_build_stage', 'link_watch'])
  assert.equal(toolSpecsFor({ minimal: false }), LINK_TOOL_SPECS)
})

test('minimal mode keeps only the message tools: send, reply, peers and read', () => {
  assert.deepEqual(names(toolSpecsFor({ minimal: true })), ['link_send', 'link_reply', 'link_peers', 'link_read'])
  assert.deepEqual([...MINIMAL_LEFT_OUT], ['link_build_stage', 'link_watch'])
})

test('minimal mode leaves out most of the schemas the model carries on every request', () => {
  const size = specs => JSON.stringify(specs).length
  assert.ok(size(toolSpecsFor({ minimal: true })) * 3 < size(LINK_TOOL_SPECS))
})
