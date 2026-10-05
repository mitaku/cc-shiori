# cc-shiori

[日本語](README.ja.md)

A Claude Code mod that keeps a *shiori* (a bookmark) in each session:

- **where it stands** — purpose, status, what waits on you, next, done, decisions
- **an index** of the numbered references it mentions — tickets (`ABC-123`), pull requests (`owner/repo#12`), issues, tasks (`T-012`) — and what each points at

When you run several sessions in parallel and switch between them, you lose track of what each one is for, and of what `t-0005` or `ABC-123` meant. The session remembers; you don't. Shiori shows it above the prompt and in a pane.

## What it shows

**Above the prompt**: purpose and status, `(working)` while a turn runs, how many things wait on you, and a `details` button.

**The pane** (`/shiori` or `details`): purpose, status, waiting on you, next, the index (newest mention first), and the latest done items and decisions.

## Install

```text
/plugin marketplace add mitaku/cc-shiori
/plugin install shiori@cc-shiori
/reload-plugins
```

## Use

- Work as usual; the shiori updates after each main-conversation turn, without holding the turn up.
- `/shiori` opens the pane; `/shiori refresh` rewrites it from the latest turns.
- Labels and text follow Claude Code's `language` setting.

## How it works

- After each main turn, Haiku gets the previous shiori and the new turn only (the request, the final answer, and the main tool actions — never file reads or search results) and returns the updated one.
- The index is what the session understood each reference to be. Entries the model drops are kept; new or changed ones move to the top.
- Each session's shiori is saved in the mod's store (`~/.claude/plugins/store/`), the latest 200 kept. A resumed session shows its saved shiori when it is current, else rewrites it. `/clear` starts over.
- Non-interactive runs (`claude -p`) and subagent turns are left alone.

## Cost

One Haiku call per main turn, through the session's own account and provider; the pane shows the count. Disable the plugin in `/plugin` to stop it.

## Acknowledgements

Inspired by [skanehira/claude-recap-plus](https://github.com/skanehira/claude-recap-plus), which first put a session summary above the prompt. Shiori adds the index and is written from scratch.

## License

MIT
