import type { On, SessionMessage } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { Step, Watch } from '../types'
import {
  addAgentStep,
  addStep,
  bar,
  detect,
  EMPTY,
  endTurn,
  hitOf,
  MIN_PREFIX,
  percent,
  rebuildLine,
  sentOf,
  shownTurn,
  SHORTEST_LIFETIME,
  startTurn,
  tokens,
  toneOf,
  totalsLine,
} from '../hooks/cache'

const OPUS = 'claude-opus'
const SONNET = 'claude-sonnet'

const step = (read: number, write: number, more: Partial<Step> = {}): Step => ({
  at: 1000,
  model: OPUS,
  input: 10,
  output: 100,
  read,
  write,
  ...more,
})

describe('telling a rebuild', () => {
  const last = step(40_000, 2_000)

  test('a request that reads the prefix back is not a rebuild', () => {
    expect(detect(last, step(42_000, 500), 1000, false, 1)).toBe(null)
  })

  test('a request that reads almost none of it back is, and says what was lost', () => {
    expect(detect(last, step(0, 43_000, { at: 2000 }), 1500, false, 3)).toEqual({
      at: 2000,
      turn: 3,
      lost: 42_000,
      rewritten: 43_000,
      cause: 'something near the start of the prompt changed, such as the system prompt or the list of tools',
    })
  })

  test('half the prefix kept is the line: at it nothing is told, under it a rebuild is', () => {
    expect(detect(last, step(21_000, 21_000), 1000, false, 1)).toBe(null)
    expect(detect(last, step(20_999, 21_001), 1000, false, 1)?.lost).toBe(21_001)
  })

  test('a prefix too small to matter is never called a rebuild', () => {
    expect(detect(step(MIN_PREFIX - 1, 0), step(0, 3000), 1000, false, 1)).toBe(null)
    expect(detect(step(0, MIN_PREFIX), step(0, 3000), 1000, false, 1)).not.toBe(null)
  })

  test('the cause is the first that fits: model, then compaction, then time', () => {
    const late = last.at + SHORTEST_LIFETIME + 4 * 60_000

    expect(detect(last, step(0, 43_000, { model: SONNET }), late, true, 1)?.cause).toBe(
      'the model changed from claude-opus to claude-sonnet',
    )
    expect(detect(last, step(0, 43_000), late, true, 1)?.cause).toBe('the conversation was compacted')
    expect(detect(last, step(0, 43_000), late, false, 1)?.cause).toBe(
      '9 minutes passed since the last request, long enough for the cache to lapse',
    )
  })

  test('five minutes exactly is not yet blamed on time', () => {
    expect(detect(last, step(0, 43_000), last.at + SHORTEST_LIFETIME, false, 1)?.cause).toMatch(/start of the prompt/)
    expect(detect(last, step(0, 43_000), last.at + SHORTEST_LIFETIME + 1, false, 1)?.cause).toMatch(/5 minutes passed/)
  })
})

describe('counting', () => {
  test('a turn sums its requests, and the session sums its turns', () => {
    let watch = startTurn(EMPTY)

    watch = addStep(watch, step(0, 30_000), 0).watch
    watch = addStep(watch, step(30_000, 1_000), 0).watch
    watch = endTurn(watch)
    watch = startTurn(watch)
    watch = addStep(watch, step(31_000, 500), 0).watch

    expect(watch.turns).toEqual([{ n: 1, requests: 2, input: 20, output: 200, read: 30_000, write: 31_000, rebuilds: 0 }])
    expect(watch.current).toEqual({ n: 2, requests: 1, input: 10, output: 100, read: 31_000, write: 500, rebuilds: 0 })
    expect(watch.main).toEqual({ requests: 3, input: 30, output: 300, read: 61_000, write: 31_500 })
  })

  test('the first request of a session is never a rebuild', () => {
    expect(addStep(startTurn(EMPTY), step(0, 50_000), 0).rebuild).toBe(null)
  })

  test('a rebuild is counted on its turn and kept in the list', () => {
    let watch = addStep(startTurn(EMPTY), step(0, 30_000), 0).watch
    const { watch: after, rebuild } = addStep(watch, step(0, 30_500), 0)

    watch = after
    expect(rebuild?.turn).toBe(1)
    expect(watch.current?.rebuilds).toBe(1)
    expect(watch.rebuilds).toEqual([rebuild])
  })

  test('a compaction is blamed once, for the next request only', () => {
    let watch: Watch = { ...addStep(startTurn(EMPTY), step(0, 30_000), 0).watch, hasCompacted: true }
    const first = addStep(watch, step(0, 9_000), 0)

    watch = first.watch
    expect(first.rebuild?.cause).toBe('the conversation was compacted')
    expect(watch.hasCompacted).toBe(false)
    expect(addStep(watch, step(0, 9_000), 0).rebuild?.cause).toMatch(/start of the prompt/)
  })

  test('a turn with no request leaves no row; an interrupted turn is closed by the next', () => {
    expect(endTurn(startTurn(EMPTY)).turns).toEqual([])

    const open = addStep(startTurn(EMPTY), step(0, 30_000), 0).watch
    const next = startTurn(open)

    expect(next.turns.map(row => row.n)).toEqual([1])
    expect(next.current?.n).toBe(2)
  })

  test('a request outside any turn opens one, so it is not lost', () => {
    const { watch } = addStep(EMPTY, step(0, 30_000), 0)

    expect(watch.current?.requests).toBe(1)
    expect(watch.turnCount).toBe(1)
  })

  test('only the last fifty turns are kept', () => {
    let watch = EMPTY

    for (let n = 0; n < 60; n += 1) watch = endTurn(addStep(startTurn(watch), step(1000, 0), 0).watch)

    expect(watch.turns).toHaveLength(50)
    expect(watch.turns[0]?.n).toBe(11)
    expect(watch.main.requests).toBe(60)
  })

  test('a subagent request is counted apart and leaves the main conversation as it was', () => {
    const before = addStep(startTurn(EMPTY), step(0, 30_000), 0).watch
    const after = addAgentStep(before, step(0, 8_000, { model: SONNET }))

    expect(after.agents).toEqual({ requests: 1, input: 10, output: 100, read: 0, write: 8_000 })
    expect(after.main).toEqual(before.main)
    expect(after.last).toEqual(before.last)
    expect(after.current).toEqual(before.current)
  })
})

describe('words', () => {
  test('a share is what was read over everything sent', () => {
    expect(sentOf({ input: 100, read: 700, write: 200 })).toBe(1000)
    expect(hitOf({ input: 100, read: 700, write: 200 })).toBe(0.7)
    expect(hitOf({ input: 0, read: 0, write: 0 })).toBe(null)
    expect(percent(0.7)).toBe('70%')
    expect(percent(0.996)).toBe('100%')
    expect(percent(null)).toBe('n/a')
  })

  test('token counts read at a glance', () => {
    expect(tokens(0)).toBe('0')
    expect(tokens(950)).toBe('950')
    expect(tokens(1_234)).toBe('1.2k')
    expect(tokens(9_999)).toBe('10.0k')
    expect(tokens(124_400)).toBe('124k')
    expect(tokens(1_300_000)).toBe('1.3M')
  })

  test('the bar has ten cells whatever the share', () => {
    expect(bar(0)).toBe('▁▁▁▁▁▁▁▁▁▁')
    expect(bar(0.72)).toBe('▇▇▇▇▇▇▇▁▁▁')
    expect(bar(1)).toBe('▇▇▇▇▇▇▇▇▇▇')
    expect(bar(null)).toBe('▁▁▁▁▁▁▁▁▁▁')
  })

  test('the tone is green from 70%, a warning under 30%, plain between and when nothing was sent', () => {
    expect(toneOf(0.7)).toBe('success')
    expect(toneOf(0.69)).toBe(null)
    expect(toneOf(0.3)).toBe(null)
    expect(toneOf(0.29)).toBe('warning')
    expect(toneOf(null)).toBe(null)
  })

  test('the lines', () => {
    expect(totalsLine({ requests: 1, input: 10, output: 100, read: 30_000, write: 1_000 })).toBe('31k in · 100 out · 1 request')
    expect(totalsLine({ requests: 3, input: 0, output: 2_500, read: 0, write: 0 })).toBe('0 in · 2.5k out · 3 requests')
    expect(rebuildLine({ at: 1, turn: 2, lost: 40_000, rewritten: 41_000, cause: 'the conversation was compacted' })).toBe(
      '41k written again, because the conversation was compacted',
    )
  })

  test('the band speaks for the running turn once it has a request, else the last finished', () => {
    const one = endTurn(addStep(startTurn(EMPTY), step(0, 30_000), 0).watch)

    expect(shownTurn(EMPTY)).toBe(null)
    expect(shownTurn(one)?.n).toBe(1)
    expect(shownTurn(startTurn(one))?.n).toBe(1)
    expect(shownTurn(addStep(startTurn(one), step(30_000, 0), 0).watch)?.n).toBe(2)
  })
})

// --------------------------------------------------------- through the engine

type Usage = { model: string; input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

type World = { toasts: string[]; opened: string[]; usage: Usage | null; skip: string | null; clock: ReturnType<typeof mock.clock> }

const usage = (read: number, write: number, model = OPUS): Usage => ({
  model,
  input_tokens: 10,
  output_tokens: 100,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
})

function world(on: On): World {
  const state: World = { toasts: [], opened: [], usage: null, skip: null, clock: mock.clock(on, { now: 1000 }) }

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    state.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    state.opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: state.usage }
  })
  on('session.compact', ($, e) => (state.skip === null ? { messages: e.messages } : { skip: state.skip }))

  return state
}

const TALK: SessionMessage[] = [{ role: 'user', text: 'hi', toolUses: [] }]
const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const
const DONE = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const
const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} }
const PANE = { title: 'Cache Watch', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

describe('the session', () => {
  // One request to the model, read to its end as the engine reads it.
  async function request($: Engine, state: World, next: Usage | null, agentId?: string) {
    state.usage = next

    const stream = $.turn.step({ turnId: 't', index: 0, model: next?.model ?? OPUS, messageCount: 1, ...(agentId === undefined ? {} : { agentId }) })
    let piece = await stream.next()

    while (piece.done !== true) piece = await stream.next()

    return piece.value
  }

  test('a steady conversation raises nothing, and the band shows the share read', async ($, on) => {
    const state = world(on)

    await $.session.start(START)
    await $.turn.start({ text: 'hi', turnId: 't' })
    await request($, state, usage(0, 30_000))
    await request($, state, usage(30_000, 1_000))
    await request($, state, usage(31_000, 500))
    await $.turn.complete(DONE)

    expect(state.toasts).toEqual([])

    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await $.ui.mount({ plugin: 'prompt-cache-watch', surface, component: 'AbovePrompt', props: BAND })

      expect(await band.find({ type: 'Text', text: '66% read from cache' })).toBeDefined()
      expect(await band.find({ type: 'Text', text: '93k in · 300 out · 3 requests' })).toBeDefined()
      expect(await band.find({ type: 'Text', text: /rebuilt/ })).toBeUndefined()
      await band.unmount()
    }
  })

  test('the result of a request passes through untouched', async ($, on) => {
    const state = world(on)

    await $.session.start(START)

    expect(await request($, state, usage(0, 30_000))).toEqual({
      turnId: 't',
      index: 0,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: usage(0, 30_000),
    })
  })

  test('a prefix written again raises one notice with the likely cause', async ($, on) => {
    const state = world(on)

    await $.session.start(START)
    await $.turn.start({ text: 'hi', turnId: 't' })
    await request($, state, usage(0, 30_000))
    await request($, state, usage(0, 30_800))

    expect(state.toasts).toEqual([
      'Cache rebuilt: 31k written again, because something near the start of the prompt changed, such as the system prompt or the list of tools.',
    ])

    const band = await $.ui.mount({ plugin: 'prompt-cache-watch', surface: 'terminal', component: 'AbovePrompt', props: BAND })

    expect(await band.find({ type: 'Text', text: 'rebuilt once this turn' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: '0% read from cache' })).toBeDefined()
    await band.unmount()
  })

  test('a long wait is named as the cause', async ($, on) => {
    const state = world(on)

    await $.session.start(START)
    await $.turn.start({ text: 'hi', turnId: 't' })
    await request($, state, usage(0, 30_000))
    await $.turn.complete(DONE)
    await state.clock.advance(12 * 60_000)
    await $.turn.start({ text: 'back', turnId: 't' })
    await request($, state, usage(0, 30_400))

    expect(state.toasts).toEqual([
      'Cache rebuilt: 30k written again, because 12 minutes passed since the last request, long enough for the cache to lapse.',
    ])
  })

  test('a long wait with the cache still warm raises nothing', async ($, on) => {
    const state = world(on)

    await $.session.start(START)
    await request($, state, usage(0, 30_000))
    await state.clock.advance(40 * 60_000)
    await request($, state, usage(30_000, 400))

    expect(state.toasts).toEqual([])
  })

  test('a compaction is the cause of the rebuild that follows it', async ($, on) => {
    const state = world(on)

    await $.session.start(START)
    await request($, state, usage(0, 90_000))
    await $.session.compact({ trigger: 'auto', messages: TALK })
    await request($, state, usage(9_000, 6_000))

    expect(state.toasts).toEqual(['Cache rebuilt: 6.0k written again, because the conversation was compacted.'])
  })

  test('a compaction that was skipped, precomputed or a subagent\'s is not blamed', async ($, on) => {
    const state = world(on)

    await $.session.start(START)
    await request($, state, usage(0, 90_000))
    state.skip = 'not now'
    await $.session.compact({ trigger: 'manual', messages: TALK })
    state.skip = null
    await $.session.compact({ trigger: 'precompute', messages: TALK })
    await $.session.compact({ trigger: 'auto', messages: TALK, agentId: 'a1' })
    await request($, state, usage(0, 90_500))

    expect(state.toasts).toHaveLength(1)
    expect(state.toasts[0]).toMatch(/start of the prompt/)
  })

  test('a change of model is the cause', async ($, on) => {
    const state = world(on)

    await $.session.start(START)
    await request($, state, usage(0, 30_000))
    await request($, state, usage(0, 30_200, SONNET))

    expect(state.toasts).toEqual(['Cache rebuilt: 30k written again, because the model changed from claude-opus to claude-sonnet.'])
  })

  test('a request that brought no usage counts nothing', async ($, on) => {
    const state = world(on)

    await $.session.start(START)
    await request($, state, usage(0, 30_000))
    await request($, state, null)
    await request($, state, usage(30_000, 100))

    expect(state.toasts).toEqual([])

    const pane = await $.ui.mount({ plugin: 'prompt-cache-watch', surface: 'terminal', component: 'Pane', requestId: 'cache', props: PANE })

    expect(await pane.find({ type: 'Text', text: /2 requests/ })).toBeDefined()
    await pane.unmount()
  })

  test('a subagent\'s requests never raise a rebuild and are shown apart', async ($, on) => {
    const state = world(on)

    await $.session.start(START)
    await $.turn.start({ text: 'hi', turnId: 't' })
    await request($, state, usage(0, 30_000))
    await request($, state, usage(0, 8_000, SONNET), 'a1')
    await request($, state, usage(8_000, 2_000, SONNET), 'a1')
    await $.turn.complete({ ...DONE, agentId: 'a1' })
    await request($, state, usage(30_000, 900))
    await $.turn.complete(DONE)

    expect(state.toasts).toEqual([])

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ plugin: 'prompt-cache-watch', surface, component: 'Pane', requestId: 'cache', props: PANE })

      expect(await pane.find({ type: 'Text', text: 'This session: 49% of 61k input tokens read from cache' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: 'Subagents, counted apart: 44% of 18k read from cache · 2 requests' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: '61k in · 200 out · 2 requests' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: 'No rebuilds this session.' })).toBeDefined()
      await pane.unmount()
    }
  })

  test('the pane lists each rebuild with its turn', async ($, on) => {
    const state = world(on)

    await $.session.start(START)
    await $.turn.start({ text: 'one', turnId: 't' })
    await request($, state, usage(0, 30_000))
    await $.turn.complete(DONE)
    await $.turn.start({ text: 'two', turnId: 't' })
    await request($, state, usage(0, 30_500))
    await $.turn.complete(DONE)

    const pane = await $.ui.mount({ plugin: 'prompt-cache-watch', surface: 'terminal', component: 'Pane', requestId: 'cache', props: PANE })

    expect(await pane.find({ type: 'Text', text: '1 rebuild this session' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^Turn #2: 31k written again, because something near the start/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '▁▁▁▁▁▁▁▁▁▁' })).toBeDefined()
    await pane.unmount()
  })

  test('before the first request the band stays out of the way and the pane says so', async ($, on) => {
    world(on)
    await $.session.start(START)

    const band = await $.ui.mount({ plugin: 'prompt-cache-watch', surface: 'terminal', component: 'AbovePrompt', props: BAND })

    expect(await band.find({ type: 'Text', text: /read from cache/ })).toBeUndefined()
    await band.unmount()

    const pane = await $.ui.mount({ plugin: 'prompt-cache-watch', surface: 'terminal', component: 'Pane', requestId: 'cache', props: PANE })

    expect(await pane.find({ type: 'Text', text: 'No requests yet this session.' })).toBeDefined()
    await pane.unmount()
  })

  test('/cache and the band\'s button open the pane', async ($, on) => {
    const state = world(on)

    await $.session.start(START)
    await $.command.run({ command: 'cache', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
    await request($, state, usage(0, 30_000))

    const band = await $.ui.mount({ plugin: 'prompt-cache-watch', surface: 'terminal', component: 'AbovePrompt', props: BAND })

    await band.press({ key: 'open' })
    await band.unmount()

    expect(state.opened).toEqual(['cache', 'cache'])
  })
})
