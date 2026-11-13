/** Brand-aligned categorical palette shared by every category chart. */
export const CATEGORY_PALETTE: readonly string[] = [
  '#136B4C', '#27AE60', '#FF6B6B', '#FFC857',
  '#2A9D8F', '#E9C46A', '#F4A261', '#264653',
  '#6B8C7A', '#A8C4B4', '#E76F51', '#023047',
]

export function paletteColor(index: number): string {
  return CATEGORY_PALETTE[index % CATEGORY_PALETTE.length] ?? '#136B4C'
}
