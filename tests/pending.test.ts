import { expect, test } from 'claude-code/testing'

import type { Gist } from '../types'
import { closingQuestion, fallbackGist, normalizeGist, parseReply, pendingCounts, turnsFrom, withClosingQuestion } from '../hooks/core'

const gist = (pending: unknown): Gist =>
  ({ purpose: 'p', status: 's', done: [], decisions: [], pending, next: '', refs: [] }) as unknown as Gist

test('a reply gives each waiting item its kind; an unknown kind or a bare string is a question', () => {
  const r = parseReply(
    JSON.stringify({
      purpose: 'p',
      status: 's',
      pending: [
        { kind: 'decision', text: 'A か B か' },
        { kind: 'action', text: 'OAuth の URL を開く' },
        { kind: 'other', text: '名前を教えて' },
        '昔の形',
        { kind: 'question', text: '' },
      ],
    }),
  )
  expect(r?.pending).toEqual([
    { kind: 'decision', text: 'A か B か' },
    { kind: 'action', text: 'OAuth の URL を開く' },
    { kind: 'question', text: '名前を教えて' },
    { kind: 'question', text: '昔の形' },
  ])
})

test('a record saved before 0.5.0 (pending as strings) reads as questions', () => {
  expect(normalizeGist(gist(['どちらにする?'])).pending).toEqual([{ kind: 'question', text: 'どちらにする?' }])
})

test('counts come in the order ? ◇ !, kinds with none left out', () => {
  const counts = pendingCounts([
    { kind: 'action', text: 'a' },
    { kind: 'question', text: 'b' },
    { kind: 'question', text: 'c' },
  ])
  expect(counts.map(c => `${c.mark}${c.n}`).join(' ')).toBe('?2 !1')
})

test('an answer ending on a question hands it to the user', () => {
  expect(closingQuestion('案は2つです。\n\n- A\n- B\n\nどちらで進めますか？')).toBe('どちらで進めますか？')
  expect(closingQuestion('**Which one should I take?**\n')).toBe(undefined)
  expect(closingQuestion('Which one?\n\nDone.')).toBe(undefined)
})

test('the closing question stands in only when the model listed nothing', () => {
  expect(withClosingQuestion([], 'どれ?')).toEqual([{ kind: 'question', text: 'どれ?' }])
  const listed = [{ kind: 'decision' as const, text: 'A か B か' }]
  expect(withClosingQuestion(listed, 'どれ?')).toEqual(listed)
  expect(withClosingQuestion([], undefined)).toEqual([])
})

test('the closing question is read before the answer is capped', () => {
  const long = `${'x'.repeat(5000)}\n\n進めてよいですか?`
  const [turn] = turnsFrom([
    { role: 'user', text: 'やって', toolUses: [] },
    { role: 'assistant', text: long, toolUses: [] },
  ])
  expect(turn?.question).toBe('進めてよいですか?')
  expect(fallbackGist(null, turn!)?.pending).toEqual([{ kind: 'question', text: '進めてよいですか?' }])
})
