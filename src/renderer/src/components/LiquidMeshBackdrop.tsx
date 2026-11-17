import { useEffect, useRef } from 'react'
import { getAnalysisTap } from '../lib/audioEffects'
import { ERA_PALETTES } from '../lib/eraPalettes'
import { smallCoverUrl } from '../lib/juicewrldApi'
import { extractPalette, paletteFromAccent, parseColor } from '../lib/viz/palette'
import type { RGB } from '../lib/viz/types'

interface Props {
  artUrl: string | null
  eraAsset: string | null
  isDark: boolean
  playing: boolean
  animated: boolean
}

const VERT_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

const FRAG_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_res;
uniform float u_time;
uniform float u_energy;
uniform float u_dark;
uniform float u_hasTex;
uniform sampler2D u_tex;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;

vec2 rot(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c) * p;
}

// Organic radial swirl used to fold layered artwork samples into liquid color fields.
vec2 twist(vec2 uv, vec2 center, float radius, float angle) {
  vec2 d = uv - center;
  float dist = length(d);
  if (dist < radius) {
    float k = 1.0 - dist / radius;
    d = rot(d, k * k * angle);
  }
  return center + d;
}

vec3 sampleBlurredCover(vec2 uv) {
  vec2 c = clamp(uv, 0.06, 0.94);
  vec2 o = vec2(0.065);
  vec3 s = texture(u_tex, c).rgb * 0.28;
  s += texture(u_tex, clamp(c + vec2( o.x,  o.y), 0.03, 0.97)).rgb * 0.18;
  s += texture(u_tex, clamp(c + vec2(-o.x,  o.y), 0.03, 0.97)).rgb * 0.18;
  s += texture(u_tex, clamp(c + vec2( o.x, -o.y), 0.03, 0.97)).rgb * 0.18;
  s += texture(u_tex, clamp(c + vec2(-o.x, -o.y), 0.03, 0.97)).rgb * 0.18;
  return s;
}

void main() {
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = (v_uv - 0.5) * vec2(aspect, 1.0);
  float t = u_time;

  // Four slow golden-ratio orbital anchors for the mesh color field.
  vec2 a0 = vec2(cos(t * 0.41) * 0.48, sin(t * 0.33) * 0.38);
  vec2 a1 = vec2(sin(t * 0.29 + 1.4) * 0.55, cos(t * 0.47 + 0.8) * 0.42);
  vec2 a2 = vec2(cos(t * 0.37 + 3.1) * 0.52, sin(t * 0.26 + 2.3) * 0.36);
  vec2 a3 = vec2(sin(t * 0.23 + 4.5) * 0.44, cos(t * 0.35 + 3.7) * 0.44);

  // Subtle domain flow so mesh lobes fold smoothly rather than staying circular.
  vec2 warp = vec2(
    sin(p.y * 2.4 + t * 0.35) + cos(p.x * 1.9 - t * 0.27),
    cos(p.x * 2.2 - t * 0.31) + sin(p.y * 2.1 + t * 0.29)
  ) * 0.14;
  vec2 wp = p + warp;

  float w0 = exp(-dot(wp - a0, wp - a0) * (1.85 - u_energy * 0.35));
  float w1 = exp(-dot(wp - a1, wp - a1) * 1.75);
  float w2 = exp(-dot(wp - a2, wp - a2) * 1.95);
  float w3 = exp(-dot(wp - a3, wp - a3) * 1.65);
  float wSum = w0 + w1 + w2 + w3 + 0.001;

  vec3 mesh = (u_c0 * w0 + u_c1 * w1 + u_c2 * w2 + u_c3 * w3) / wSum;

  if (u_hasTex > 0.5) {
    vec2 uvA = twist(v_uv, 0.5 + a0 * 0.35, 0.85, 1.7 + sin(t * 0.22) * 0.5);
    vec2 uvB = twist(vec2(1.0 - v_uv.x, v_uv.y), 0.5 + a1 * 0.3, 0.8, -1.5 + cos(t * 0.19) * 0.45);
    vec3 texMix = mix(sampleBlurredCover(uvA), sampleBlurredCover(uvB), 0.45);
    mesh = mix(mesh, texMix, 0.44);
  }

  // Smooth contrast & luminance envelope tuned per dark/light skin.
  float luma = dot(mesh, vec3(0.2126, 0.7152, 0.0722));
  vec3 sat = mix(vec3(luma), mesh, 1.18 + u_energy * 0.18);

  vec3 col;
  if (u_dark > 0.5) {
    float vignette = 1.0 - smoothstep(0.35, 1.35, length(p * vec2(0.75, 1.0))) * 0.38;
    float gain = (0.34 + u_energy * 0.08) * vignette;
    col = clamp(sat * gain, 0.015, 0.42);
  } else {
    col = mix(vec3(0.92, 0.93, 0.96), clamp(sat, 0.0, 1.0), 0.34 + u_energy * 0.06);
  }

  // Interleaved gradient noise micro-dither to avoid 8-bit banding.
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  col += (ign - 0.5) / 255.0;

  fragColor = vec4(col, 1.0);
}
`

function toVec3(c: RGB): [number, number, number] {
  return [c.r / 255, c.g / 255, c.b / 255]
}

function accentPalette(): RGB[] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  return paletteFromAccent(parseColor(raw || '#e0592f'))
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

/**
 * Apple Music-inspired fluid artwork mesh gradient rendered in WebGL2 at half-resolution.
 * Samples the real cover artwork when CORS allows, or falls back to baked era / cover palettes
 * blended softly over time without harsh particles or legacy visualizer shapes.
 */
export default function LiquidMeshBackdrop({
  artUrl,
  eraAsset,
  isDark,
  playing,
  animated,
}: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const kickLoopRef = useRef<(() => void) | null>(null)
  const stateRef = useRef({
    isDark,
    playing,
    animated,
    target: accentPalette().map(toVec3) as [number, number, number][],
    current: accentPalette().map(toVec3) as [number, number, number][],
    hasTex: false,
    texImage: null as HTMLImageElement | null,
    texDirty: false,
  })

  stateRef.current.isDark = isDark
  stateRef.current.playing = playing
  stateRef.current.animated = animated

  // Resolve target 4-color palette & cover texture whenever artwork or era changes.
  useEffect(() => {
    let cancelled = false
    const baked = eraAsset ? ERA_PALETTES[eraAsset] : null
    if (baked?.length) {
      stateRef.current.target = [0, 1, 2, 3].map((i) => toVec3(baked[i % baked.length]))
    } else {
      stateRef.current.target = accentPalette().map(toVec3)
    }

    stateRef.current.hasTex = false
    stateRef.current.texImage = null
    stateRef.current.texDirty = true

    if (!artUrl) return
    const src = smallCoverUrl(artUrl) ?? artUrl

    void extractPalette(src, 4).then((pal) => {
      if (cancelled || !pal?.length) return
      stateRef.current.target = [0, 1, 2, 3].map((i) => toVec3(pal[i % pal.length]))
    })

    // Only attempt texture upload for sources that won't trigger CORS console noise:
    // inline data/blob URLs or when extractPalette/CORS is clean (skip bare /assets/).
    if (!eraAsset) {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        if (cancelled) return
        stateRef.current.texImage = img
        stateRef.current.hasTex = true
        stateRef.current.texDirty = true
      }
      img.src = src
    }

    return () => {
      cancelled = true
    }
  }, [artUrl, eraAsset])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'
    host.appendChild(canvas)

    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' })
    if (!gl) {
      host.replaceChildren()
      return
    }

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC)
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC)
    const prog = vs && fs ? gl.createProgram() : null
    if (!vs || !fs || !prog) {
      if (vs) gl.deleteShader(vs)
      if (fs) gl.deleteShader(fs)
      host.replaceChildren()
      return
    }
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      gl.deleteProgram(prog)
      host.replaceChildren()
      return
    }

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const posLoc = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))

    const uRes = gl.getUniformLocation(prog, 'u_res')
    const uTime = gl.getUniformLocation(prog, 'u_time')
    const uEnergy = gl.getUniformLocation(prog, 'u_energy')
    const uDark = gl.getUniformLocation(prog, 'u_dark')
    const uHasTex = gl.getUniformLocation(prog, 'u_hasTex')
    const uTex = gl.getUniformLocation(prog, 'u_tex')
    const uCols = [0, 1, 2, 3].map((i) => gl.getUniformLocation(prog, `u_c${i}`))

    let analyser: AnalyserNode | null = null
    let tappedNode: AudioNode | null = null
    let freqBuf: Uint8Array<ArrayBuffer> | null = null
    const ensureAnalyser = (): AnalyserNode | null => {
      if (analyser) return analyser
      const tap = getAnalysisTap()
      if (!tap) return null
      try {
        const a = tap.ctx.createAnalyser()
        a.fftSize = 128
        a.smoothingTimeConstant = 0.85
        tap.node.connect(a)
        analyser = a
        tappedNode = tap.node
        freqBuf = new Uint8Array(new ArrayBuffer(a.frequencyBinCount))
        return a
      } catch {
        return null
      }
    }
    let energy = 0
    let phase = 0
    let last = performance.now()
    let raf = 0

    const resize = (): void => {
      const r = host.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * 0.5
      const w = Math.max(240, Math.round(r.width * dpr))
      const h = Math.max(135, Math.round(r.height * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      gl.viewport(0, 0, canvas.width, canvas.height)
    }

    const ro = new ResizeObserver(resize)
    ro.observe(host)
    resize()

    const renderFrame = (now: number): void => {
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000))
      last = now
      const st = stateRef.current

      // Smooth audio low-end envelope
      let targetEnergy = 0
      if (st.playing && st.animated) {
        const a = ensureAnalyser()
        if (a && freqBuf) {
          a.getByteFrequencyData(freqBuf)
          const bins = Math.min(12, freqBuf.length)
          let sum = 0
          for (let i = 0; i < bins; i++) sum += freqBuf[i]
          targetEnergy = bins > 0 ? sum / (bins * 255) : 0
        }
      }
      energy += (targetEnergy - energy) * (1 - Math.exp(-dt * 4.5))

      if (st.animated) {
        phase += dt * ((st.playing ? 0.24 : 0.08) + energy * 0.55)
      }

      // Lerp palette smoothly across track transitions
      const lerpK = 1 - Math.exp(-dt * 2.4)
      for (let i = 0; i < 4; i++) {
        for (let ch = 0; ch < 3; ch++) {
          st.current[i][ch] += (st.target[i][ch] - st.current[i][ch]) * lerpK
        }
      }

      if (st.texDirty) {
        st.texDirty = false
        gl.bindTexture(gl.TEXTURE_2D, tex)
        if (st.hasTex && st.texImage) {
          try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, st.texImage)
          } catch {
            st.hasTex = false
          }
        }
      }

      gl.useProgram(prog)
      gl.uniform2f(uRes, canvas.width, canvas.height)
      gl.uniform1f(uTime, phase)
      gl.uniform1f(uEnergy, energy)
      gl.uniform1f(uDark, st.isDark ? 1 : 0)
      gl.uniform1f(uHasTex, st.hasTex ? 1 : 0)
      gl.uniform1i(uTex, 0)
      for (let i = 0; i < 4; i++) {
        const c = st.current[i]
        gl.uniform3f(uCols[i], c[0], c[1], c[2])
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    const loop = (now: number): void => {
      if (document.hidden || !stateRef.current.animated) {
        raf = 0
        return
      }
      renderFrame(now)
      raf = requestAnimationFrame(loop)
    }

    const onVis = (): void => {
      if (document.hidden) {
        cancelAnimationFrame(raf)
        raf = 0
      } else if (!raf && stateRef.current.animated) {
        last = performance.now()
        raf = requestAnimationFrame(loop)
      }
    }

    const kickLoop = (): void => {
      if (!raf && !document.hidden && stateRef.current.animated) {
        last = performance.now()
        raf = requestAnimationFrame(loop)
      }
    }
    kickLoopRef.current = kickLoop

    document.addEventListener('visibilitychange', onVis)
    renderFrame(last)
    kickLoop()

    return () => {
      kickLoopRef.current = null
      document.removeEventListener('visibilitychange', onVis)
      ro.disconnect()
      cancelAnimationFrame(raf)
      if (tappedNode && analyser) {
        try { tappedNode.disconnect(analyser) } catch { /* node already torn down */ }
      }
      gl.deleteTexture(tex)
      gl.deleteBuffer(buf)
      gl.deleteProgram(prog)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      host.replaceChildren()
    }
  }, [])

  useEffect(() => {
    if (animated) kickLoopRef.current?.()
  }, [animated])

  return <div ref={hostRef} className="absolute inset-0 pointer-events-none" aria-hidden="true" />
}
