/** One model request, as the API counted it. */
export type Step = {
  /** When the response ended, in milliseconds. */
  at: number
  model: string
  /** Input tokens neither read from nor written to the cache. */
  input: number
  output: number
  /** Input tokens the cache served. */
  read: number
  /** Input tokens written to the cache. */
  write: number
}

export type Totals = { requests: number; input: number; output: number; read: number; write: number }

/** One turn's requests, summed. */
export type TurnRow = Totals & {
  /** The turn's number in the session, from 1. */
  n: number
  rebuilds: number
}

/** One time the cached prefix was paid for again. */
export type Rebuild = {
  at: number
  turn: number
  /** Cached tokens the request did not get back. */
  lost: number
  /** Tokens the request wrote to the cache in their place. */
  rewritten: number
  /** The likeliest reason, in words. */
  cause: string
}

export type Watch = {
  /** The main conversation's last request, or null before the first. */
  last: Step | null
  /** True from a compaction until the next request. */
  hasCompacted: boolean
  turnCount: number
  current: TurnRow | null
  turns: TurnRow[]
  rebuilds: Rebuild[]
  main: Totals
  agents: Totals
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-cache-watch': { watch: Watch }
  }
}
