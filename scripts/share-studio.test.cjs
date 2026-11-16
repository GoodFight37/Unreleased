const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

test('Share Studio defines 9:16 and 16:9 HD formats and keeps rendering time-driven (deterministic)', () => {
  const studioSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'lib', 'shareStudio.ts'), 'utf8')
  assert.match(studioSrc, /key:\s*'story'[\s\S]*?exportW:\s*1080,\s*exportH:\s*1920/)
  assert.match(studioSrc, /key:\s*'landscape'[\s\S]*?exportW:\s*1920,\s*exportH:\s*1080/)
  assert.doesNotMatch(studioSrc, /performance\.now\(|Date\.now\(/, 'shareStudio renderer must stay strictly deterministic (timeSec-driven)')

  const modalSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'components', 'ShareLyricsModal.tsx'), 'utf8')
  assert.match(modalSrc, /const t = frame \/ fps/, 'MP4 frame export must advance deterministically by frame / fps')
  assert.match(modalSrc, /shareVideoStart/)
  assert.match(modalSrc, /shareVideoFrame/)
  assert.match(modalSrc, /shareVideoFinish/)
})
