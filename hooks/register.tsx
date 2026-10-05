import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { Gist, Live, Ref, Saved, Turn } from '../types'
import {
  LIMITS,
  PENDING_MARK,
  buildPrompt,
  clean,
  clip,
  closingQuestion,
  describeTool,
  emptyLive,
  emptyUsage,
  fallbackGist,
  githubRepoOf,
  localeFor,
  mentions,
  mergeRefs,
  normalizeGist,
  parseLinkRules,
  pendingCounts,
  parseReply,
  quotesFor,
  refUrl,
  systemPrompt,
  turnKeyOf,
  turnText,
  turnsFrom,
  withClosingQuestion,
} from './core'
import type { GitHubRepo, LinkRule, Locale } from './core'

// shiori: where a session stands, and an index of the IDs it mentions.
// After each main-loop turn a small model updates the record from the previous record and
// the new turn; the band above the prompt shows purpose and status, the pane shows it all.

const PANE = 'shiori'
const STORE_PREFIX = 'shiori:'
const STORE_MAX = 200
const ACCENT = 'cyan'
/** What waits on the user: the same yellow as the count of it in the band. */
const WAITING = 'yellow'
/** Leads the band, so a mark alone still says whose band it is. */
const BOOKMARK = '🔖'

const live = atom({ plugin: 'shiori', key: 'live' } as const, emptyLive())
/** Whether the pane is up: the band then keeps only its mark, the pane says the rest. */
const paneOpen = atom({ plugin: 'shiori', key: 'paneOpen' } as const, false)

// Module variables start over on a hot reload; the record itself lives in $.state and $.store.
let locale: Locale = localeFor(undefined)
let ask: string | null = null
let activity: string[] = []
let isBusy = false
let isQueued = false
/** The session's GitHub repository, for bare `#12` and commit ids; null elsewhere. */
let repo: GitHubRepo | null = null
/** The `linkRules` option: where other ids (Backlog, Jira …) link to. */
let rules: LinkRule[] = []

async function refreshRepo($: EngineInterface) {
  repo = githubRepoOf((await $.session.repo())?.remote)
}

// The transcript rows drawn so far, in the order first drawn, each with its requestId (the
// message id) and text (lowercased, capped): what "go to the mention" (↥, terminal only) searches,
// newest first. The module's (a render hook cannot write $.state): after a reload it fills
// again as rows are drawn. The desktop app draws rows too but refuses a plugin's transcript
// scroll ("transcript not scrollable here", 2026-10-05), so there the quote stands in for it.
const ROW_TEXT_MAX = 4000
const ROWS_MAX = 3000
let rows: { requestId: string; text: string }[] = []
const rowIndex = new Map<string, number>()

function noteRow(requestId: string, text: string) {
  const t = text.slice(0, ROW_TEXT_MAX).toLowerCase()
  const i = rowIndex.get(requestId)
  if (i !== undefined) {
    rows[i] = { requestId, text: t }
    return
  }
  rowIndex.set(requestId, rows.length)
  rows.push({ requestId, text: t })
  if (rows.length > ROWS_MAX) {
    rows = rows.slice(-Math.floor(ROWS_MAX * 0.8))
    rowIndex.clear()
    rows.forEach((r, n) => rowIndex.set(r.requestId, n))
  }
}

/** The latest drawn transcript row that mentions the id, by its requestId (the message id). */
function rowMentioning(id: string): string | undefined {
  for (let i = rows.length - 1; i >= 0; i--) if (mentions(id, rows[i].text)) return rows[i].requestId
  return undefined
}

/**
 * Puts a ref's URL on the clipboard: where the terminal cannot open a link (a container with
 * no browser, a multiplexer that drops the hyperlink), the person pastes it where one can.
 */
async function copyUrl($: EngineInterface, url: string, surface: RenderSurface) {
  const r = await $.ui.copy({ text: url, surface })
  $.ui.toast(r.isCopied ? locale.words.copied : `${locale.words.notCopied}: ${r.reason}`)
}

/** Scrolls the transcript to the latest message mentioning the id; a press is the person's input, which a transcript scroll needs. */
async function jumpTo($: EngineInterface, id: string) {
  const row = rowMentioning(id)
  if (row === undefined) {
    $.ui.toast(locale.words.notFound)
    return
  }
  const r = (await $.ui.scroll({ to: { requestId: row }, block: 'center' })) as { deny?: string }
  if (r.deny) $.ui.toast(`${locale.words.cannotScroll}: ${r.deny}`)
}

/**
 * Whether anyone draws this session. `session.start`'s `isInteractive` cannot tell: the desktop
 * app's Code tab is an SDK host whose surface attaches after the start (`interactive=false`,
 * `surface=null` there, measured 2026-10-05), so the model is asked only when a surface is on.
 */
async function hasSurface($: EngineInterface) {
  return (await $.session.surfaces()).length > 0
}

async function refreshLocale($: EngineInterface) {
  const settings = (await $.settings.read()) as Record<string, unknown>
  locale = localeFor(settings.language)
}

async function save($: EngineInterface, l: Live) {
  if (l.sessionId === null || l.gist === null) return
  const saved: Saved = {
    gist: l.gist,
    turnKey: turnKeyOf(l.turns.find(t => t.n === l.gistTurn)),
    savedAt: await $.clock.now(),
    cwd: await $.session.cwd(),
    usage: l.usage,
  }
  await $.store.set(`${STORE_PREFIX}${l.sessionId}`, saved)
}

async function prune($: EngineInterface) {
  const keys = (await $.store.keys()).filter(k => k.startsWith(STORE_PREFIX))
  if (keys.length <= STORE_MAX) return
  const dated: [string, number][] = []
  for (const k of keys) dated.push([k, ((await $.store.get(k)) as Saved | undefined)?.savedAt ?? 0])
  dated.sort((a, b) => b[1] - a[1])
  for (const [k] of dated.slice(STORE_MAX)) await $.store.delete(k)
}

/** Updates the gist from the turns written since it; one run at a time, a request meanwhile runs after. */
async function summarize($: EngineInterface) {
  if (isBusy) {
    isQueued = true
    return
  }
  isBusy = true
  try {
    do {
      isQueued = false
      const cur = await read($, live)
      const prompt = buildPrompt(cur)
      const last = cur.turns.at(-1)
      if (prompt === undefined || last === undefined) break
      if (!(await hasSurface($))) break
      await refreshLocale($)
      const r = await $.model.complete({
        model: 'haiku',
        system: systemPrompt(locale.language),
        prompt,
        maxTokens: 2000,
        effort: 'low',
        timeoutMs: 30000,
      })
      const after = await read($, live)
      if (after.epoch !== cur.epoch || last.n < after.gistTurn) break
      const u = (r.usage ?? {}) as { input_tokens?: number; output_tokens?: number }
      const usage = {
        calls: after.usage.calls + 1,
        input: after.usage.input + (u.input_tokens ?? 0),
        output: after.usage.output + (u.output_tokens ?? 0),
      }
      const parsed = r.isAnswered ? parseReply(r.text) : undefined
      if (!r.isAnswered) $.ui.log(`shiori: no summary (${r.reason})`, { to: 'debug' })
      const fresh = cur.turns.filter(t => t.n > cur.gistTurn)
      const merged: Gist | undefined = parsed
        ? {
            ...parsed,
            pending: withClosingQuestion(parsed.pending, last.question),
            refs: mergeRefs(cur.gist?.refs ?? [], parsed.refs, last.n, turnText(fresh)),
          }
        : fallbackGist(cur.gist, last)
      // Each id's latest mention, quoted from the whole conversation (no drawing needed, so past
      // messages count and it works where the transcript cannot be scrolled to, as on the desktop).
      const messages = merged ? await $.session.messages() : []
      const gist: Gist | undefined =
        merged && Array.isArray(messages) ? { ...merged, refs: quotesFor(merged.refs, messages) } : merged
      if (gist === undefined) {
        await update($, live, l => ({ ...l, usage }))
        break
      }
      await update($, live, l => ({ ...l, gist, gistTurn: last.n, usage }))
      await save($, await read($, live))
    } while (isQueued)
  } catch (err) {
    $.ui.log(`shiori: ${String(err)}`, { to: 'debug' })
  } finally {
    isBusy = false
  }
}

/** Reads the session's conversation: a saved gist of its last turn is shown as is, else rewritten. */
async function openSession($: EngineInterface, epoch: number) {
  const id = await $.session.id()
  const messages = await $.session.messages()
  if (!Array.isArray(messages)) return
  const turns: Turn[] = turnsFrom(messages)
  const saved = (await $.store.get(`${STORE_PREFIX}${id}`)) as Saved | undefined
  const last = turns.at(-1)
  const isCurrent = saved !== undefined && last !== undefined && saved.turnKey === turnKeyOf(last)
  let stale = false
  await update($, live, l => {
    if (l.epoch !== epoch) return l
    // A turn recorded while the transcript was being read is newer than the transcript.
    const merged = l.turns.length > turns.length ? l.turns : turns
    stale = !isCurrent && merged.length > 0
    return {
      ...l,
      sessionId: id,
      turns: merged,
      gist: saved ? normalizeGist(saved.gist) : l.gist,
      gistTurn: isCurrent ? (last?.n ?? 0) : Math.max(0, merged.length - LIMITS.turnsPerRequest),
      usage: saved?.usage ?? l.usage,
    }
  })
  if (stale) await summarize($)
}

/** After /clear or /resume the process goes on under another session id: wait for it, then read it. */
async function reopen($: EngineInterface, epoch: number, oldId: string | null, tries: number) {
  const id = await $.session.id()
  if (id === oldId && tries < 20) {
    $.clock.after(500, () => void reopen($, epoch, oldId, tries + 1))
    return
  }
  await openSession($, epoch)
}

async function openPane($: EngineInterface) {
  await $.ui.open({ id: PANE, title: locale.words.title })
}

async function closePane($: EngineInterface) {
  await $.ui.close({ id: PANE })
}

/** The kind column: the widest tag (`Commit`, `Ticket`) and a space. */
const TAG_WIDTH = 8

const KIND_TAG: Record<Ref['kind'], string> = {
  pr: 'PR',
  issue: 'Issue',
  ticket: 'Ticket',
  task: 'Task',
  commit: 'Commit',
  other: '',
}

export const register: Register = (on, options) => {
  rules = parseLinkRules((options as Record<string, unknown> | undefined)?.linkRules)

  on('session.start', async ($, e, next) => {
    await refreshLocale($)
    await refreshRepo($)
    await $.command.register({
      name: 'shiori',
      description: 'Where this session stands: purpose, status, what waits on you, next, and an index of the IDs it mentions. `refresh` rewrites it.',
    })
    // A reload finds the pane as the engine kept it.
    const isUp = (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced)
    await update($, paneOpen, () => isUp)
    const { epoch } = await read($, live)
    $.clock.after(0, () => void openSession($, epoch))
    $.clock.after(5000, () => void prune($))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      const cur = await read($, live)
      const epoch = cur.epoch + 1
      await update($, live, () => emptyLive(epoch))
      ask = null
      activity = []
      $.clock.after(500, () => void reopen($, epoch, cur.sessionId, 0))
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // The user's own requests: typed at a terminal, through Remote Control, or through an SDK
    // host such as the desktop app (its prompts arrive as `sdk`).
    const k = e.origin.kind
    if (e.turnId === undefined && (k === 'composer' || k === 'bridge' || k === 'sdk')) {
      const text = clean(e.text)
      ask = text ? clip(text, LIMITS.ask) : null
      activity = []
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined) {
      const line = describeTool(e.tool, e as unknown as Record<string, unknown>)
      if (line) activity = [...activity, line].slice(-LIMITS.activity)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    const full = clean(done.text ?? '')
    const answer = clip(full, LIMITS.answer)
    const question = closingQuestion(full)
    const recorded = { ask, activity }
    ask = null
    activity = []
    await update($, live, l => {
      const turn: Turn = { n: (l.turns.at(-1)?.n ?? 0) + 1, ask: recorded.ask, answer, activity: recorded.activity, question }
      return { ...l, turns: [...l.turns, turn].slice(-LIMITS.turns) }
    })
    $.clock.after(0, () => void summarize($))
    return done
  })

  // A surface that attaches after the start (the desktop app) gets the shiori read then.
  on('session.attach', async ($, e, next) => {
    const done = await next(e)
    const cur = await read($, live)
    if (cur.gist === null) $.clock.after(0, () => void openSession($, cur.epoch))
    return done
  })

  on('command.run', { command: 'shiori' }, async ($, e) => {
    await refreshLocale($)
    if (e.args.trim() === 'refresh') {
      await update($, live, l => ({ ...l, gistTurn: Math.max(0, (l.turns.at(-1)?.n ?? 0) - LIMITS.turnsPerRequest) }))
      await summarize($)
      return { text: locale.words.refreshed }
    }
    await openPane($)
    return { text: locale.words.opened }
  })

  on('ui.open', { id: PANE }, async ($, e, next) => {
    const r = await next(e)
    if ('value' in r) await update($, paneOpen, () => r.value?.isPlaced === true)
    return r
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const r = await next(e)
    if ('value' in r) await update($, paneOpen, () => false)
    return r
  })

  // Note each transcript row's text as it is drawn, for "go to the mention"; the row is drawn as the engine draws it.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    noteRow(e.requestId, e.props.text)
    return next(e)
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    noteRow(e.requestId, e.props.text)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const cur = await read($, live)
    if (e.props.hasSurvey || (cur.gist === null && cur.turns.length === 0)) return next(e)
    const isPaneOpen = await read($, paneOpen)
    const { Box, Text, Button } = $.ui.resolve(e)
    const w = locale.words
    const g = cur.gist
    const counts = pendingCounts(g ? normalizeGist(g).pending : [])
    // The state comes first and never shrinks, so a long status cannot push it out of sight:
    // `?2 ◇1 !1` what waits on you, else ● working, ✓ nothing next, ○ idle.
    const [mark, color, said] =
      counts.length > 0
        ? [counts.map(c => `${c.mark}${c.n}`).join(' '), WAITING, counts.map(c => `${c.mark}${c.n} ${w.kinds[c.kind]}`).join(' · ')]
        : e.props.isWorking
          ? ['●', ACCENT, `● ${w.states.working}`]
          : g && !g.next
            ? ['✓', 'green', `✓ ${w.states.done}`]
            : ['○', undefined, `○ ${w.states.idle}`]
    const state = (
      <Text color={color} dimColor={color === undefined} bold={counts.length > 0}>
        {`${BOOKMARK} ${mark}`}
      </Text>
    )

    // With the pane up it says the rest; the band names itself and spells the mark out.
    if (isPaneOpen)
      return (
        <Box>
          <Text color={ACCENT}>{`${BOOKMARK} ${w.name}  `}</Text>
          <Text color={color} dimColor={color === undefined} bold={counts.length > 0}>
            {said}
          </Text>
        </Box>
      )

    return (
      <Box flexDirection="column">
        <Box>
          <Box flexShrink={0}>{state}</Box>
          <Text> </Text>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">{g?.status ?? w.notYet}</Text>
          </Box>
          <Box flexShrink={0}>
            <Text> </Text>
            <Button key="details" label={w.details} onPress={() => void openPane($)} />
          </Box>
        </Box>
        <Box>
          <Text color={ACCENT}>{w.purpose} </Text>
          <Text dimColor wrap="truncate-end">
            {g?.purpose ?? w.notYet}
          </Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    // A plugin may scroll the transcript on the terminal; the desktop app refuses it.
    const canScroll = e.surface === 'terminal'
    const cur = await read($, live)
    const w = locale.words
    const g = cur.gist
    const rows = (items: readonly string[]) => (items.length ? items : [w.none])
    const pending = g ? normalizeGist(g).pending : []
    // The id column fits the longest id, up to two fifths of the pane.
    const idWidth = Math.min(
      Math.max(8, ...(g?.refs ?? []).map(r => r.id.length + 2)),
      Math.max(12, Math.floor(e.props.bodyColumns * 0.4)),
    )
    const sections: [string, readonly string[]][] = g
      ? [
          [w.purpose, [g.purpose]],
          [w.status, [g.status]],
        ]
      : [[w.purpose, [w.notYet]]]
    const after: [string, readonly string[]][] = g ? [[w.next, rows(g.next ? [g.next] : [])]] : []
    const tail: [string, readonly string[]][] = g
      ? [
          [w.done, rows(g.done)],
          [w.decisions, rows(g.decisions)],
        ]
      : []

    return (
      <Box flexDirection="column" gap={1}>
        {sections.map(([title, items]) => (
          <Box key={`s-${title}`} flexDirection="column">
            <Text color={ACCENT} bold>
              {title}
            </Text>
            {items.map((item, i) => (
              <Text key={`${title}-${i}`}>{items.length > 1 ? `• ${item}` : item}</Text>
            ))}
          </Box>
        ))}
        {g ? (
          <Box key="s-pending" flexDirection="column">
            <Text color={ACCENT} bold>
              {w.pending}
            </Text>
            {pending.length === 0 ? <Text dimColor>{w.none}</Text> : null}
            {pending.map((p, i) => (
              <Box key={`p-${i}`}>
                <Box flexShrink={0}>
                  <Text color={WAITING} bold>{`${PENDING_MARK[p.kind]} `}</Text>
                  <Text dimColor>{`${w.kinds[p.kind]}  `}</Text>
                </Box>
                <Text>{p.text}</Text>
              </Box>
            ))}
          </Box>
        ) : null}
        {after.map(([title, items]) => (
          <Box key={`a-${title}`} flexDirection="column">
            <Text color={ACCENT} bold>
              {title}
            </Text>
            {items.map((item, i) => (
              <Text key={`${title}-${i}`}>{item}</Text>
            ))}
          </Box>
        ))}
        {g ? (
          <Box key="s-refs" flexDirection="column">
            <Text color={ACCENT} bold>
              {w.refs}
            </Text>
            {g.refs.length === 0 ? <Text dimColor>{w.none}</Text> : null}
            {g.refs.map(r => {
              const url = refUrl(r, repo, rules)
              const tag = KIND_TAG[r.kind]
              // One line per id, in columns: the id (a link where it has a URL), its kind, what it
              // is, then the buttons at the right end. Hovering the line opens its details beneath
              // it, in the flow, so nothing is drawn over other rows.
              return (
                <Box key={`ref-${r.id}`} flexDirection="column">
                  <Box>
                    <Box width={idWidth} flexShrink={0}>
                      {url ? <Link href={url} label={r.id} /> : <Text bold wrap="truncate-end">{r.id}</Text>}
                    </Box>
                    <Box width={TAG_WIDTH} flexShrink={0}>
                      <Text dimColor>{tag}</Text>
                    </Box>
                    <Box flexGrow={1} flexShrink={1}>
                      <Text wrap="truncate-end">{r.what}</Text>
                    </Box>
                    {/* A link opens on the desktop; a terminal (a container with no browser) copies it instead. */}
                    {canScroll ? (
                      <Box flexShrink={0}>
                        <Text> </Text>
                        <Button key={`go-${r.id}`} label="↥" onPress={() => void jumpTo($, r.id)} />
                        {url ? <Text> </Text> : null}
                        {url ? <Button key={`copy-${r.id}`} label="⧉" onPress={() => void copyUrl($, url, e.surface)} /> : null}
                      </Box>
                    ) : null}
                  </Box>
                  <Box
                    display="none"
                    hover={{ display: 'flex' }}
                    flexDirection="column"
                    marginLeft={2}
                    paddingX={1}
                    borderStyle="round"
                    borderDimColor
                  >
                    <Text>{r.what || w.none}</Text>
                    <Text dimColor wrap="truncate-end">
                      {[tag, url, w.lastSeen(r.turn)].filter(Boolean).join('  ·  ')}
                    </Text>
                    {r.quote ? (
                      <Text italic>{`${r.quoteBy === 'user' ? w.byYou : w.byClaude}: ${r.quote}`}</Text>
                    ) : null}
                  </Box>
                </Box>
              )
            })}
          </Box>
        ) : null}
        {tail.map(([title, items]) => (
          <Box key={`t-${title}`} flexDirection="column">
            <Text color={ACCENT} bold>
              {title}
            </Text>
            {items.map((item, i) => (
              <Text key={`${title}-${i}`}>{items.length > 1 ? `• ${item}` : item}</Text>
            ))}
          </Box>
        ))}
        <Box key="footer">
          <Text dimColor>{`haiku ×${cur.usage.calls}  `}</Text>
          <Button key="close" label={w.close} onPress={() => void closePane($)} />
        </Box>
      </Box>
    )
  })
}
