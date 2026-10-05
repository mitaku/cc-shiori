import { expect, test } from 'claude-code/testing'

import { parseLinkRules, refUrl } from '../hooks/core'

test('qualified GitHub ids link; bare ones do not', () => {
  expect(refUrl({ id: 'mitaku/cc-shiori#12' }, [])).toBe('https://github.com/mitaku/cc-shiori/issues/12')
  expect(refUrl({ id: 'mitaku/cc-shiori@eaca338' }, [])).toBe('https://github.com/mitaku/cc-shiori/commit/eaca338')
  expect(refUrl({ id: '#12' }, [])).toBe(undefined)
  expect(refUrl({ id: '9f32f61' }, [])).toBe(undefined)
})

test("a user's rule comes first", () => {
  const rules = parseLinkRules('VAL-\\d+ => https://example.backlog.jp/view/{id}')
  expect(refUrl({ id: 'VAL-03' }, rules)).toBe('https://example.backlog.jp/view/VAL-03')
})
