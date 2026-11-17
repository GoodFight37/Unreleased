const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  IGNORE_MENU_SCROLL_ATTR,
  shouldIgnoreMenuScroll,
} = require('../src/renderer/src/lib/menuScroll.ts')

function makeEl({ attrs = {}, children = [], closestMatch = null, containsFn = null } = {}) {
  const node = {
    closest: (selector) => {
      if (selector === `[${IGNORE_MENU_SCROLL_ATTR}="true"]` && attrs[IGNORE_MENU_SCROLL_ATTR] === 'true') {
        return node
      }
      return closestMatch
    },
    contains: (other) => {
      if (other === node) return true
      if (containsFn) return containsFn(other)
      return children.includes(other)
    },
  }
  return node
}

test('ignores scroll events inside Now Playing synced lyrics for all menus and context menus', () => {
  const prevNode = global.Node
  const prevElement = global.Element
  class MockNode {}
  class MockElement extends MockNode {}
  global.Node = MockNode
  global.Element = MockElement
  try {
    const lyricsLine = new MockElement()
    const lyricsBox = Object.assign(new MockElement(), makeEl({
      attrs: { [IGNORE_MENU_SCROLL_ATTR]: 'true' },
      children: [lyricsLine],
    }))
    lyricsLine.closest = (sel) => (sel === `[${IGNORE_MENU_SCROLL_ATTR}="true"]` ? lyricsBox : null)
    lyricsLine.contains = (o) => o === lyricsLine

    const triggerBtn = Object.assign(new MockElement(), makeEl())
    const menuPanel = Object.assign(new MockElement(), makeEl())
    const mainList = Object.assign(new MockElement(), makeEl({ children: [triggerBtn] }))
    const unrelatedScroller = Object.assign(new MockElement(), makeEl())

    // Lyrics scroller auto-scrolling must NEVER close AppMenu / ThemedSelect / ContextMenu
    assert.equal(shouldIgnoreMenuScroll(lyricsBox, [menuPanel, triggerBtn], triggerBtn), true)
    assert.equal(shouldIgnoreMenuScroll(lyricsBox, [menuPanel]), true)
    assert.equal(shouldIgnoreMenuScroll(lyricsLine, [menuPanel]), true)

    // Scrolling an unrelated panel must NOT close an anchored menu/select whose trigger isn't inside it
    assert.equal(shouldIgnoreMenuScroll(unrelatedScroller, [menuPanel, triggerBtn], triggerBtn), true)

    // Scrolling inside the menu itself must NOT close it
    assert.equal(shouldIgnoreMenuScroll(menuPanel, [menuPanel, triggerBtn], triggerBtn), true)

    // Scrolling a regular list (not lyrics) SHOULD close an unanchored right-click ContextMenu
    assert.equal(shouldIgnoreMenuScroll(mainList, [menuPanel]), false)

    // Scrolling the container holding an anchored trigger SHOULD close its dropdown/menu
    assert.equal(shouldIgnoreMenuScroll(mainList, [menuPanel, triggerBtn], triggerBtn), false)
  } finally {
    global.Node = prevNode
    global.Element = prevElement
  }
})
