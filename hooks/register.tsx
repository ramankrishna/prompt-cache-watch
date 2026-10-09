// Cache Watch: how much of each request the prompt cache served, and a notice
// the moment the cache is paid for again.
//
// It only reads the token counts the API reports for each request. It changes
// nothing about the request, asks no model anything, and leaves the machine alone.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Step } from '../types'
import {
  addAgentStep,
  addStep,
  bar,
  EMPTY,
  endTurn,
  hitOf,
  percent,
  rebuildLine,
  sentOf,
  shownTurn,
  startTurn,
  tokens,
  toneOf,
  totalsLine,
} from './cache'

const PANE = 'cache'

const watch = atom({ plugin: 'prompt-cache-watch', key: 'watch' } as const, EMPTY)

const openPane = ($: EngineInterface) =>
  $.ui.open({ id: PANE, title: 'Cache Watch', focus: true, closeOnEscape: true })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cache',
      description: 'Show how much of each request the prompt cache served, and when it was rebuilt',
    })

    return next(e)
  })

  on('command.run', { command: 'cache' }, async $ => {
    await openPane($)

    return {}
  })

  on('turn.start', async ($, e, next) => {
    await update($, watch, was => startTurn(was))

    return next(e)
  })

  // One request to the model: forward it untouched, then count what it cost.
  on('turn.step', async function* ($, e, next) {
    const startedAt = await $.clock.now()
    const result = yield* next(e)

    if (result.usage === null) return result

    const step: Step = {
      at: await $.clock.now(),
      model: result.usage.model,
      input: result.usage.input_tokens,
      output: result.usage.output_tokens,
      read: result.usage.cache_read_input_tokens,
      write: result.usage.cache_creation_input_tokens,
    }

    if (e.agentId !== undefined) {
      await update($, watch, was => addAgentStep(was, step))

      return result
    }

    const { rebuild } = addStep(await read($, watch), step, startedAt)

    await update($, watch, was => addStep(was, step, startedAt).watch)

    if (rebuild !== null) $.ui.toast(`Cache rebuilt: ${rebuildLine(rebuild)}.`, { timeoutMs: 8000 })

    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await update($, watch, was => endTurn(was))

    return next(e)
  })

  // A compaction rewrites the conversation, so the next request starts a new prefix.
  on('session.compact', async ($, e, next) => {
    const out = await next(e)

    if (e.agentId === undefined && e.trigger !== 'precompute' && out.skip === undefined) {
      await update($, watch, was => ({ ...was, hasCompacted: true }))
    }

    return out
  })

  // -------------------------------------------------------------- drawing

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = await read($, watch)
    const row = shownTurn(now)

    if (e.props.hasSurvey || row === null) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const theirs = await next(e)
    const share = hitOf(row)
    const tone = toneOf(share)
    const head = `${percent(share)} read from cache`

    return (
      <Box flexDirection="column">
        {theirs}
        <Box flexDirection="row" columnGap={2}>
          <Text inverse> cache </Text>
          {tone === null ? <Text>{head}</Text> : <Text color={tone}>{head}</Text>}
          <Text dimColor>{totalsLine(row)}</Text>
          {row.rebuilds > 0 && (
            <Text color="warning">
              rebuilt {row.rebuilds === 1 ? 'once' : `${row.rebuilds} times`} this turn
            </Text>
          )}
          <Button key="open" label="details" hotkey="c" plain onPress={() => openPane($)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const now = await read($, watch)
    const rows = [...now.turns, ...(now.current !== null && now.current.requests > 0 ? [now.current] : [])]
    const share = hitOf(now.main)

    return (
      <Box flexDirection="column" rowGap={1}>
        {now.main.requests === 0 ? (
          <Box flexDirection="column">
            <Text>No requests yet this session.</Text>
            <Text dimColor>Numbers appear after Claude's first reply.</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text>
              This session: {percent(share)} of {tokens(sentOf(now.main))} input tokens read from cache
            </Text>
            <Text dimColor>
              {tokens(now.main.read)} read {'·'} {tokens(now.main.write)} written {'·'} {tokens(now.main.input)}{' '}
              uncached {'·'} {tokens(now.main.output)} out {'·'} {now.main.requests} requests
            </Text>
            {now.agents.requests > 0 && (
              <Text dimColor>
                Subagents, counted apart: {percent(hitOf(now.agents))} of {tokens(sentOf(now.agents))} read from cache{' '}
                {'·'} {now.agents.requests} requests
              </Text>
            )}
          </Box>
        )}
        {rows.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>Turn by turn, newest first. The bar is the share read from cache.</Text>
            {rows
              .slice(-10)
              .reverse()
              .map(row => (
                <Box flexDirection="row" columnGap={2}>
                  <Box width={4} flexShrink={0}>
                    <Text dimColor>#{row.n}</Text>
                  </Box>
                  <Text color={toneOf(hitOf(row)) ?? 'text'}>{bar(hitOf(row))}</Text>
                  <Box width={4} flexShrink={0}>
                    <Text>{percent(hitOf(row))}</Text>
                  </Box>
                  <Text dimColor>{totalsLine(row)}</Text>
                  {row.rebuilds > 0 && <Text color="warning">rebuilt</Text>}
                </Box>
              ))}
          </Box>
        )}
        <Box flexDirection="column">
          {now.rebuilds.length === 0 ? (
            <Text dimColor>No rebuilds this session.</Text>
          ) : (
            <Text color="warning">
              {now.rebuilds.length} {now.rebuilds.length === 1 ? 'rebuild' : 'rebuilds'} this session
            </Text>
          )}
          {now.rebuilds
            .slice(-6)
            .reverse()
            .map(rebuild => (
              <Text dimColor>
                Turn #{rebuild.turn}: {rebuildLine(rebuild)}
              </Text>
            ))}
        </Box>
      </Box>
    )
  })
}
