// sielay-link's session state, as `$.state` holds it (per session, survives a
// hot reload, never written to disk). The link token is never stored here
// beyond the pairing view that shows it once.

export type LinkDelivery = {
  id: string
  conversation_id: string
  seq?: number
  turn?: number
  max_turns?: number
  from?: { address?: string; mode?: string; project?: string }
  body: string
  run?: number
  gate?: string
  sent_at?: string
  /** The conversation's state as the hub reports it; absent from an older hub (the thread then counts as open). */
  conversation?: {
    status: 'open' | 'capped' | 'closed' | 'archived'
    closed_reason: 'end' | 'idle' | 'admin' | null
    closed_by: string | null
  }
}

/** How a thread ended; `by` is an address, null when the hub does not say. */
export type LinkThreadClosure = { by: string | null; reason: 'end' | 'idle' | 'admin' | 'cap'; at: number }

/** One conversation of this session, numbered ①…⑳ while it is open (mod/link-threads.js). */
export type LinkThread = {
  n: number
  peer: string
  project?: string
  turns: number
  last_at: number
  closed: LinkThreadClosure | null
  /** Another thread was open beside this one at some event: its rows keep the number. */
  crossed?: true
}

/** What was fixed when one event happened: read by the rows, never recomputed. */
export type LinkThreadMark = {
  conv: string
  n: number
  crossed: boolean
  hhmm: string
  first: boolean
  peer: string
  project?: string
  out?: true
  /** A message of ours that waits in the other side's strip, or is held by an admin. */
  state?: 'strip' | 'held'
  /** The hub refused the send: the conversation was already closed. */
  refused?: true
  closed?: LinkThreadClosure & { hhmm: string; turns: number }
}

/** `marks` is keyed by `<conv>#<turn>` for a received message and by the tool_use_id for one we sent. */
export type LinkThreadRegistry = { threads: Record<string, LinkThread>; marks: Record<string, LinkThreadMark> }

export type LinkModeSample = { mode: string; at: number; event: string }

export type LinkLoopStatus = 'starting' | 'online' | 'off' | 'unpaired' | 'paused' | 'unauthorized' | 'backoff' | 'error'

export type LinkStatus = {
  loop: LinkLoopStatus
  detail?: string
  address?: string
  name?: string
  nameSource?: string
  adapter?: 'socket' | 'prompt'
  hub?: string
  tokenSource?: 'config' | 'file' | 'pairing' | 'none'
}

export type LinkPairingView =
  | { phase: 'waiting'; slot: string; user_code: string; verification_uri?: string; expires_at: number }
  | { phase: 'done'; slot: string; token?: string; address_prefix?: string; saved: 'saving' | 'file' | 'failed'; note: string }
  | { phase: 'error'; slot: string; message: string }

export type LinkBuildSubagent = { id: string; type?: string; description?: string; started_at: string; seen: number }

export type LinkBuildUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  turns: number
  model?: string
  /** Σ turn.complete.durationMs of the session's turns (main loop and subagents) while the build is active. */
  active_ms?: number
}

/** The build this session reports (mod/link-build-state.js); null when none. */
export type LinkBuildState = {
  declared: Record<string, unknown>
  started_at: string
  subagents: Record<string, LinkBuildSubagent>
  peak: number
  usage: LinkBuildUsage | null
  /** Other builds of this session still open, build_id -> ms of their last report (24 h expiry). */
  open?: Record<string, number>
  /** ms of the last link_build_stage call that touched the current build. */
  touched_at?: number
  /** The current build went out as done; the state only holds `open` until they end. */
  closed?: true
  /** The current build has declarations no poll has carried yet. */
  unsent?: true
  /** Builds displaced before a poll carried their last declaration, oldest first; one goes out per poll. */
  pending?: Array<{ declared: Record<string, unknown>, started_at: string, at: number }>
}

declare module 'claude-code' {
  interface PluginState {
    'sielay-link': {
      strip: LinkDelivery[]
      modeSamples: LinkModeSample[]
      lastStopAt: number | null
      sessionTitle: string | null
      off: boolean
      status: LinkStatus
      pairing: LinkPairingView | null
      conversations: Record<string, string>
      threads: LinkThreadRegistry
      notice: string | null
      selected: string | null
      build: LinkBuildState | null
    }
  }
}
