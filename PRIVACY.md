# Privacy

Last updated: October 9, 2026

Cache Watch is a mod that runs inside Claude Code on your own machine. It has no server and no account.

## What it collects

Nothing. Cache Watch does not collect, transmit or share any data with its author or any third party. It makes no network requests and sends no telemetry or analytics. The author receives no information about you or your use of it.

## What it handles on your machine

To do its job, Cache Watch works with the following, all of which stay on your computer:

- **During a session, in memory:** for each request Claude Code makes to the model, the four token counts the API reports (input, output, read from the cache, written to the cache), the name of the model that answered, and the time. From these it keeps totals for the session, a row for each of the last 50 turns, and the last 30 cache rebuilds.
- **Between sessions:** nothing. It writes no files and keeps nothing in Claude Code's plugin store. The numbers are gone when the session ends or is cleared.

It does not read your prompts, Claude's answers, tool calls or files. Requests and responses pass through it unchanged.

## Model calls

None. Cache Watch never calls a model and adds nothing to your conversation.

## Removing its data

There is nothing to remove. Uninstalling the plugin stops everything above.

## What Cache Watch does not cover

Cache Watch runs inside Claude Code. How Claude Code and Anthropic handle your prompts, code and usage is governed by Anthropic's own policies, not this one.

## Changes

Any change to this policy will be made in this file, and the history is visible in the repository.

## Contact

Questions or concerns: open an issue at https://github.com/ramankrishna/prompt-cache-watch/issues
