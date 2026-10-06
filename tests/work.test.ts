import { expect, test } from 'claude-code/testing'

import { countOf, countsLine, elapsed, idleWork, noteCall } from '../hooks/core'

const words = { edits: '編集', commands: 'コマンド', others: '他' }

test('a call counts as an edit, a command or other, and becomes the latest', () => {
  expect(countOf('Edit')).toBe('edits')
  expect(countOf('NotebookEdit')).toBe('edits')
  expect(countOf('Bash')).toBe('commands')
  expect(countOf('Read')).toBe('others')
  let w = noteCall(idleWork(), 'Bash', 'Bash: Run tests', 1000)
  w = noteCall(w, 'Edit', 'Edit: a.ts', 2000)
  w = noteCall(w, 'Grep', undefined, 3000)
  expect(w.startedAt).toBe(1000)
  expect(w.last).toBe('Grep')
  expect(countsLine(w, words)).toBe('編集 1 · コマンド 1 · 他 1')
})

test('counts at zero are left out', () => {
  expect(countsLine(noteCall(idleWork(), 'Bash', undefined, 0), words)).toBe('コマンド 1')
  expect(countsLine(idleWork(), words)).toBe('')
})

test('elapsed reads m:ss, then h:mm:ss', () => {
  expect(elapsed(0)).toBe('0:00')
  expect(elapsed(192_000)).toBe('3:12')
  expect(elapsed(3_725_000)).toBe('1:02:05')
  expect(elapsed(-5)).toBe('0:00')
})
