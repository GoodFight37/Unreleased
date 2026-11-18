import { useEffect, useRef, useState } from 'react'
import { listenToMeter } from '../desktop/meter'
import { extractCoverPalette, fetchCoverBitmap } from '../lib/adaptivePalette'
import { ERA_PALETTES } from '../lib/eraPalettes'
import { smallCoverUrl } from '../lib/juicewrldApi'
import { paletteFromAccent, parseColor } from '../lib/viz/palette'
import { resolveEraAtmosphere, type EraAtmosphereProfile } from '../lib/wrldAtmospheres'
import type { RGB } from '../lib/viz/types'

interface Props {
  artUrl: string | null
  eraAsset: string | null
  atmosphere?: EraAtmosphereProfile
  isDark: boolean
  playing: boolean
  animated: boolean
  audioReactive?: boolean
}

const GRID = 64
const PREP_SIZE = 128
const MORPH_MS = 1100
const MAX_SIDE_PX = 768

const QUAD_VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

const TONE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_tex;

vec3 amllToneMap(vec3 rgb) {
  float luma = dot(rgb, vec3(0.30, 0.59, 0.11));
  float tone = luma * 0.72 + 0.14;
  vec3 delta = rgb - luma;
  float gain = 1.9;
  if (delta.r > 1e-5) gain = min(gain, (1.0 - tone) / delta.r);
  else if (delta.r < -1e-5) gain = min(gain, -tone / delta.r);
  if (delta.g > 1e-5) gain = min(gain, (1.0 - tone) / delta.g);
  else if (delta.g < -1e-5) gain = min(gain, -tone / delta.g);
  if (delta.b > 1e-5) gain = min(gain, (1.0 - tone) / delta.b);
  else if (delta.b < -1e-5) gain = min(gain, -tone / delta.b);
  gain = max(0.0, gain);
  return clamp(tone + delta * gain, 0.0, 1.0);
}

void main() {
  vec3 raw = texture(u_tex, v_uv).rgb;
  fragColor = vec4(amllToneMap(raw), 1.0);
}
`

const KAWASE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_offset;

void main() {
  vec2 d = u_texel * u_offset;
  vec3 s = texture(u_tex, v_uv).rgb * 4.0;
  s += texture(u_tex, v_uv + vec2(-d.x, -d.y)).rgb;
  s += texture(u_tex, v_uv + vec2( d.x, -d.y)).rgb;
  s += texture(u_tex, v_uv + vec2(-d.x,  d.y)).rgb;
  s += texture(u_tex, v_uv + vec2( d.x,  d.y)).rgb;
  fragColor = vec4(s * 0.125, 1.0);
}
`

const MESH_VERT = `#version 300 es
in vec2 a_grid;
out vec2 v_uv;
out vec2 v_uvAlt;
out vec2 v_screen;
uniform vec2 u_ctrlPos[16];
uniform vec2 u_ctrlUv[16];
uniform vec2 u_ctrlUvAlt[16];

vec4 cubicBasis(float t) {
  float u = 1.0 - t;
  return vec4(u * u * u, 3.0 * t * u * u, 3.0 * t * t * u, t * t * t);
}

void main() {
  vec4 bx = cubicBasis(a_grid.x);
  vec4 by = cubicBasis(a_grid.y);
  vec2 pos = vec2(0.0);
  vec2 uv = vec2(0.0);
  vec2 uvAlt = vec2(0.0);
  for (int j = 0; j < 4; j++) {
    float wy = by[j];
    for (int i = 0; i < 4; i++) {
      float w = bx[i] * wy;
      int idx = j * 4 + i;
      pos += u_ctrlPos[idx] * w;
      uv += u_ctrlUv[idx] * w;
      uvAlt += u_ctrlUvAlt[idx] * w;
    }
  }
  v_uv = uv;
  v_uvAlt = uvAlt;
  v_screen = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}
`

const MESH_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_uvAlt;
in vec2 v_screen;
out vec4 fragColor;

uniform sampler2D u_prevTex;
uniform sampler2D u_currTex;
uniform float u_hasPrev;
uniform float u_hasCurr;
uniform float u_morph;
uniform float u_dark;
uniform float u_energy;
uniform float u_energyPush;
uniform float u_grain;
uniform float u_warmth;
uniform float u_entry;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;

vec3 paletteField(vec2 uv) {
  vec3 top = mix(u_c0, u_c1, smoothstep(0.05, 0.95, uv.x));
  vec3 bot = mix(u_c2, u_c3, smoothstep(0.05, 0.95, uv.x));
  return mix(bot, top, smoothstep(0.05, 0.95, uv.y));
}

void main() {
  vec3 prevCol = u_hasPrev > 0.5 ? texture(u_prevTex, v_uvAlt).rgb : paletteField(v_uvAlt);
  vec3 currCol = u_hasCurr > 0.5 ? texture(u_currTex, v_uv).rgb : paletteField(v_uv);
  vec3 col = mix(prevCol, currCol, u_morph);

  // Smooth stage entry: bloom outward from the cover's dominant tone
  if (u_entry < 0.999) {
    float r = length(v_screen - 0.5);
    float mask = smoothstep(0.0, 0.85, u_entry * 1.35 - r * 0.45);
    col = mix(u_c0 * (u_dark > 0.5 ? 0.42 : 0.88), col, mask);
  }

  // Era temperature tint
  col.r = clamp(col.r + u_warmth * 0.06, 0.0, 1.0);
  col.b = clamp(col.b - u_warmth * 0.05, 0.0, 1.0);

  // Preserve AMLL hue/chroma fidelity: upper field blooms with vibrant cover hues,
  // while the lower text/controls third naturally settles toward darker saturated troughs
  // so white typography holds >= 4.5:1 contrast without a flat black overlay.
  float audioLift = u_energy * u_energyPush;
  if (u_dark > 0.5) {
    float edge = smoothstep(0.45, 1.15, length((v_screen - 0.5) * vec2(0.82, 1.0)));
    float lowerZone = 1.0 - smoothstep(0.05, 0.72, v_screen.y);
    float textCradle = mix(1.0, 0.64, lowerZone) * (1.0 - edge * 0.20);
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    vec3 vivid = mix(vec3(luma), col, 1.12 + audioLift * 0.45);
    col = clamp(vivid * textCradle * (1.0 + audioLift * 0.16), vec3(0.03), vec3(0.95));
  } else {
    col = mix(vec3(0.92, 0.91, 0.94), col, clamp(0.68 + audioLift * 0.12, 0.60, 0.86));
  }

  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  col = clamp(col + (ign - 0.5) * (1.0 / 255.0 + u_grain), 0.0, 1.0);
  fragColor = vec4(col, 1.0);
}
`

function toVec3(c: RGB): [number, number, number] {
  return [c.r / 255, c.g / 255, c.b / 255]
}

function accentPalette(): [number, number, number][] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  return paletteFromAccent(parseColor(raw || '#e0592f')).map(toVec3)
}

function hashSeed(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type)
  if (!s) return null
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    gl.deleteShader(s)
    return null
  }
  return s
}

function linkProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc)
  const prog = vs && fs ? gl.createProgram() : null
  if (!vs || !fs || !prog) {
    if (vs) gl.deleteShader(vs)
    if (fs) gl.deleteShader(fs)
    return null
  }
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog)
    return null
  }
  return prog
}

function createTargetTex(gl: WebGL2RenderingContext, size: number): WebGLTexture | null {
  const t = gl.createTexture()
  if (!t) return null
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  return t
}

const CORNER_PAIRS: readonly [number, number][] = [
  [0, 15],
  [3, 12],
  [0, 3],
  [12, 15],
]

function fillControlPoints(
  outPos: Float32Array,
  outUv: Float32Array,
  phase: number,
  seed: number,
  beatEnv: number,
  cornerPairIdx: number,
  uvShift: number,
  calmness: number,
  energyPush: number,
): void {
  const angle = phase * 0.42 + seed * Math.PI * 2
  const driftScale = 1 - calmness * 0.45
  const beatPush = beatEnv * energyPush
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const idx = j * 4 + i
      const o = idx * 2
      const bx = (i / 3) * 2.36 - 1.18
      const by = (j / 3) * 2.36 - 1.18
      const isInner = i > 0 && i < 3 && j > 0 && j < 3
      const isCorner = (i === 0 || i === 3) && (j === 0 || j === 3)

      let px = bx
      let py = by
      if (isInner) {
        const p = phase * 0.58 + seed * 6.28 + idx * 1.17
        px += (Math.cos(p) * 0.34 + Math.sin(p * 0.63 + j) * 0.14) * driftScale
        py += (Math.sin(p * 0.87) * 0.34 + Math.cos(p * 0.71 + i) * 0.14) * driftScale
        // Single musical gesture tied to u_energy: inner wave breathes outward on beat
        px += (i === 1 ? -1 : 1) * beatPush * 0.24
        py += (j === 1 ? -1 : 1) * beatPush * 0.24
      } else if (!isCorner) {
        const p = phase * 0.35 + seed * 4.1 + idx * 0.9
        px += Math.sin(p) * 0.14 * driftScale
        py += Math.cos(p * 0.9) * 0.14 * driftScale
      }

      outPos[o] = px
      outPos[o + 1] = py

      // Off-center bounded UV sampling over MIRRORED_REPEAT cover texture
      const uBase = (i / 3) * 0.82 + 0.09
      const vBase = (j / 3) * 0.82 + 0.09
      const swirlA = angle + i * 0.85 + j * 1.15 + uvShift
      const amp = (isInner ? 0.14 : 0.09) * driftScale + beatPush * 0.05
      outUv[o] = uBase + Math.cos(swirlA) * amp
      outUv[o + 1] = vBase + Math.sin(swirlA * 0.83) * amp
    }
  }
}

function CssFallbackMesh({ colors, isDark, animated }: { colors: [number, number, number][]; isDark: boolean; animated: boolean }): JSX.Element {
  const c = (idx: number, a: number): string => {
    const [r, g, b] = colors[idx % colors.length]
    return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`
  }
  return (
    <div
      className={`absolute inset-0 pointer-events-none ${animated ? 'app-ambient-glow' : ''}`}
      style={{
        backgroundColor: isDark ? '#08070c' : '#f4f3f7',
        backgroundImage: `
          radial-gradient(64% 60% at 80% 18%, ${c(0, isDark ? 0.68 : 0.42)}, transparent 68%),
          radial-gradient(62% 58% at 18% 82%, ${c(1, isDark ? 0.62 : 0.38)}, transparent 70%),
          radial-gradient(54% 54% at 22% 24%, ${c(2, isDark ? 0.48 : 0.30)}, transparent 70%),
          radial-gradient(58% 54% at 78% 78%, ${c(3, isDark ? 0.52 : 0.32)}, transparent 72%)
        `,
      }}
      aria-hidden="true"
    />
  )
}

/**
 * Apple Music / AMLL-inspired Liquid Mesh backdrop in WebGL2:
 * 1) Fetches remote artwork via fetchImageBlob (CORS-safe),
 * 2) Pre-processes on GPU with AMLL hue-preserving tone map + Dual Kawase pyramid (128->64->32->64->128),
 * 3) Renders a 64×64 bicubic tensor-product mesh across 16 morphing control points,
 *    with 2-corner kick expansion from the shared audio meter and 1.1s track cross-morph.
 * Demand-driven: pauses rAF automatically when hidden, in Game mode, or after settling on pause.
 */
function LndButterflies({ isDark }: { isDark: boolean }): JSX.Element {
  const b0 = useRef<SVGSVGElement>(null)
  const b1 = useRef<SVGSVGElement>(null)
  const b2 = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const specs: Array<[React.RefObject<SVGSVGElement | null>, Keyframe[], number, number]> = [
      [b0, [
        { transform: 'translate3d(0px, 0px, 0) rotate(-6deg) scale(1)', opacity: 0.18 },
        { transform: 'translate3d(38px, -28px, 0) rotate(5deg) scale(1.06)', opacity: 0.34 },
        { transform: 'translate3d(-16px, -46px, 0) rotate(-4deg) scale(0.96)', opacity: 0.22 },
        { transform: 'translate3d(0px, 0px, 0) rotate(-6deg) scale(1)', opacity: 0.18 },
      ], 26000, 0],
      [b1, [
        { transform: 'translate3d(0px, 0px, 0) rotate(8deg) scale(0.92)', opacity: 0.14 },
        { transform: 'translate3d(-44px, -22px, 0) rotate(-5deg) scale(1)', opacity: 0.28 },
        { transform: 'translate3d(20px, -40px, 0) rotate(6deg) scale(0.95)', opacity: 0.2 },
        { transform: 'translate3d(0px, 0px, 0) rotate(8deg) scale(0.92)', opacity: 0.14 },
      ], 31000, -9000],
      [b2, [
        { transform: 'translate3d(0px, 0px, 0) rotate(-4deg) scale(0.88)', opacity: 0.12 },
        { transform: 'translate3d(26px, 24px, 0) rotate(7deg) scale(0.96)', opacity: 0.24 },
        { transform: 'translate3d(-22px, 10px, 0) rotate(-7deg) scale(0.9)', opacity: 0.16 },
        { transform: 'translate3d(0px, 0px, 0) rotate(-4deg) scale(0.88)', opacity: 0.12 },
      ], 35000, -17000],
    ]
    const anims = specs
      .map(([ref, frames, duration, delay]) =>
        ref.current?.animate(frames, { duration, delay, iterations: Infinity, easing: 'ease-in-out' }))
      .filter((a): a is Animation => Boolean(a))
    return () => { anims.forEach((a) => a.cancel()) }
  }, [])

  const fill = isDark ? 'rgba(134, 212, 255, 0.72)' : 'rgba(65, 130, 215, 0.56)'
  const wing = (
    <path d="M12 12 C9 5, 2 4, 3 10 C3 13, 8 14, 11 13 C7 15, 4 19, 7 21 C10 22, 11 17, 12 14 C13 17, 14 22, 17 21 C20 19, 17 15, 13 13 C16 14, 21 13, 21 10 C22 4, 15 5, 12 12 Z" />
  )
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <svg ref={b0} viewBox="0 0 24 24" className="absolute w-7 h-7" style={{ left: '16%', top: '24%', fill }}>{wing}</svg>
      <svg ref={b1} viewBox="0 0 24 24" className="absolute w-5 h-5" style={{ right: '18%', top: '34%', fill }}>{wing}</svg>
      <svg ref={b2} viewBox="0 0 24 24" className="absolute w-6 h-6" style={{ left: '72%', bottom: '24%', fill }}>{wing}</svg>
    </div>
  )
}

export default function LiquidMeshBackdrop({
  artUrl,
  eraAsset,
  atmosphere,
  isDark,
  playing,
  animated,
  audioReactive = true,
}: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const kickLoopRef = useRef<(() => void) | null>(null)
  const [webglFailed, setWebglFailed] = useState(false)
  const [fallbackPalette, setFallbackPalette] = useState<[number, number, number][]>(() => accentPalette())
  const resolvedAtm = atmosphere ?? resolveEraAtmosphere(null, eraAsset)

  const stateRef = useRef({
    isDark,
    playing,
    animated,
    atmosphere: resolvedAtm,
    target: accentPalette(),
    current: accentPalette(),
    pendingBitmap: null as ImageBitmap | null,
    bitmapDirty: false,
    seed: 0.25,
    prevSeed: 0.25,
    morph: 1,
    entryStartMs: performance.now(),
    lastTrackChangeMs: performance.now(),
    motionSpeed: playing ? 1 : 0,
  })

  stateRef.current.isDark = isDark
  stateRef.current.playing = playing
  stateRef.current.animated = animated
  stateRef.current.atmosphere = resolvedAtm

  // Load cover bitmap via CORS-safe fetchImageBlob + extract palette fallback
  useEffect(() => {
    let cancelled = false
    const st = stateRef.current
    st.prevSeed = st.seed
    st.seed = hashSeed(artUrl ?? eraAsset ?? 'default')

    const baked = eraAsset ? ERA_PALETTES[eraAsset] : null
    if (baked?.length) {
      const next = [0, 1, 2, 3].map((i) => toVec3(baked[i % baked.length]))
      st.target = next
      setFallbackPalette(next)
    } else {
      const next = accentPalette()
      st.target = next
      setFallbackPalette(next)
    }

    if (!artUrl) {
      st.pendingBitmap?.close()
      st.pendingBitmap = null
      st.bitmapDirty = true
      st.morph = 0
      st.lastTrackChangeMs = performance.now()
      kickLoopRef.current?.()
      return
    }

    void extractCoverPalette(artUrl, !isDark).then((pal) => {
      if (cancelled || !pal) return
      const next: [number, number, number][] = [
        [pal.dominant.rgb[0] / 255, pal.dominant.rgb[1] / 255, pal.dominant.rgb[2] / 255],
        [pal.complementary.rgb[0] / 255, pal.complementary.rgb[1] / 255, pal.complementary.rgb[2] / 255],
        [pal.tertiary.rgb[0] / 255, pal.tertiary.rgb[1] / 255, pal.tertiary.rgb[2] / 255],
        [pal.dominant.rgb[0] / 255, pal.dominant.rgb[1] / 255, pal.dominant.rgb[2] / 255],
      ]
      st.target = next
      setFallbackPalette(next)
    })

    const src = smallCoverUrl(artUrl) ?? artUrl
    void fetchCoverBitmap(src).then((bmp) => {
      if (cancelled) {
        bmp?.close()
        return
      }
      st.pendingBitmap?.close()
      st.pendingBitmap = bmp
      st.bitmapDirty = true
      st.morph = 0
      st.lastTrackChangeMs = performance.now()
      kickLoopRef.current?.()
    })

    return () => {
      cancelled = true
    }
  }, [artUrl, eraAsset, isDark])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'
    host.appendChild(canvas)

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
    })
    if (!gl) {
      host.replaceChildren()
      setWebglFailed(true)
      return
    }

    const toneProg = linkProgram(gl, QUAD_VERT, TONE_FRAG)
    const kawaseProg = linkProgram(gl, QUAD_VERT, KAWASE_FRAG)
    const meshProg = linkProgram(gl, MESH_VERT, MESH_FRAG)
    if (!toneProg || !kawaseProg || !meshProg) {
      if (toneProg) gl.deleteProgram(toneProg)
      if (kawaseProg) gl.deleteProgram(kawaseProg)
      if (meshProg) gl.deleteProgram(meshProg)
      host.replaceChildren()
      setWebglFailed(true)
      return
    }

    // Fullscreen quad VAO for prep passes
    const quadVao = gl.createVertexArray()
    const quadBuf = gl.createBuffer()
    gl.bindVertexArray(quadVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    for (const p of [toneProg, kawaseProg]) {
      const loc = gl.getAttribLocation(p, 'a_pos')
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc)
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
      }
    }

    // 64x64 mesh VAO for tensor-product Hermite/Bezier render pass
    const vertsPerSide = GRID + 1
    const gridData = new Float32Array(vertsPerSide * vertsPerSide * 2)
    for (let j = 0; j < vertsPerSide; j++) {
      for (let i = 0; i < vertsPerSide; i++) {
        const o = (j * vertsPerSide + i) * 2
        gridData[o] = i / GRID
        gridData[o + 1] = j / GRID
      }
    }
    const indices = new Uint16Array(GRID * GRID * 6)
    let k = 0
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const a = j * vertsPerSide + i
        const b = a + 1
        const c = a + vertsPerSide
        const d = c + 1
        indices[k++] = a; indices[k++] = b; indices[k++] = c
        indices[k++] = b; indices[k++] = d; indices[k++] = c
      }
    }
    const meshVao = gl.createVertexArray()
    const meshVbo = gl.createBuffer()
    const meshIbo = gl.createBuffer()
    gl.bindVertexArray(meshVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, meshVbo)
    gl.bufferData(gl.ARRAY_BUFFER, gridData, gl.STATIC_DRAW)
    const gridLoc = gl.getAttribLocation(meshProg, 'a_grid')
    gl.enableVertexAttribArray(gridLoc)
    gl.vertexAttribPointer(gridLoc, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIbo)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)
    gl.bindVertexArray(null)

    // Prep pipeline textures (max 2 live prepared cover textures + scratch pyramid)
    const rawTex = createTargetTex(gl, PREP_SIZE)
    const toneTex = createTargetTex(gl, PREP_SIZE)
    const halfTex = createTargetTex(gl, 64)
    const quarterTex = createTargetTex(gl, 32)
    const prepTextures = [createTargetTex(gl, PREP_SIZE), createTargetTex(gl, PREP_SIZE)]
    const fbo = gl.createFramebuffer()
    let activeIdx = 0
    let hasCurr = false
    let hasPrev = false

    const toneUTex = gl.getUniformLocation(toneProg, 'u_tex')
    const kawUTex = gl.getUniformLocation(kawaseProg, 'u_tex')
    const kawUTexel = gl.getUniformLocation(kawaseProg, 'u_texel')
    const kawUOffset = gl.getUniformLocation(kawaseProg, 'u_offset')

    const uCtrlPos = gl.getUniformLocation(meshProg, 'u_ctrlPos')
    const uCtrlUv = gl.getUniformLocation(meshProg, 'u_ctrlUv')
    const uCtrlUvAlt = gl.getUniformLocation(meshProg, 'u_ctrlUvAlt')
    const uPrevTex = gl.getUniformLocation(meshProg, 'u_prevTex')
    const uCurrTex = gl.getUniformLocation(meshProg, 'u_currTex')
    const uHasPrev = gl.getUniformLocation(meshProg, 'u_hasPrev')
    const uHasCurr = gl.getUniformLocation(meshProg, 'u_hasCurr')
    const uMorph = gl.getUniformLocation(meshProg, 'u_morph')
    const uDark = gl.getUniformLocation(meshProg, 'u_dark')
    const uEnergy = gl.getUniformLocation(meshProg, 'u_energy')
    const uEnergyPush = gl.getUniformLocation(meshProg, 'u_energyPush')
    const uGrain = gl.getUniformLocation(meshProg, 'u_grain')
    const uWarmth = gl.getUniformLocation(meshProg, 'u_warmth')
    const uEntry = gl.getUniformLocation(meshProg, 'u_entry')
    const uCols = [0, 1, 2, 3].map((i) => gl.getUniformLocation(meshProg, `u_c${i}`))

    const ctrlPos = new Float32Array(32)
    const ctrlUv = new Float32Array(32)
    const ctrlUvAlt = new Float32Array(32)

    const blit = (prog: WebGLProgram, srcTex: WebGLTexture, dstTex: WebGLTexture, size: number, offset?: number): void => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dstTex, 0)
      gl.viewport(0, 0, size, size)
      gl.useProgram(prog)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, srcTex)
      if (offset !== undefined) {
        gl.uniform1i(kawUTex, 0)
        gl.uniform2f(kawUTexel, 1 / size, 1 / size)
        gl.uniform1f(kawUOffset, offset)
      } else {
        gl.uniform1i(toneUTex, 0)
      }
      gl.bindVertexArray(quadVao)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    const prepareCoverTexture = (bmp: ImageBitmap): void => {
      if (!rawTex || !toneTex || !halfTex || !quarterTex || !prepTextures[0] || !prepTextures[1]) return
      const nextIdx = 1 - activeIdx
      const dst = prepTextures[nextIdx]!
      gl.bindTexture(gl.TEXTURE_2D, rawTex)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
      bmp.close()

      // Pass 1: AMLL hue-preserving tone map (128x128)
      blit(toneProg, rawTex, toneTex, PREP_SIZE)
      // Dual Kawase blur pyramid: 128 -> 64 -> 32 -> 64 -> 128
      blit(kawaseProg, toneTex, halfTex, 64, 0.5)
      blit(kawaseProg, halfTex, quarterTex, 32, 1.5)
      blit(kawaseProg, quarterTex, halfTex, 64, 1.5)
      blit(kawaseProg, halfTex, dst, PREP_SIZE, 2.0)

      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      hasPrev = hasCurr
      activeIdx = nextIdx
      hasCurr = true
    }

    let rawPunch = 0
    let beatEnv = 0
    let cornerPairIdx = 0
    let lastBeatMs = 0
    const unlistenMeter = audioReactive ? listenToMeter((m) => {
      const st = stateRef.current
      if (!st.playing || !st.animated) {
        rawPunch = 0
        return
      }
      const normalized = Math.min(1, Math.max(0, m.punch > 1 ? (m.punch - 1) * 1.45 : m.punch * 0.2))
      rawPunch = normalized
    }) : () => {}

    let phase = 0
    let last = performance.now()
    let raf = 0

    const resize = (): void => {
      const r = host.getBoundingClientRect()
      const cssW = Math.max(240, r.width)
      const cssH = Math.max(135, r.height)
      const dprScale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.65
      const targetW = cssW * dprScale
      const targetH = cssH * dprScale
      const capScale = Math.min(1, MAX_SIDE_PX / Math.max(targetW, targetH, 1))
      const w = Math.max(240, Math.round(targetW * capScale))
      const h = Math.max(135, Math.round(targetH * capScale))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
    }

    const ro = new ResizeObserver(() => {
      resize()
      renderFrame(performance.now())
    })
    ro.observe(host)
    resize()

    const renderFrame = (now: number): void => {
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000))
      last = now
      const st = stateRef.current

      if (st.bitmapDirty) {
        st.bitmapDirty = false
        if (st.pendingBitmap) {
          const bmp = st.pendingBitmap
          st.pendingBitmap = null
          try {
            prepareCoverTexture(bmp)
          } catch {
            bmp.close()
          }
        } else {
          hasPrev = hasCurr
          hasCurr = false
        }
      }

      // 45ms attack / 320ms release envelope + 100ms refractory + 2-corner pair lock until settle
      if (st.playing && st.animated) {
        if (rawPunch > 0.36 && beatEnv < 0.25 && now - lastBeatMs > 100) {
          lastBeatMs = now
        }
        const rate = rawPunch > beatEnv ? 1 / 0.045 : 1 / 0.32
        beatEnv += (rawPunch - beatEnv) * (1 - Math.exp(-dt * rate))
      } else {
        beatEnv += (0 - beatEnv) * (1 - Math.exp(-dt * (1 / 0.28)))
        if (beatEnv < 0.003) beatEnv = 0
      }
      if (beatEnv < 0.04 && rawPunch < 0.15 && now - lastBeatMs > 360) {
        cornerPairIdx = (cornerPairIdx + 1) % CORNER_PAIRS.length
        lastBeatMs = now
      }

      const atm = st.atmosphere
      const targetSpeed = st.animated ? (st.playing ? atm.speed : 0) : 0
      st.motionSpeed += (targetSpeed - st.motionSpeed) * (1 - Math.exp(-dt * (st.playing ? 5 : 2.2)))
      if (st.motionSpeed < 0.005 && !st.playing) st.motionSpeed = 0

      if (st.animated) {
        phase += dt * (0.28 * st.motionSpeed + beatEnv * atm.energyPush * 0.65)
      }

      const morphElapsed = now - st.lastTrackChangeMs
      st.morph = st.animated ? Math.min(1, morphElapsed / MORPH_MS) : 1
      const smoothMorph = st.morph * st.morph * (3 - 2 * st.morph)
      const entryProgress = st.animated ? Math.min(1, (now - st.entryStartMs) / 680) : 1
      const smoothEntry = entryProgress * entryProgress * (3 - 2 * entryProgress)

      const lerpK = st.animated ? 1 - Math.exp(-dt * 3.0) : 1
      for (let i = 0; i < 4; i++) {
        for (let ch = 0; ch < 3; ch++) {
          st.current[i][ch] += (st.target[i][ch] - st.current[i][ch]) * lerpK
        }
      }

      fillControlPoints(ctrlPos, ctrlUv, phase, st.seed, beatEnv, cornerPairIdx, 0, atm.calmness, atm.energyPush)
      fillControlPoints(ctrlPos, ctrlUvAlt, phase, st.prevSeed, beatEnv, cornerPairIdx, 0.35, atm.calmness, atm.energyPush)
      // Re-apply primary control positions after alt UV fill
      fillControlPoints(ctrlPos, ctrlUv, phase, st.seed, beatEnv, cornerPairIdx, 0, atm.calmness, atm.energyPush)

      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.useProgram(meshProg)
      gl.uniform2fv(uCtrlPos, ctrlPos)
      gl.uniform2fv(uCtrlUv, ctrlUv)
      gl.uniform2fv(uCtrlUvAlt, ctrlUvAlt)

      const prevTex = prepTextures[1 - activeIdx]
      const currTex = prepTextures[activeIdx]
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, prevTex)
      gl.uniform1i(uPrevTex, 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, currTex)
      gl.uniform1i(uCurrTex, 1)

      gl.uniform1f(uHasPrev, hasPrev ? 1 : 0)
      gl.uniform1f(uHasCurr, hasCurr ? 1 : 0)
      gl.uniform1f(uMorph, smoothMorph)
      gl.uniform1f(uDark, st.isDark ? 1 : 0)
      gl.uniform1f(uEnergy, beatEnv)
      gl.uniform1f(uEnergyPush, atm.energyPush)
      gl.uniform1f(uGrain, atm.grain)
      gl.uniform1f(uWarmth, atm.warmth)
      gl.uniform1f(uEntry, smoothEntry)
      for (let i = 0; i < 4; i++) {
        const c = st.current[i]
        gl.uniform3f(uCols[i], c[0], c[1], c[2])
      }

      gl.bindVertexArray(meshVao)
      gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0)
    }

    const shouldKeepRunning = (): boolean => {
      const st = stateRef.current
      if (document.hidden || !st.animated) return false
      const entryOpen = performance.now() - st.entryStartMs < 720
      return st.playing || st.morph < 0.999 || entryOpen || st.motionSpeed > 0.01 || beatEnv > 0.005
    }

    const loop = (now: number): void => {
      renderFrame(now)
      if (shouldKeepRunning()) {
        raf = requestAnimationFrame(loop)
      } else {
        raf = 0
      }
    }

    const kickLoop = (): void => {
      if (!document.hidden && !raf) {
        last = performance.now()
        if (shouldKeepRunning()) {
          raf = requestAnimationFrame(loop)
        } else {
          renderFrame(last)
        }
      }
    }
    kickLoopRef.current = kickLoop

    const onVis = (): void => {
      if (document.hidden) {
        cancelAnimationFrame(raf)
        raf = 0
      } else {
        kickLoop()
      }
    }

    document.addEventListener('visibilitychange', onVis)
    renderFrame(last)
    kickLoop()

    return () => {
      kickLoopRef.current = null
      document.removeEventListener('visibilitychange', onVis)
      unlistenMeter()
      ro.disconnect()
      cancelAnimationFrame(raf)
      stateRef.current.pendingBitmap?.close()
      stateRef.current.pendingBitmap = null
      for (const t of [rawTex, toneTex, halfTex, quarterTex, ...prepTextures]) {
        if (t) gl.deleteTexture(t)
      }
      if (fbo) gl.deleteFramebuffer(fbo)
      if (quadBuf) gl.deleteBuffer(quadBuf)
      if (quadVao) gl.deleteVertexArray(quadVao)
      if (meshVbo) gl.deleteBuffer(meshVbo)
      if (meshIbo) gl.deleteBuffer(meshIbo)
      if (meshVao) gl.deleteVertexArray(meshVao)
      gl.deleteProgram(toneProg)
      gl.deleteProgram(kawaseProg)
      gl.deleteProgram(meshProg)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      host.replaceChildren()
    }
  }, [audioReactive])

  useEffect(() => {
    kickLoopRef.current?.()
  }, [animated, playing, isDark, resolvedAtm.id])

  return (
    <div ref={hostRef} className="absolute inset-0 pointer-events-none" aria-hidden="true">
      {webglFailed && <CssFallbackMesh colors={fallbackPalette} isDark={isDark} animated={animated && playing} />}
      {resolvedAtm.butterflies && animated && <LndButterflies isDark={isDark} />}
    </div>
  )
}
