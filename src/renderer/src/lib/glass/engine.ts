/// <reference types="@webgpu/types" />
import shader from './glass.wgsl?raw'
import blurShader from './blur.wgsl?raw'
import { getGlassPreset, type GlassPreset } from './presets'

export type GlassState = { light: boolean; source: 'ambient' | 'cover'; pointer: [number, number]; lens: [number, number, number]; merge: number; tint: [number, number, number]; tint2?: [number, number, number]; tint3?: [number, number, number]; rect: [number, number, number, number]; play: [number, number, number, number]; preset?: GlassPreset }
export type CompositorSurface = { cx: number; cy: number; hw: number; hh: number; radius: number; kind: number; layer: number; playFusion: number }
export type CompositorState = Omit<GlassState, 'rect'> & { surfaces: CompositorSurface[]; audio?: [number, number, number, number] }

const fallbackTint2 = (t: [number, number, number]): [number, number, number] => [t[1] * 0.55 + 0.32, t[2] * 0.45 + 0.14, t[0] * 0.65 + 0.28]
const fallbackTint3 = (t: [number, number, number]): [number, number, number] => [t[0] * 0.45 + 0.42 * 0.55, t[1] * 0.45 + 0.68 * 0.55, t[2] * 0.45 + 0.96 * 0.55]
export type Measurement = { frames: number; cpuP50: number; cpuP95: number; gpuP50: number | null; gpuP95: number | null; durationMs: number }
const percentile = (v: number[], q: number) => { const sorted = [...v].sort((a,b) => a-b); return sorted[Math.min(sorted.length-1, Math.floor(sorted.length*q))] ?? 0 }

async function initWebGPUCore(entryPoint: 'fs' | 'fsCompositor', targetFormat: GPUTextureFormat) {
  if (!navigator.gpu) throw new Error('WebGPU indisponible')
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) throw new Error('Aucune carte WebGPU disponible')
  const timed = adapter.features.has('timestamp-query')
  const device = await adapter.requestDevice({ requiredFeatures: timed ? ['timestamp-query'] : [] })
  const module = device.createShaderModule({ code: shader }), blurModule = device.createShaderModule({ code: blurShader })
  for (const m of [module, blurModule]) {
    const info = await m.getCompilationInfo(); const errors = info.messages.filter(x => x.type === 'error')
    if (errors.length) throw new Error(errors.map(x => `${x.lineNum}:${x.linePos} ${x.message}`).join('\n'))
  }
  const build = (m: GPUShaderModule, ep: string, target: GPUTextureFormat) =>
    device.createRenderPipelineAsync({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: ep, targets: [{ format: target }] }, primitive: { topology: 'triangle-list' } })
  const [pipeline, background, horizontal, vertical] = await Promise.all([
    build(module, entryPoint, targetFormat),
    build(module, 'fsBackground', 'rgba8unorm'),
    build(blurModule, 'horizontal', 'rgba8unorm'),
    build(blurModule, 'vertical', 'rgba8unorm'),
  ])
  const buffer = device.createBuffer({ size: 160, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const blurBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const surfacesBuffer = entryPoint === 'fsCompositor'
    ? device.createBuffer({ size: 32 * 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    : null
  const texture = device.createTexture({ size: [512, 512], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT })
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const backgroundGroup = device.createBindGroup({ layout: background.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: texture.createView() }, { binding: 2, resource: sampler }] })
  return { adapter, timed, device, pipeline, background, horizontal, vertical, buffer, blurBuffer, surfacesBuffer, texture, sampler, backgroundGroup }
}

async function initWebGPU(canvas: HTMLCanvasElement, alphaMode: GPUCanvasAlphaMode, entryPoint: 'fs' | 'fsCompositor') {
  const maybeContext = canvas.getContext('webgpu')
  if (!maybeContext) throw new Error('Canvas WebGPU indisponible')
  const context: GPUCanvasContext = maybeContext
  const format = navigator.gpu.getPreferredCanvasFormat()
  const core = await initWebGPUCore(entryPoint, format)
  context.configure({ device: core.device, format, alphaMode })
  return { ...core, context }
}

export async function createGlass(canvas: HTMLCanvasElement) {
  const g = await initWebGPU(canvas, 'opaque', 'fs')
  const query = g.timed ? g.device.createQuerySet({ type: 'timestamp', count: 2 }) : null
  const resolve = g.timed ? g.device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) : null
  const read = g.timed ? g.device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }) : null
  let busy = false, destroyed = false, dims = '', targets: GPUTexture[] = [], targetViews: GPUTextureView[] = [], bgW = 1, bgH = 1
  let bgHGroup: GPUBindGroup, bgVGroup: GPUBindGroup, composite: GPUBindGroup
  const uniformData = new Float32Array(40)
  const blurData = new Float32Array(4)

  function resize(w: number, h: number) {
    const next = `${w}:${h}`; if (next === dims) return; dims = next
    targets.forEach(t => t.destroy())
    bgW = Math.max(1, Math.ceil(w * 0.85))
    bgH = Math.max(1, Math.ceil(h * 0.85))
    targets = Array.from({ length: 3 }, () => g.device.createTexture({ size: [bgW, bgH], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }))
    targetViews = targets.map(t => t.createView())
    const blurGroup = (pipe: GPURenderPipeline, view: GPUTextureView) => g.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: view }, { binding: 1, resource: g.sampler }, { binding: 2, resource: { buffer: g.blurBuffer } }] })
    bgHGroup = blurGroup(g.horizontal, targetViews[0]); bgVGroup = blurGroup(g.vertical, targetViews[1])
    composite = g.device.createBindGroup({ layout: g.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: g.buffer } }, { binding: 1, resource: g.texture.createView() }, { binding: 2, resource: g.sampler }, { binding: 3, resource: targetViews[2] }] })
  }
  function upload(source: HTMLCanvasElement) { g.device.queue.copyExternalImageToTexture({ source }, { texture: g.texture }, [512, 512]) }

  async function draw(state: GlassState, measure = false): Promise<{ cpu: number; gpu: number | null }> {
    if (destroyed || busy) return { cpu: 0, gpu: null }; busy = true
    const start = performance.now()
    try {
      const ratio = Math.min(devicePixelRatio || 1, 1.5)
      const w = Math.max(1, Math.round(canvas.clientWidth * ratio)), h = Math.max(1, Math.round(canvas.clientHeight * ratio))
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
      resize(w, h); const preset = state.preset ?? getGlassPreset(state.light)
      const t2 = state.tint2 ?? fallbackTint2(state.tint)
      const t3 = state.tint3 ?? fallbackTint3(state.tint)
      uniformData[0] = w; uniformData[1] = h; uniformData[2] = state.pointer[0]; uniformData[3] = state.pointer[1]
      uniformData[4] = state.lens[0]; uniformData[5] = state.lens[1]; uniformData[6] = state.lens[2]; uniformData[7] = state.merge
      uniformData[8] = state.tint[0]; uniformData[9] = state.tint[1]; uniformData[10] = state.tint[2]; uniformData[11] = state.light ? 1 : 0
      uniformData[12] = state.source === 'cover' ? 1 : 0; uniformData[13] = 1 / bgW; uniformData[14] = 1 / bgH; uniformData[15] = 0
      uniformData[16] = state.rect[0]; uniformData[17] = state.rect[1]; uniformData[18] = state.rect[2]; uniformData[19] = state.rect[3]
      uniformData[20] = state.play[0]; uniformData[21] = state.play[1]; uniformData[22] = state.play[2]; uniformData[23] = state.play[3]
      uniformData[24] = preset.refractionStrength; uniformData[25] = preset.rimIntensity; uniformData[26] = preset.chromaticFringe; uniformData[27] = preset.tintOpacity
      uniformData[28] = preset.frost; uniformData[29] = (performance.now() / 1000) % 600; uniformData[30] = preset.caustic; uniformData[31] = preset.bevel
      uniformData[32] = t2[0]; uniformData[33] = t2[1]; uniformData[34] = t2[2]; uniformData[35] = 0
      uniformData[36] = t3[0]; uniformData[37] = t3[1]; uniformData[38] = t3[2]; uniformData[39] = 0
      g.device.queue.writeBuffer(g.buffer, 0, uniformData)
      blurData[0] = preset.blurRadius
      g.device.queue.writeBuffer(g.blurBuffer, 0, blurData)
      const encoder = g.device.createCommandEncoder()
      function pass(pipe: GPURenderPipeline, group: GPUBindGroup, view: GPUTextureView, timestampWrites?: GPURenderPassTimestampWrites) {
        const p = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }], ...(timestampWrites ? { timestampWrites } : {}) }); p.setPipeline(pipe); p.setBindGroup(0, group); p.draw(3); p.end()
      }
      pass(g.background, g.backgroundGroup, targetViews[0], measure && query ? { querySet: query, beginningOfPassWriteIndex: 0 } : undefined)
      pass(g.horizontal, bgHGroup, targetViews[1]); pass(g.vertical, bgVGroup, targetViews[2])
      pass(g.pipeline, composite, g.context.getCurrentTexture().createView(), measure && query ? { querySet: query, endOfPassWriteIndex: 1 } : undefined)
      if (measure && query && resolve && read) { encoder.resolveQuerySet(query, 0, 2, resolve, 0); encoder.copyBufferToBuffer(resolve, 0, read, 0, 16) }
      g.device.queue.submit([encoder.finish()]); const cpu = performance.now() - start
      let gpu: number | null = null
      if (measure && read) { await read.mapAsync(GPUMapMode.READ); const times = new BigUint64Array(read.getMappedRange()); gpu = Number(times[1] - times[0]) / 1e6; read.unmap() }
      return { cpu, gpu }
    } finally { busy = false }
  }

  async function measure(getState: () => GlassState): Promise<Measurement> {
    const cpus: number[] = [], gpus: number[] = [], start = performance.now()
    while (!destroyed && !document.hidden && performance.now() - start < 4000) {
      await new Promise<void>(resolve => { let done = false; const finish = () => { if (done) return; done = true; document.removeEventListener('visibilitychange', onVisibility); resolve() }; const onVisibility = () => { if (document.hidden) finish() }; document.addEventListener('visibilitychange', onVisibility); requestAnimationFrame(finish) })
      if (document.hidden || destroyed) break
      const result = await draw(getState(), true); if (result.cpu) cpus.push(result.cpu); if (result.gpu !== null) gpus.push(result.gpu)
    }
    return { frames: cpus.length, cpuP50: percentile(cpus, .5), cpuP95: percentile(cpus, .95), gpuP50: gpus.length ? percentile(gpus, .5) : null, gpuP95: gpus.length ? percentile(gpus, .95) : null, durationMs: performance.now() - start }
  }
  return { upload, draw, measure, timed: g.timed, adapterInfo: g.adapter.info, lost: g.device.lost, destroy: () => { destroyed = true; targets.forEach(t => t.destroy()); g.device.destroy() } }
}

/** Single-pass multi-surface WebGPU glass compositor (E1 + overlay layer). */
export async function createGlassCompositor(canvas: HTMLCanvasElement, overlayCanvas?: HTMLCanvasElement | null) {
  const g = await initWebGPU(canvas, 'premultiplied', 'fsCompositor')
  const format = navigator.gpu.getPreferredCanvasFormat()
  const overlayContext = overlayCanvas ? overlayCanvas.getContext('webgpu') : null
  if (overlayContext) overlayContext.configure({ device: g.device, format, alphaMode: 'premultiplied' })
  const overlayBuffer = overlayContext ? g.device.createBuffer({ size: 160, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }) : null
  let busy = false, destroyed = false, dims = '', targets: GPUTexture[] = [], targetViews: GPUTextureView[] = [], bgW = 1, bgH = 1
  let bgHGroup: GPUBindGroup, bgVGroup: GPUBindGroup, composite: GPUBindGroup, overlayComposite: GPUBindGroup | null = null
  const surfaceData = new Float32Array(32 * 8)
  const uniformData = new Float32Array(40)
  const blurData = new Float32Array(4)
  let overlayCleared = true
  let inFlight = 0

  function resize(w: number, h: number) {
    const next = `${w}:${h}`; if (next === dims) return; dims = next
    targets.forEach(t => t.destroy())
    bgW = Math.max(1, Math.ceil(w * 0.85))
    bgH = Math.max(1, Math.ceil(h * 0.85))
    targets = Array.from({ length: 3 }, () => g.device.createTexture({ size: [bgW, bgH], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }))
    targetViews = targets.map(t => t.createView())
    const blurGroup = (pipe: GPURenderPipeline, view: GPUTextureView) => g.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: view }, { binding: 1, resource: g.sampler }, { binding: 2, resource: { buffer: g.blurBuffer } }] })
    bgHGroup = blurGroup(g.horizontal, targetViews[0]); bgVGroup = blurGroup(g.vertical, targetViews[1])
    composite = g.device.createBindGroup({
      layout: g.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: g.buffer } },
        { binding: 1, resource: g.texture.createView() },
        { binding: 2, resource: g.sampler },
        { binding: 3, resource: targetViews[2] },
        { binding: 4, resource: { buffer: g.surfacesBuffer! } },
      ],
    })
    if (overlayBuffer) {
      overlayComposite = g.device.createBindGroup({
        layout: g.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: overlayBuffer } },
          { binding: 1, resource: g.texture.createView() },
          { binding: 2, resource: g.sampler },
          { binding: 3, resource: targetViews[2] },
          { binding: 4, resource: { buffer: g.surfacesBuffer! } },
        ],
      })
    }
    overlayCleared = false
  }

  function upload(source: HTMLCanvasElement) { g.device.queue.copyExternalImageToTexture({ source }, { texture: g.texture }, [512, 512]) }

  async function draw(state: CompositorState) {
    if (destroyed || busy || inFlight >= 3) return; busy = true
    try {
      const ratio = Math.min(devicePixelRatio || 1, 1.5)
      const w = Math.max(1, Math.round(canvas.clientWidth * ratio)), h = Math.max(1, Math.round(canvas.clientHeight * ratio))
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
      if (overlayCanvas && (overlayCanvas.width !== w || overlayCanvas.height !== h)) {
        overlayCanvas.width = w
        overlayCanvas.height = h
      }
      resize(w, h)
      const count = Math.min(32, state.surfaces.length)
      const preset = state.preset ?? getGlassPreset(state.light)
      const nowSec = (performance.now() / 1000) % 600
      const audio = state.audio ?? [0, 0, 0, 0]
      const t2 = state.tint2 ?? fallbackTint2(state.tint)
      const t3 = state.tint3 ?? fallbackTint3(state.tint)
      uniformData[0] = w; uniformData[1] = h; uniformData[2] = state.pointer[0]; uniformData[3] = state.pointer[1]
      uniformData[4] = state.lens[0]; uniformData[5] = state.lens[1]; uniformData[6] = state.lens[2]; uniformData[7] = state.merge
      uniformData[8] = state.tint[0]; uniformData[9] = state.tint[1]; uniformData[10] = state.tint[2]; uniformData[11] = state.light ? 1 : 0
      uniformData[12] = state.source === 'cover' ? 1 : 0; uniformData[13] = 1 / bgW; uniformData[14] = 1 / bgH; uniformData[15] = count
      uniformData[16] = 0; uniformData[17] = audio[0]; uniformData[18] = audio[1]; uniformData[19] = audio[3]
      uniformData[20] = state.play[0]; uniformData[21] = state.play[1]; uniformData[22] = state.play[2]; uniformData[23] = state.play[3]
      uniformData[24] = preset.refractionStrength; uniformData[25] = preset.rimIntensity; uniformData[26] = preset.chromaticFringe; uniformData[27] = preset.tintOpacity
      uniformData[28] = preset.frost; uniformData[29] = nowSec; uniformData[30] = preset.caustic; uniformData[31] = preset.bevel
      uniformData[32] = t2[0]; uniformData[33] = t2[1]; uniformData[34] = t2[2]; uniformData[35] = 0
      uniformData[36] = t3[0]; uniformData[37] = t3[1]; uniformData[38] = t3[2]; uniformData[39] = 0
      g.device.queue.writeBuffer(g.buffer, 0, uniformData)
      let hasOverlay = false
      surfaceData.fill(0)
      for (let i = 0; i < count; i++) {
        const s = state.surfaces[i], o = i * 8
        if (s.layer >= 1.5 && s.kind !== 6) hasOverlay = true
        surfaceData[o] = s.cx * ratio
        surfaceData[o + 1] = s.cy * ratio
        surfaceData[o + 2] = s.hw * ratio
        surfaceData[o + 3] = s.kind === 6 ? s.hh : s.hh * ratio
        surfaceData[o + 4] = s.radius * ratio
        surfaceData[o + 5] = s.kind
        surfaceData[o + 6] = s.layer
        surfaceData[o + 7] = s.playFusion
      }
      blurData[0] = preset.blurRadius
      g.device.queue.writeBuffer(g.blurBuffer, 0, blurData)
      g.device.queue.writeBuffer(g.surfacesBuffer!, 0, surfaceData)
      if (overlayBuffer && hasOverlay) {
        uniformData[16] = 1
        g.device.queue.writeBuffer(overlayBuffer, 0, uniformData)
      }
      const encoder = g.device.createCommandEncoder()
      const pass = (pipe: GPURenderPipeline, group: GPUBindGroup, view: GPUTextureView, clearA: number) => {
        const p = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: clearA } }] })
        p.setPipeline(pipe); p.setBindGroup(0, group); p.draw(3); p.end()
      }
      if (count > 0) {
        pass(g.background, g.backgroundGroup, targetViews[0], 1)
        pass(g.horizontal, bgHGroup, targetViews[1], 1)
        pass(g.vertical, bgVGroup, targetViews[2], 1)
      }
      pass(g.pipeline, composite, g.context.getCurrentTexture().createView(), 0)
      if (overlayContext && overlayComposite) {
        if (hasOverlay) {
          overlayCleared = false
          pass(g.pipeline, overlayComposite, overlayContext.getCurrentTexture().createView(), 0)
        } else if (!overlayCleared) {
          overlayCleared = true
          const p = encoder.beginRenderPass({ colorAttachments: [{ view: overlayContext.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] })
          p.end()
        }
      }
      inFlight++
      g.device.queue.submit([encoder.finish()])
      void g.device.queue.onSubmittedWorkDone().then(
        () => { if (inFlight > 0) inFlight-- },
        () => { if (inFlight > 0) inFlight-- },
      )
    } finally { busy = false }
  }

  return { upload, draw, lost: g.device.lost, destroy: () => { destroyed = true; targets.forEach(t => t.destroy()); g.device.destroy() } }
}

/** Deterministic offscreen WebGPU glass renderer (time-driven, zero wall-clock dependency)
 *  used by Share Studio for PNG and frame-accurate MP4 export. */
export async function createOffscreenGlassRenderer() {
  const g = await initWebGPUCore('fsCompositor', 'rgba8unorm')
  let destroyed = false
  let dims = ''
  let targets: GPUTexture[] = []
  let outTexture: GPUTexture | null = null
  let readBuffer: GPUBuffer | null = null
  let bgW = 1, bgH = 1, bytesPerRow = 256
  let bgHGroup: GPUBindGroup, bgVGroup: GPUBindGroup, composite: GPUBindGroup
  const surfaceData = new Float32Array(32 * 8)

  function resize(w: number, h: number) {
    const next = `${w}:${h}`
    if (next === dims) return
    dims = next
    bytesPerRow = Math.ceil((w * 4) / 256) * 256
    targets.forEach(t => t.destroy())
    outTexture?.destroy()
    readBuffer?.destroy()
    bgW = Math.max(1, Math.ceil(w * 0.75))
    bgH = Math.max(1, Math.ceil(h * 0.75))
    targets = Array.from({ length: 3 }, () =>
      g.device.createTexture({ size: [bgW, bgH], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }))
    outTexture = g.device.createTexture({
      size: [w, h],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })
    readBuffer = g.device.createBuffer({
      size: bytesPerRow * h,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
    const blurGroup = (pipe: GPURenderPipeline, tex: GPUTexture) =>
      g.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: tex.createView() }, { binding: 1, resource: g.sampler }, { binding: 2, resource: { buffer: g.blurBuffer } }] })
    bgHGroup = blurGroup(g.horizontal, targets[0])
    bgVGroup = blurGroup(g.vertical, targets[1])
    composite = g.device.createBindGroup({
      layout: g.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: g.buffer } },
        { binding: 1, resource: g.texture.createView() },
        { binding: 2, resource: g.sampler },
        { binding: 3, resource: targets[2].createView() },
        { binding: 4, resource: { buffer: g.surfacesBuffer! } },
      ],
    })
  }

  function upload(source: HTMLCanvasElement) {
    g.device.queue.copyExternalImageToTexture({ source }, { texture: g.texture }, [512, 512])
  }

  async function render(state: CompositorState & { width: number; height: number; timeSec: number }): Promise<Uint8ClampedArray<ArrayBuffer>> {
    if (destroyed) throw new Error('Offscreen glass renderer destroyed')
    const w = Math.max(1, Math.round(state.width))
    const h = Math.max(1, Math.round(state.height))
    resize(w, h)
    const count = Math.min(32, state.surfaces.length)
    const preset = state.preset ?? getGlassPreset(state.light)
    const tSec = ((state.timeSec % 600) + 600) % 600
    const t2 = state.tint2 ?? fallbackTint2(state.tint)
    const t3 = state.tint3 ?? fallbackTint3(state.tint)
    const uniforms = new Float32Array([
      w, h, ...state.pointer, ...state.lens, state.merge, ...state.tint, state.light ? 1 : 0,
      state.source === 'cover' ? 1 : 0, 1 / bgW, 1 / bgH, count,
      0, 0, 0, 0, ...state.play,
      preset.refractionStrength, preset.rimIntensity, preset.chromaticFringe, preset.tintOpacity,
      preset.frost, tSec, preset.caustic, preset.bevel,
      ...t2, 0, ...t3, 0,
    ])
    g.device.queue.writeBuffer(g.buffer, 0, uniforms)
    surfaceData.fill(0)
    for (let i = 0; i < count; i++) {
      const s = state.surfaces[i], o = i * 8
      surfaceData[o] = s.cx
      surfaceData[o + 1] = s.cy
      surfaceData[o + 2] = s.hw
      surfaceData[o + 3] = s.hh
      surfaceData[o + 4] = s.radius
      surfaceData[o + 5] = s.kind
      surfaceData[o + 6] = s.layer
      surfaceData[o + 7] = s.playFusion
    }
    g.device.queue.writeBuffer(g.blurBuffer, 0, new Float32Array([preset.blurRadius, 0, 0, 0]))
    g.device.queue.writeBuffer(g.surfacesBuffer!, 0, surfaceData)

    const encoder = g.device.createCommandEncoder()
    const pass = (pipe: GPURenderPipeline, group: GPUBindGroup, view: GPUTextureView, clearA: number) => {
      const p = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: clearA } }] })
      p.setPipeline(pipe); p.setBindGroup(0, group); p.draw(3); p.end()
    }
    pass(g.background, g.backgroundGroup, targets[0].createView(), 1)
    pass(g.horizontal, bgHGroup, targets[1].createView(), 1)
    pass(g.vertical, bgVGroup, targets[2].createView(), 1)
    pass(g.pipeline, composite, outTexture!.createView(), 0)
    encoder.copyTextureToBuffer(
      { texture: outTexture! },
      { buffer: readBuffer!, bytesPerRow, rowsPerImage: h },
      { width: w, height: h },
    )
    g.device.queue.submit([encoder.finish()])
    await readBuffer!.mapAsync(GPUMapMode.READ)
    const mapped = new Uint8Array(readBuffer!.getMappedRange())
    const out = new Uint8ClampedArray(new ArrayBuffer(w * h * 4))
    // Convert premultiplied RGBA from fsCompositor into straight RGBA for 2D ImageData compositing.
    for (let y = 0; y < h; y++) {
      const rowOff = y * bytesPerRow
      let dstOff = y * w * 4
      for (let x = 0; x < w; x++) {
        const srcOff = rowOff + x * 4
        const a = mapped[srcOff + 3]
        if (a === 0) {
          dstOff += 4
          continue
        }
        if (a === 255) {
          out[dstOff] = mapped[srcOff]
          out[dstOff + 1] = mapped[srcOff + 1]
          out[dstOff + 2] = mapped[srcOff + 2]
          out[dstOff + 3] = 255
        } else {
          const inv = 255 / a
          out[dstOff] = Math.min(255, Math.round(mapped[srcOff] * inv))
          out[dstOff + 1] = Math.min(255, Math.round(mapped[srcOff + 1] * inv))
          out[dstOff + 2] = Math.min(255, Math.round(mapped[srcOff + 2] * inv))
          out[dstOff + 3] = a
        }
        dstOff += 4
      }
    }
    readBuffer!.unmap()
    return out
  }

  return {
    upload,
    render,
    destroy: () => {
      destroyed = true
      targets.forEach(t => t.destroy())
      outTexture?.destroy()
      readBuffer?.destroy()
      g.device.destroy()
    },
  }
}
