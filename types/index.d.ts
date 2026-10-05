/** What an indexed reference points at. */
export type RefKind = 'pr' | 'issue' | 'ticket' | 'task' | 'commit' | 'other'

/** One numbered reference the session mentioned, and what it is. */
export type Ref = {
  /** As written, qualified where the session knows how (`owner/repo#12`, `ABC-123`). */
  id: string
  kind: RefKind
  /** What it is, in a few words (not its state). */
  what: string
  /** The turn it was last mentioned or changed in; the index sorts on it. */
  turn: number
  /** The words around its latest mention in the conversation, on one line. */
  quote?: string
  /** Whose message that mention is in. */
  quoteBy?: 'user' | 'assistant'
}

/** Where the session stands. */
export type Gist = {
  purpose: string
  status: string
  done: string[]
  decisions: string[]
  pending: string[]
  next: string
  refs: Ref[]
}

/** One turn of the main conversation, as the summary reads it. */
export type Turn = {
  n: number
  /** null for a turn that began without a request of the user's. */
  ask: string | null
  answer: string
  /** What the turn did with its tools, one line each. */
  activity: string[]
}

export type Usage = { calls: number; input: number; output: number }

export type Live = {
  /** null until the session's conversation has been read. */
  sessionId: string | null
  turns: Turn[]
  gist: Gist | null
  /** The turn the gist was written after; an older reply never replaces it. */
  gistTurn: number
  /** Moves on at /clear and /resume, so a late reply for the old conversation is dropped. */
  epoch: number
  usage: Usage
}

/** What the store keeps per session, under `shiori:<session id>`. */
export type Saved = {
  gist: Gist
  /** Fingerprint of the last turn the gist was written after. */
  turnKey: string
  savedAt: number
  cwd: string
  usage: Usage
}

declare module 'claude-code' {
  interface PluginState {
    shiori: { live: Live }
  }
}
