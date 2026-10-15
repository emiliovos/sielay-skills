// sielay-link's session state, as `$.state` holds it (per session, survives a
// hot reload, never written to disk). The link token is never stored here
// beyond the pairing view that shows it once.

export type LinkDelivery = {
  id: string
  conversation_id: string
  seq?: number
  turn?: number
  max_turns?: number
  from?: { address?: string; mode?: string }
  body: string
  run?: number
  gate?: string
  sent_at?: string
}

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
  | { phase: 'done'; slot: string; token: string; address_prefix?: string; saved: 'saving' | 'file' | 'failed'; note: string }
  | { phase: 'error'; slot: string; message: string }

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
      notice: string | null
    }
  }
}
