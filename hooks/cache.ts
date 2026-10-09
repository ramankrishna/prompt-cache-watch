// How requests are counted and a cache rebuild is told, with no engine in it:
// every function here is pure, so the tests and the hooks agree.

import type { Rebuild, Step, Totals, TurnRow, Watch } from '../types'

/** A cached prefix smaller than this is too small to call a rebuild over. */
export const MIN_PREFIX = 2048

/** A request that reads less than this share of the last prefix rebuilt it. */
export const KEPT_SHARE = 0.5

/** The shortest time the cache is kept between requests, in milliseconds. Some plans keep it longer. */
export const SHORTEST_LIFETIME = 5 * 60_000

const NONE: Totals = { requests: 0, input: 0, output: 0, read: 0, write: 0 }

export const EMPTY: Watch = {
  last: null,
  hasCompacted: false,
  turnCount: 0,
  current: null,
  turns: [],
  rebuilds: [],
  main: NONE,
  agents: NONE,
}

// --------------------------------------------------------------- counting

/** Every input token a request sent: fresh, read from the cache, and written to it. */
export const sentOf = (totals: Pick<Totals, 'input' | 'read' | 'write'>): number =>
  totals.input + totals.read + totals.write

/** The share of a request's input the cache served, or null when it sent nothing. */
export function hitOf(totals: Pick<Totals, 'input' | 'read' | 'write'>): number | null {
  const sent = sentOf(totals)

  return sent === 0 ? null : totals.read / sent
}

const plus = (totals: Totals, step: Step): Totals => ({
  requests: totals.requests + 1,
  input: totals.input + step.input,
  output: totals.output + step.output,
  read: totals.read + step.read,
  write: totals.write + step.write,
})

/**
 * Tells a rebuild: the last request left a prefix in the cache, and this one
 * read less than half of it back. The cause is the first of these that fits:
 * the model changed, the conversation was compacted, the cache had time to
 * lapse, or else the start of the prompt changed.
 */
export function detect(
  last: Step,
  now: Step,
  startedAt: number,
  hasCompacted: boolean,
  turn: number,
): Rebuild | null {
  const prefix = last.read + last.write

  if (prefix < MIN_PREFIX || now.read >= prefix * KEPT_SHARE) return null

  const idle = startedAt - last.at
  const cause =
    last.model !== now.model
      ? `the model changed from ${last.model} to ${now.model}`
      : hasCompacted
        ? 'the conversation was compacted'
        : idle > SHORTEST_LIFETIME
          ? `${Math.round(idle / 60_000)} minutes passed since the last request, long enough for the cache to lapse`
          : 'something near the start of the prompt changed, such as the system prompt or the list of tools'

  return { at: now.at, turn, lost: prefix - now.read, rewritten: now.write, cause }
}

/** Begins a turn's row; a turn left open by an interrupt is closed first. */
export function startTurn(watch: Watch): Watch {
  const closed = endTurn(watch)
  const n = closed.turnCount + 1

  return { ...closed, turnCount: n, current: { n, ...NONE, rebuilds: 0 } }
}

export function endTurn(watch: Watch): Watch {
  if (watch.current === null) return watch

  return {
    ...watch,
    current: null,
    turns: watch.current.requests === 0 ? watch.turns : [...watch.turns, watch.current].slice(-50),
  }
}

/** Counts one main-loop request, and notes a rebuild when it was one. */
export function addStep(watch: Watch, step: Step, startedAt: number): { watch: Watch; rebuild: Rebuild | null } {
  const open = watch.current === null ? startTurn(watch) : watch
  const row = open.current as TurnRow
  const rebuild = open.last === null ? null : detect(open.last, step, startedAt, open.hasCompacted, row.n)

  return {
    rebuild,
    watch: {
      ...open,
      last: step,
      hasCompacted: false,
      current: { ...row, ...plus(row, step), rebuilds: row.rebuilds + (rebuild === null ? 0 : 1) },
      main: plus(open.main, step),
      rebuilds: rebuild === null ? open.rebuilds : [...open.rebuilds, rebuild].slice(-30),
    },
  }
}

/** Counts a subagent's request. A subagent has a cache of its own, so no rebuild is told. */
export const addAgentStep = (watch: Watch, step: Step): Watch => ({ ...watch, agents: plus(watch.agents, step) })

// ------------------------------------------------------------------ words

/** A token count at a glance: 950, 1.2k, 124k, 1.3M. */
export function tokens(count: number): string {
  if (count < 1000) return String(count)
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`

  return `${(count / 1_000_000).toFixed(1)}M`
}

export const percent = (share: number | null): string => (share === null ? 'n/a' : `${Math.round(share * 100)}%`)

/** A ten-cell bar for a share between 0 and 1. */
export function bar(share: number | null): string {
  const filled = share === null ? 0 : Math.round(share * 10)

  return '▇'.repeat(filled) + '▁'.repeat(10 - filled)
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

export const totalsLine = (totals: Totals): string =>
  `${tokens(sentOf(totals))} in · ${tokens(totals.output)} out · ${plural(totals.requests, 'request')}`

export type Tone = 'success' | 'warning' | null

/** How a cache share reads at a glance: most of it served, or most of it paid for again. */
export const toneOf = (share: number | null): Tone =>
  share === null ? null : share >= 0.7 ? 'success' : share < 0.3 ? 'warning' : null

/** The turn the band speaks for: the one running, or the last one finished. */
export const shownTurn = (watch: Watch): TurnRow | null =>
  watch.current !== null && watch.current.requests > 0 ? watch.current : (watch.turns.at(-1) ?? null)

export const rebuildLine = (rebuild: Rebuild): string =>
  `${tokens(rebuild.rewritten)} written again, because ${rebuild.cause}`
