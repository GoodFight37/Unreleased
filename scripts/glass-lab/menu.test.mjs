import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

test('Glass Lab stays in Tools, behind Developer mode, through the application event', () => {
  const menu = readFileSync('src/renderer/src/components/AppMenu.tsx', 'utf8')
  const tools = menu.slice(menu.indexOf("id: 'tools', label: 'Tools'"), menu.indexOf("id: 'help', label: 'Help'"))
  const devOnly = tools.slice(tools.indexOf('...(developerMode'))
  assert.match(devOnly, /\{ kind: 'item' as const, label: 'Glass Lab', onClick: openGlassLab \}/)
  assert.doesNotMatch(tools.slice(0, tools.indexOf('...(developerMode')), /label: 'Glass Lab'/)
  assert.match(menu, /window\.dispatchEvent\(new Event\('open-glass-lab'\)\)/)
  const app = readFileSync('src/renderer/src/App.tsx', 'utf8')
  assert.match(app, /addEventListener\('open-glass-lab', open\)/)
})
