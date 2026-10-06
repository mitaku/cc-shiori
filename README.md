# cc-shiori

[日本語](README.ja.md)

A *shiori* (a bookmark) for Claude Code sessions you run in parallel: when you come back to one, it tells you three things, from **that session alone**:

1. **Where it stands** — purpose, status, next (and what is done and decided)
2. **Whether it is your turn** — what Claude waits on you to answer, decide or do (`?2 ◇1 !1`)
3. **What that number was** — what each ticket (`ABC-123`), pull request (`owner/repo#12`) or task (`T-012`) it mentioned points at (the index)

When you switch between sessions you lose track of what each one is for, whether it is waiting on you, and what `t-0005` meant. The session remembers; you don't. Shiori shows it in a band above the prompt and in a pane.

A shiori sits in one book (one session) and looks at nothing else: not other sessions, not the working directory. Choosing which session to go to is the terminal's job (herdr's sidebar and the like); the shiori tells you where you left off once you are there.

## What it shows

**Above the prompt**: a mark, the status and a `details` button on the first line, the purpose on the second. The mark comes first, so a long status never pushes it out of sight. The band starts with 🔖. While the pane is open it keeps only the state, spelled out (`🔖 shiori  ?2 answer · !1 do`); the pane says the rest.

| Mark | Meaning |
|---|---|
| `?2 ◇1 !1` (yellow) | what waits on you, by kind: `?` a question to answer, `◇` a decision (a choice or an approval), `!` something to do by hand (open a URL, sign in, run a command, check a screen) |
| `●` | working (nothing waits on you) |
| `✓` | at a stopping point (nothing next) |
| `○` | idle |

**While Claude works** the status line becomes a live one (the previous turn's status is out of date by then):

```
🔖 ● 3:12  edits 4 · commands 7   Bash: Run tests
  └ look into index links  Explore · sonnet  Grep  0:41
Purpose  settle the ballistics spec
```

How long the turn has run, how many edits, commands and other calls it made, its latest call, and the subagents running (task, type, model, tool in use, time; up to three). All of it comes from the engine's events: no model is called. When the turn ends the band goes back to the status Haiku wrote.

Haiku tells what waits and of which kind. When the final answer ends in a question and Haiku listed nothing, that question stands as a `?`, so the mark does not hang on the model alone.

**The pane** (`/shiori` or `details`): purpose, status, waiting on you (each with its mark and kind), next, the index (newest mention first), and the latest done items and decisions.

## Install

```text
/plugin marketplace add mitaku/cc-shiori
/plugin install shiori@cc-shiori
/reload-plugins
```

Checked on Claude Code 2.1.289. The mod (function hooks) API is still early access, so a Claude Code update may break it.

## Use

- Work as usual; the shiori updates after each main-conversation turn, without holding the turn up.
- `/shiori` opens the pane; `/shiori refresh` rewrites it from the latest turns, on top of the previous one; `/shiori refresh --hard` drops the previous one and its index and starts over from the latest turns and the earlier requests (when the index holds on to what the session has moved on from).
- Labels and text follow Claude Code's `language` setting.

### Index links and details

- Where a link cannot open (a container with no browser, a multiplexer that drops hyperlinks), a row with a URL has `⧉` on a terminal (the desktop opens the link, so it has none): it copies the URL to the clipboard, the way `/copy` does (OSC 52 and the like).
- An index id links to its page when the URL is known: GitHub pull requests, issues and commits (`owner/repo#12`, `owner/repo@sha`) need no setup. A bare `#12` or sha does not link: guessing its repository from the working directory sends a session that spans repositories to the wrong place.
- For other trackers (Backlog, Jira …) set **Index links** in `/config` (`shiori.linkRules` under `pluginConfigs`): `regex => URL template` entries separated by `;`, `{id}` the whole id and `{1}` `{2}` the pattern's groups.

  ```text
  [A-Z][A-Z0-9_]+-\d+ => https://example.backlog.jp/view/{id}
  ```

- Hovering an index row opens its details beneath it: the full description, kind, URL, the turn it was last mentioned in, and **the words around its latest mention** with who said them (where the surface has a pointer).
- On the terminal each row also has `↥`, which scrolls the transcript to that latest mention (the desktop app refuses a plugin's transcript scroll, so the quote stands in for it there).

## How it works

- **A shiori stays inside its session.** It is made from that session's conversation alone: never another session, nor the working directory's files or git state. Looking across sessions is the terminal's job (herdr's sidebar and the like).
- After each main turn, Haiku gets the previous shiori and the new turn only (the request, the final answer, and the main tool actions — never file reads or search results) and returns the updated one.
- The index is what the session understood each reference to be. Entries the model drops are kept; new or changed ones move to the top.
- Each session's shiori is saved in the mod's store (`~/.claude/plugins/store/`), the latest 200 kept. A resumed session shows its saved shiori when it is current, else rewrites it. `/clear` starts over.
- Non-interactive runs (`claude -p`) and subagent turns are left alone.

## Cost

One Haiku call per main turn, through the session's own account and provider; the pane shows the count. Disable the plugin in `/plugin` to stop it.

## What it keeps

Each session's shiori (purpose, status, decisions, the index …) is saved **in plain text** under `~/.claude/plugins/store/`, the latest 200 sessions kept. The index holds **verbatim excerpts of the conversation** where each id came up; keep that in mind for work conversations. To remove it, disable the plugin in `/plugin` and delete that store.

## Related

[skanehira/claude-recap-plus](https://github.com/skanehira/claude-recap-plus) also puts a session summary above the prompt. Shiori was thought up separately; I learned of that similar take along the way. Compare the two and use whichever suits you.

## License

MIT
