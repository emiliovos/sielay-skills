// Typed `$.state` references (see types/index.d.ts). Session-scoped, held by
// the host; they survive a hot reload, never a restart.

export const STRIP = /** @type {const} */ ({ plugin: 'sielay-link', key: 'strip' })
export const MODE_SAMPLES = /** @type {const} */ ({ plugin: 'sielay-link', key: 'modeSamples' })
export const LAST_STOP_AT = /** @type {const} */ ({ plugin: 'sielay-link', key: 'lastStopAt' })
export const SESSION_TITLE = /** @type {const} */ ({ plugin: 'sielay-link', key: 'sessionTitle' })
export const OFF = /** @type {const} */ ({ plugin: 'sielay-link', key: 'off' })
export const STATUS = /** @type {const} */ ({ plugin: 'sielay-link', key: 'status' })
export const PAIRING = /** @type {const} */ ({ plugin: 'sielay-link', key: 'pairing' })
export const CONVERSATIONS = /** @type {const} */ ({ plugin: 'sielay-link', key: 'conversations' })
export const NOTICE = /** @type {const} */ ({ plugin: 'sielay-link', key: 'notice' })

/** The pane's id. */
export const PANE_ID = 'sielay-link'
