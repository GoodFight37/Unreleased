/** Marks self-scrolling side feeds (like synced lyrics) so their updates never dismiss open menus. */
export const IGNORE_MENU_SCROLL_ATTR = 'data-ignore-menu-scroll'

/**
 * Decides whether a capture-phase `scroll` event on `window` should leave an open
 * menu, context menu, select dropdown, or popover open.
 */
export function shouldIgnoreMenuScroll(
  target: EventTarget | null,
  ownNodes: readonly (Node | null | undefined)[] = [],
  anchor?: Node | null,
): boolean {
  if (target instanceof Node) {
    for (const node of ownNodes) {
      if (node && node.contains(target)) return true
    }
  }
  if (target instanceof Element) {
    if (target.closest(`[${IGNORE_MENU_SCROLL_ATTR}="true"]`)) return true
    if (anchor && !target.contains(anchor)) return true
  }
  return false
}
