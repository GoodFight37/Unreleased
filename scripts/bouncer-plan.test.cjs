// Corner planning for the WRLD stage bouncer (src/renderer/src/lib/bouncerPlan.ts).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { computeField, planCorner, pickCue } = require('../src/renderer/src/lib/bouncerPlan.ts')

// Independent reference: the same bounce rules the stage uses, stepped at 1 ms.
function fly(w, h, px, py, dirX, dirY, vx, vy, T) {
  let x = px, y = py, dx = dirX, dy = dirY
  const hits = []
  for (let t = 0; t < T + 0.05; t += 0.001) {
    x += dx * vx * 0.001
    y += dy * vy * 0.001
    let hx = false, hy = false
    if (x <= 0) { x = 0; dx = 1; hx = true } else if (x >= w) { x = w; dx = -1; hx = true }
    if (y <= 0) { y = 0; dy = 1; hy = true } else if (y >= h) { y = h; dy = -1; hy = true }
    if (hx || hy) hits.push({ t, x, y })
  }
  return hits
}

test('the planned speeds put the cover in a corner at the asked moment', () => {
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 60; i++) {
    const w = 300 + rnd() * 900, h = 250 + rnd() * 500
    const px = rnd() * w, py = rnd() * h
    const dirX = rnd() < 0.5 ? 1 : -1, dirY = rnd() < 0.5 ? 1 : -1
    const T = 4 + rnd() * 25
    const plan = planCorner({ w, h, px, py, dirX, dirY, baseVx: 215, baseVy: 172, T, tol: 26, near: 130, edge: { l: true, r: true, t: true, b: true } })
    assert.ok(plan, 'a plan exists')
    const hits = fly(w, h, px, py, dirX, dirY, plan.vx, plan.vy, plan.T)
    const last = hits.filter((hit) => Math.abs(hit.t - plan.T) < 0.05).pop()
    assert.ok(last, `hit near T (case ${i})`)
    const cornerX = Math.min(last.x, w - last.x)
    const cornerY = Math.min(last.y, h - last.y)
    assert.ok(cornerX < 4 && cornerY < 4, `corner reached (case ${i}): ${cornerX.toFixed(1)}, ${cornerY.toFixed(1)}`)
    assert.ok(plan.vx / 215 >= 0.6 && plan.vx / 215 <= 1.7, 'speed stays near cruise')
    assert.ok(plan.vy / 172 >= 0.6 && plan.vy / 172 <= 1.7, 'speed stays near cruise')
  }
})

test('the planner never invents an early corner', () => {
  const plan = planCorner({ w: 500, h: 420, px: 100, py: 60, dirX: 1, dirY: 1, baseVx: 215, baseVy: 172, T: 12, tol: 26, near: 130, edge: { l: true, r: true, t: true, b: true } })
  const hits = fly(500, 420, 100, 60, 1, 1, plan.vx, plan.vy, plan.T)
  const early = hits.filter((hit) => hit.t < plan.T - 0.05 && Math.min(hit.x, 500 - hit.x) < 26 && Math.min(hit.y, 420 - hit.y) < 26)
  assert.equal(early.length, 0)
})

test('the play field is the biggest free box and tags the wall that rests on the lyrics', () => {
  const lyrics = { left: 512, top: 0, right: 1280, bottom: 720 }
  const f = computeField({ w: 1280, h: 720 }, undefined, [lyrics], 108)
  assert.equal(f.minX, 0)
  assert.equal(f.maxX, 512 - 108)
  assert.equal(f.tags.r, 0)
  assert.equal(f.tags.l, 'edge')
  // No room left for the cover: the obstacle is ignored.
  const tight = computeField({ w: 200, h: 720 }, undefined, [{ left: 50, top: 0, right: 200, bottom: 720 }], 108)
  assert.equal(tight.maxX, 200 - 108)
})

test('the safe margins shrink the field', () => {
  const f = computeField({ w: 600, h: 1000 }, { t: 0.1, r: 0.1, b: 0.2, l: 0.05 }, [], 100)
  assert.equal(f.minX, 30)
  assert.equal(f.minY, 100)
  assert.equal(f.maxX, 540 - 100)
  assert.equal(f.maxY, 800 - 100)
})

test('the cue is a line after a quiet gap, or the same line later', () => {
  const lines = [{ time: 10 }, { time: 13 }, { time: 16 }, { time: 25 }, { time: 28 }]
  assert.deepEqual(pickCue(lines, 4, 5, 1, null), { key: 10, inSec: 6 })
  assert.equal(pickCue(lines, 11, 5, 1, null).key, 25)
  assert.deepEqual(pickCue(lines, 20, 5, 1, 25), { key: 25, inSec: 5 })
  assert.equal(pickCue(lines, 30, 5, 1, 25), null)
  assert.equal(pickCue([], 0, 5, 1, null), null)
})
