# cc-shiori

[日本語](README.ja.md)

A Claude Code mod that keeps a *shiori* (a bookmark) in each session:

- **where it stands** — purpose, status, what waits on you, next, done, decisions
- **an index** of the numbered references it mentions — tickets (`ABC-123`), pull requests (`owner/repo#12`), issues, tasks (`T-012`) — and what each points at

When you run several sessions in parallel and switch between them, you lose track of what each one is for, and of what `t-0005` or `ABC-123` meant. The session remembers; you don't. Shiori shows it above the prompt and in a pane.

## What it shows

**Above the prompt**: a mark, the status and a `details` button on the first line, the purpose on the second. The mark comes first, so a long status never pushes it out of sight.

| Mark | Meaning |
|---|---|
| `?2 ◇1 !1` (yellow) | what waits on you, by kind: `?` a question to answer, `◇` a decision (a choice or an approval), `!` something to do by hand (open a URL, sign in, run a command, check a screen) |
| `●` | working (nothing waits on you) |
| `✓` | at a stopping point (nothing next) |
| `○` | idle |

Haiku tells what waits and of which kind. When the final answer ends in a question and Haiku listed nothing, that question stands as a `?`, so the mark does not hang on the model alone.

**The pane** (`/shiori` or `details`): purpose, status, waiting on you (each with its mark and kind), next, the index (newest mention first), and the latest done items and decisions.

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

### Index links and details

- An index id links to its page when the URL is known: GitHub pull requests, issues and commits (`owner/repo#12`, `owner/repo@sha`, or `#12` in the session's own repository) need no setup.
- For other trackers (Backlog, Jira …) set **Index links** in `/config` (`shiori.linkRules` under `pluginConfigs`): `regex => URL template` entries separated by `;`, `{id}` the whole id and `{1}` `{2}` the pattern's groups.

  ```text
  [A-Z][A-Z0-9_]+-\d+ => https://example.backlog.jp/view/{id}
  ```

- Hovering an index row opens its details beneath it: the full description, kind, URL, the turn it was last mentioned in, and **the words around its latest mention** with who said them (where the surface has a pointer).
- On the terminal each row also has `↥`, which scrolls the transcript to that latest mention (the desktop app refuses a plugin's transcript scroll, so the quote stands in for it there).

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
