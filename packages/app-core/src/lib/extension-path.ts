const NAME = '[a-z0-9]+(?:-[a-z0-9]+)*'
const PATH = new RegExp(`^ext:(${NAME})/(${NAME})$`)
export function parseExtensionTab(
  path: string | null
): { name: string; view: string } | null {
  const match = path?.match(PATH)
  return match && match[1].length <= 64 && match[2].length <= 64
    ? { name: match[1], view: match[2] }
    : null
}
export function isExtensionTabPath(path: string | null): boolean {
  return parseExtensionTab(path) !== null
}
