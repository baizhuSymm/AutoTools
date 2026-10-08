import { Lexer } from 'marked'

export interface ReasoningPart {
  type: 'text' | 'reasoning'
  text: string
}

// Split provider control tags incrementally; Markdown itself is rendered by XMarkdown.
export class ReasoningSplitter {
  private pending = ''
  private fence: { character: string; length: number } | undefined
  private linePrefix = ''
  private escaped = false
  open = false
  seen = false

  feed(input: string, final = false): ReasoningPart[] {
    this.pending += input
    const parts: ReasoningPart[] = []
    const emit = (text: string): void => {
      const type = this.open ? 'reasoning' : 'text'
      const last = parts.at(-1)
      if (last?.type === type) last.text += text
      else parts.push({ type, text })
      for (const character of text) {
        if (character === '\n') this.linePrefix = ''
        else this.linePrefix = (this.linePrefix + character).slice(0, 4)
      }
    }
    let index = 0
    while (index < this.pending.length) {
      const character = this.pending[index]
      if (this.escaped) {
        emit(character)
        this.escaped = false
        index++
        continue
      }
      if (character === '\\' && !this.fence) {
        emit(character)
        this.escaped = true
        index++
        continue
      }
      const lineStart = /^ {0,3}$/.test(this.linePrefix)
      if (character === '`' || (character === '~' && lineStart)) {
        let end = index + 1
        while (this.pending[end] === character) end++
        if (end === this.pending.length && !final) break
        const length = end - index
        if (lineStart && length >= 3) {
          if (!this.fence) this.fence = { character, length }
          else if (this.fence.character === character && length >= this.fence.length) {
            const newline = this.pending.indexOf('\n', end)
            if (newline === -1 && !final) break
            const tail = this.pending.slice(end, newline === -1 ? undefined : newline)
            if (/^[ \t\r]*$/.test(tail)) this.fence = undefined
          }
        } else if (!this.fence && character === '`') {
          // Only complete Markdown code spans protect literal control tags.
          const token = Lexer.lexInline(this.pending.slice(index))[0]
          if (token?.type === 'codespan') {
            if (index + token.raw.length === this.pending.length && !final) break
            emit(token.raw)
            index += token.raw.length
            continue
          }
          if (!final) break
        }
        emit(this.pending.slice(index, end))
        index = end
        continue
      }
      if (character === '<' && !this.fence) {
        const tag = this.open ? '</think>' : '<think>'
        const remainder = this.pending.slice(index).toLowerCase()
        if (tag.startsWith(remainder) && remainder.length < tag.length && !final) break
        if (remainder.startsWith(tag)) {
          this.open = !this.open
          this.seen = true
          index += tag.length
          continue
        }
      }
      emit(character)
      index++
    }
    this.pending = this.pending.slice(index)
    return parts
  }
}

export function splitReasoning(content: string): {
  content: string
  reasoning: string
  open: boolean
} {
  const splitter = new ReasoningSplitter()
  const parts = splitter.feed(content, true)
  return {
    content: parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(''),
    reasoning: parts
      .filter((part) => part.type === 'reasoning')
      .map((part) => part.text)
      .join(''),
    open: splitter.open
  }
}
