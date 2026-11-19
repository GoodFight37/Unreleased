import { emojiGlyph } from './emoji'

// Renders a reaction/picker entry using native OS color emoji glyphs.
export default function EmojiImg({ name, className }: { name: string; className?: string }): JSX.Element {
  return (
    <span
      role="img"
      aria-label={`:${name}:`}
      title={`:${name}:`}
      className={`inline-flex items-center justify-center leading-none select-none ${className ?? ''}`}
    >
      {emojiGlyph(name)}
    </span>
  )
}
