# Cache Watch

A mod for Claude Code that shows how much of each request the prompt cache served, and tells you the moment the cache is paid for again, with the likely reason.

## Why

Claude Code sends the whole conversation with every request. The prompt cache is what keeps that cheap and fast: text the API has seen recently is read from the cache instead of being processed again. When the cache is lost, the next request pays for the whole conversation at once. That usually happens silently. Cache Watch makes it visible.

## What you see

**A line above the prompt** after each turn:

```
 cache  94% read from cache   182k in · 2.1k out · 6 requests   details
```

The percentage is the share of the turn's input tokens that came from the cache. It is green from 70% and a warning colour under 30%.

**A notice when the cache is rebuilt:**

```
Cache rebuilt: 61k written again, because 12 minutes passed since the last request, long enough for the cache to lapse.
```

**`/cache`** opens a pane with the session's totals, a bar for each of the last ten turns, the subagents' numbers counted apart, and every rebuild with its turn and cause.

## How a rebuild is told

Each request reports four counts: input tokens read from the cache, written to it, sent uncached, and output tokens. The mod compares each request of the main conversation with the one before:

- The previous request left a cached prefix of at least 2,048 tokens (what it read plus what it wrote).
- This request read back less than half of it.

When both hold, it is a rebuild. The cause is the first of these that fits:

| Order | Cause | How it is known |
| :- | :- | :- |
| 1 | The model changed | The two requests were answered by different models |
| 2 | The conversation was compacted | A compaction ran between them |
| 3 | The cache lapsed | More than 5 minutes passed between them |
| 4 | The start of the prompt changed | None of the above, so something early changed: the system prompt or the list of tools |

## Install

```
/plugin install prompt-cache-watch --marketplace ramankrishna/prompt-cache-watch
```

Answer `y` to add the marketplace, then pick a scope. Needs Claude Code v2.1.287 or later.

## What it runs, reads and stores

- **Reads** the token counts and model name the API reports for each request, and the time of each request. Nothing else: not your prompts, not Claude's answers, not your files.
- **Changes nothing.** Every request and response passes through untouched.
- **Calls no model** and runs no commands.
- **Stores nothing on disk.** The numbers live in the session's memory and are gone when it ends.
- **Sends nothing** anywhere. No network calls, no telemetry.

Like every mod, it runs with the same access to your machine as Claude Code itself. The full statement is in [PRIVACY.md](PRIVACY.md).

## Limits

- **The cause is a best guess.** The API reports counts, not reasons. The mod infers the reason from what it can see, in the order above. Cause 4 is what is left when nothing else fits, and it cannot say which part of the prompt changed.
- **The 5 minutes is the shortest cache lifetime.** Some plans and setups keep the cache longer. Time is only named as the cause when a rebuild did happen after a wait that long, so a longer lifetime does not produce false notices, but a rebuild after a 6-minute wait on a longer-lived cache will be blamed on time when something else caused it.
- **Only losses of more than half are called a rebuild.** A smaller loss shows up as a lower percentage for the turn and raises no notice.
- **A rebuild after a compaction is expected.** It is reported so the numbers add up, not because something went wrong.
- **Rewinding far back** shortens the conversation, and the next request can look like a rebuild.
- **Tokens, not money.** Cache reads are billed below the normal input price and cache writes above it, at rates that depend on the model and plan. The mod shows the counts and leaves the pricing to you.
- **The main conversation's turn requests only.** Subagents are counted apart and are not checked for rebuilds, since each has a cache of its own. Requests Claude Code makes outside a turn, such as the summary a compaction writes, are not counted.
- **One session at a time.** `/clear` and `/resume` start the numbers over, and nothing is kept between sessions.
- **Checked against Claude Code's plugin test kit** with made-up token counts covering each cause. It reports what the API says, so if a provider or gateway reports no cache counts, it shows 0% and raises nothing.

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

## License

MIT
