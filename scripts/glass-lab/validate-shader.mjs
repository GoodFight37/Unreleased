import { readFile } from 'node:fs/promises'

const SHADERS = [
  ['glass.wgsl', ['fs', 'fsBackground', 'fsCompositor']],
  ['blur.wgsl', ['horizontal', 'vertical']],
]

let webgpuMod = null
try {
  webgpuMod = await import('webgpu')
} catch {
  webgpuMod = null
}

if (webgpuMod) {
  const { create, globals } = webgpuMod
  Object.assign(globalThis, globals)
  const gpu = create(['backend=null']), adapter = await gpu.requestAdapter()
  if (!adapter) throw new Error('No Dawn null adapter')
  const device = await adapter.requestDevice()
  for (const [file, entries] of SHADERS) {
    const code = await readFile(new URL(`../../src/renderer/src/lib/glass/${file}`, import.meta.url), 'utf8')
    const module = device.createShaderModule({ code }), info = await module.getCompilationInfo()
    for (const m of info.messages) console.log(`${file}: ${m.type} ${m.lineNum}:${m.linePos} ${m.message}`)
    if (info.messages.some((m) => m.type === 'error')) throw new Error(`${file}: compilation failed`)
    for (const entryPoint of entries) {
      await device.createRenderPipelineAsync({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint, targets: [{ format: 'rgba8unorm' }] },
      })
    }
    console.log(`${file}: pipelines ${entries.join(', ')} valid (Dawn WebGPU)`)
  }
  device.destroy()
} else {
  for (const [file, entries] of SHADERS) {
    const code = await readFile(new URL(`../../src/renderer/src/lib/glass/${file}`, import.meta.url), 'utf8')
    let braces = 0, parens = 0
    for (const ch of code) {
      if (ch === '{') braces++
      else if (ch === '}') braces--
      else if (ch === '(') parens++
      else if (ch === ')') parens--
      if (braces < 0 || parens < 0) throw new Error(`${file}: unbalanced delimiters`)
    }
    if (braces !== 0 || parens !== 0) throw new Error(`${file}: unbalanced delimiters (braces=${braces}, parens=${parens})`)
    if (!/@vertex\s+fn\s+vs\b/.test(code)) throw new Error(`${file}: missing @vertex fn vs`)
    for (const entryPoint of entries) {
      const re = new RegExp(`@fragment\\s+fn\\s+${entryPoint}\\b`)
      if (!re.test(code)) throw new Error(`${file}: missing @fragment fn ${entryPoint}`)
    }
    console.log(`${file}: entrypoints vs, ${entries.join(', ')} verified`)
  }
}
