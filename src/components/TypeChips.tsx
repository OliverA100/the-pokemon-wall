import { getTypeColor } from '@/lib/pokemon'

/**
 * A Pokemon's types as coloured chips — `<li>`s without the `<ul>`, because
 * the caption under the wall adds a rarity chip to the same list. Shared with
 * the expanded card so the tint cannot drift between the two.
 */
export function TypeChips({ types }: { types: string[] }) {
  return types.map(type => (
    <li
      className="rounded-full px-3 py-1 text-[10px] tracking-[0.16em] uppercase"
      key={type}
      style={{
        backgroundColor: `oklch(${getTypeColor(type)} / 0.16)`,
        color: `oklch(${getTypeColor(type)})`
      }}
    >
      {type}
    </li>
  ))
}
