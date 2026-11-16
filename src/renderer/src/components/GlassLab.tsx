import React, { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { createGlass, GlassState, Measurement } from '../lib/glass/engine'
import { getGlassPreset, useGlassLookKey } from '../lib/glass/presets'
import { getSkin } from '../lib/skins'
import { useEffectsState } from '../lib/effectsPreference'
import './GlassLab.css'

type Engine = Awaited<ReturnType<typeof createGlass>>
const fixed = (v: number | null) => v === null ? 'indisponible' : `${v.toFixed(2)} ms`
export default function GlassLab({ close }: { close: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), scene = useRef<HTMLDivElement>(null), bar = useRef<HTMLDivElement>(null), play = useRef<HTMLButtonElement>(null), engine = useRef<Engine | null>(null)
  const theme = useStore(s => s.theme)
  const [light, setLight] = useState(() => !getSkin(theme).dark), [source, setSource] = useState<'ambient'|'cover'>('ambient')
  const [status, setStatus] = useState('Initialisation WebGPU…'), [report, setReport] = useState(''), [measuring, setMeasuring] = useState(false)
  const [progress, setProgress] = useState(45), [volume, setVolume] = useState(65), [joined, setJoined] = useState(false)
  const [artAvailable, setArtAvailable] = useState(false), [gpuReady, setGpuReady] = useState(false), [forcePreview, setForcePreview] = useState(false), [copied, setCopied] = useState(false)
  const { mode: effectsMode, reducedMotion, reducedTransparency } = useEffectsState()
  const glassLookKey = useGlassLookKey()
  const track = useStore(s => s.currentTrack), full = useStore(s => s.currentTrackFull)
  const artUrl = full?.albumArt || track?.imageUrl || track?.apiImageUrl
  const state = useRef<GlassState>({ light:false, source:'ambient', pointer:[0.3,0.1], lens:[0.5,0.69,0], merge:0, tint:[0.42,0.32,0.8], rect:[0.5,0.69,0.38,0.12], play:[0.8,0.65,0.04,0], preset: getGlassPreset(theme) })
  const target = useRef({ lens: 0, merge: 0 }), running = useRef(false), measuringRef = useRef(false), alive = useRef(true)
  const schedule = useRef<() => void>(() => {})
  const probe = typeof (CanvasRenderingContext2D.prototype as unknown as { drawElement?: unknown }).drawElement === 'function'
  useEffect(() => {
    alive.current = true
    if (reducedTransparency) { setStatus('Transparence réduite : rendu opaque, GPU en pause'); return () => { alive.current = false } }
    let stopped = false, frame = 0, instance: Engine | null = null
    const run = () => {
      if (stopped || document.hidden || measuringRef.current || running.current || !instance) return
      running.current = true
      frame = requestAnimationFrame(async () => {
        running.current = false
        if (stopped || document.hidden || measuringRef.current || !instance) return
        const s = state.current
        const bounds = scene.current?.getBoundingClientRect(), glass = bar.current?.getBoundingClientRect(), button = play.current?.getBoundingClientRect()
        if (bounds && glass && button && bounds.width && bounds.height) {
          s.rect = [(glass.left + glass.width/2-bounds.left)/bounds.width, (glass.top + glass.height/2-bounds.top)/bounds.height, glass.width/2/bounds.width, glass.height/2/bounds.height]
          s.play = [(button.left+button.width/2-bounds.left)/bounds.width, (button.top+button.height/2-bounds.top)/bounds.height, button.width/2/bounds.height, 0]
        }
        const preset = s.preset ?? getGlassPreset(s.light)
        const factor = reducedMotion && !forcePreview ? 1 : preset.springStiffness
        s.lens[2] += (target.current.lens - s.lens[2]) * factor
        s.merge += (target.current.merge - s.merge) * factor
        await instance.draw(s)
        if (Math.abs(s.lens[2]-target.current.lens) > 0.005 || Math.abs(s.merge-target.current.merge) > 0.005) run()
      })
    }
    schedule.current = run
    createGlass(canvas.current!).then(e => {
      if (stopped) { e.destroy(); return }
      instance = e; engine.current = e; setGpuReady(true); setStatus(`WebGPU actif · mesure GPU ${e.timed ? 'disponible' : 'indisponible'}`)
      e.lost.then(info => { if (!stopped) { engine.current = null; instance = null; setGpuReady(false); setStatus(`Repli CSS : WebGPU interrompu (${info.message || info.reason})`) } })
      // Make the initial texture valid even without an album.
      const c = document.createElement('canvas'); c.width = c.height = 512
      const ctx = c.getContext('2d')!; ctx.fillStyle = '#1c1834'; ctx.fillRect(0,0,512,512); for(let y=0;y<8;y++) for(let x=0;x<8;x++){ ctx.fillStyle=(x+y)%2 ? '#eebc93' : '#403e91'; ctx.fillRect(x*64,y*64,64,64) } ctx.strokeStyle='#ffffff'; ctx.lineWidth=5; for(let x=-512;x<1024;x+=72){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+512,512);ctx.stroke()} e.upload(c); run()
      window.dispatchEvent(new Event('glasslab-ready'))
    }).catch(err => { if (!stopped) setStatus(`Repli CSS : ${err instanceof Error ? err.message : String(err)}`) })
    const visibility = () => { if (!document.hidden) run() }
    const observer = new ResizeObserver(run); if (scene.current) observer.observe(scene.current)
    document.addEventListener('visibilitychange', visibility)
    return () => { stopped = true; alive.current = false; cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener('visibilitychange', visibility); instance?.destroy(); engine.current = null; running.current = false; setGpuReady(false) }
  }, [reducedTransparency, reducedMotion, forcePreview])
  useEffect(() => {
    const activeDark = getSkin(theme).dark
    const presetTheme = light ? (activeDark ? 'glass-light' : theme) : (activeDark ? theme : 'glass-dark')
    state.current.light = light
    state.current.source = source
    state.current.preset = getGlassPreset(presetTheme)
    schedule.current()
  }, [light, source, theme, glassLookKey])
  useEffect(() => {
    let cancelled = false
    const load = () => {
      const e = engine.current
      if (!e || !artUrl) { setArtAvailable(false); setSource('ambient'); return }
      const image = new Image(); image.crossOrigin = 'anonymous'
      image.onload = () => {
        if (cancelled || engine.current !== e) return
        try {
          const c = document.createElement('canvas'); c.width = c.height = 512
          const ctx = c.getContext('2d')!; const side = Math.min(image.width,image.height)
          ctx.drawImage(image,(image.width-side)/2,(image.height-side)/2,side,side,0,0,512,512)
          const data = ctx.getImageData(0,0,512,512).data; let r=0,g=0,b=0,n=0
          for (let i=0;i<data.length;i+=256) { r+=data[i]; g+=data[i+1]; b+=data[i+2]; n++ }
          state.current.tint = [r/n/255,g/n/255,b/n/255]; e.upload(c); setArtAvailable(true); setSource('cover'); schedule.current()
        } catch { setArtAvailable(false) }
      }
      image.onerror = () => { if (!cancelled) setArtAvailable(false) }; image.src = artUrl
    }
    load(); window.addEventListener('glasslab-ready', load)
    return () => { cancelled = true; window.removeEventListener('glasslab-ready', load) }
  }, [artUrl, reducedTransparency])
  const onPointer = (e: React.PointerEvent) => { const r = scene.current?.getBoundingClientRect(); if (!r) return; state.current.pointer = [(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height]; schedule.current() }
  const lens = (e: React.PointerEvent<HTMLInputElement>, strength: number) => {
    const r = scene.current?.getBoundingClientRect(), slider = e.currentTarget.getBoundingClientRect(); if (!r) return
    const x = Math.max(slider.left, Math.min(slider.right, e.clientX || slider.left + slider.width / 2))
    state.current.lens[0]=(x-r.left)/r.width; state.current.lens[1]=(slider.top+slider.height/2-r.top)/r.height; target.current.lens=strength; schedule.current()
  }
  const measure = async () => {
    const e = engine.current; if (!e || document.hidden || measuringRef.current) return
    measuringRef.current = true; setMeasuring(true)
    try {
      const m: Measurement = await e.measure(() => state.current)
      const info = e.adapterInfo
      setReport(`Glass Lab · ${new Date().toISOString()}\nElectron/Chromium : ${navigator.userAgent}\nGPU : ${info?.vendor || 'inconnu'} ${info?.device || ''} ${info?.description || ''}\nSurface : ${canvas.current?.width} × ${canvas.current?.height} px\nFond : ${source} · thème : ${light ? 'clair' : 'sombre'}\nMode effets : ${effectsMode} · mouvement réduit : ${reducedMotion} · aperçu forcé : ${forcePreview} · transparence réduite : ${reducedTransparency}\nHTML-in-Canvas drawElement : ${probe ? 'symbole détecté, fonctionnement non testé' : 'non détecté'}\nDurée : ${Math.round(m.durationMs)} ms · images : ${m.frames}\nCPU soumission p50/p95 : ${fixed(m.cpuP50)} / ${fixed(m.cpuP95)}\nGPU scène + flou + verre p50/p95 : ${fixed(m.gpuP50)} / ${fixed(m.gpuP95)}\nMesure GPU par timestamp-query ; indisponible si non prise en charge. CPU = préparation et soumission, pas temps GPU.`)
    } catch (err) { setReport(`Mesure interrompue : ${String(err)}`) }
    finally { measuringRef.current = false; if (alive.current) { setMeasuring(false); schedule.current() } }
  }
  return <div className="glab-overlay" role="dialog" aria-modal="true" aria-label="Glass Lab">
    <div className="glab-shell">
      <header className="glab-header"><div><small>UNRELEASED / EXPERIMENTAL</small><h1>Glass Lab</h1><p>Un laboratoire optique isolé du lecteur.</p></div><button onClick={close}>Fermer ✕</button></header>
      <div className="glab-toolbar"><button onClick={() => setLight(!light)}>Thème : {light ? 'clair' : 'sombre'}</button><button onClick={() => setSource(source === 'ambient' ? 'cover' : 'ambient')}>Fond : {source === 'ambient' ? 'ambiant' : artAvailable ? 'pochette' : 'motif test'}</button><button aria-pressed={forcePreview} onClick={() => setForcePreview(!forcePreview)}>Forcer aperçu : {forcePreview ? 'oui' : 'non'}</button><button onClick={measure} disabled={!engine.current || reducedTransparency || measuring}> {measuring ? 'Mesure en cours…' : 'Measure 4 s'}</button><button onClick={() => navigator.clipboard.writeText(report).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => setStatus('Copie impossible : sélectionnez le rapport ci-dessous.'))} disabled={!report}>{copied ? 'Copié !' : 'Copy report'}</button></div>
      <p className="glab-status" role="status">{status} · HTML-in-Canvas : {probe ? 'symbole détecté, non testé' : 'non détecté'}{!artAvailable ? ' · pochette indisponible' : ''}</p>
      <div className={`glab-scene ${light ? 'light' : 'dark'} ${reducedTransparency ? 'opaque' : ''} ${gpuReady ? 'gpu' : ''}`} ref={scene} onPointerMove={onPointer}>
        {!reducedTransparency && <canvas ref={canvas} className="glab-canvas" />}
        <div className="glab-scene-label"><span>GLASS STUDY 01</span><strong>Une lumière<br/>qui se ressent.</strong><p>Réfraction · lumière · mouvement</p></div>
        <div className="glab-bar" ref={bar}>
          <div className="glab-track"><div className="glab-cover">{artAvailable && artUrl ? <img src={artUrl} alt="" /> : '♫'}</div><div className="glab-title"><b>{track?.title || 'Unreleased'}</b><span>{track?.artist || 'Juice WRLD'}</span></div><button ref={play} className="glab-play" aria-label="Fusionner les gouttes" aria-pressed={joined} onClick={() => { setJoined(!joined); target.current.merge = joined ? 0 : 1; schedule.current() }}> {joined ? 'Ⅱ' : '▶'} </button></div>
          <div className="glab-sliders"><label>Progression <input type="range" min="0" max="100" value={progress} onChange={e => setProgress(+e.target.value)} onPointerEnter={e => lens(e,.55)} onPointerMove={e => lens(e,e.buttons ? 1 : .55)} onPointerDown={e => lens(e,1)} onPointerUp={e => lens(e,.55)} onPointerLeave={e => lens(e,0)} /><span>{progress}%</span></label><label>Volume <input type="range" min="0" max="100" value={volume} onChange={e => setVolume(+e.target.value)} onPointerEnter={e => lens(e,.55)} onPointerMove={e => lens(e,e.buttons ? 1 : .55)} onPointerDown={e => lens(e,1)} onPointerUp={e => lens(e,.55)} onPointerLeave={e => lens(e,0)} /><span>{volume}%</span></label></div>
        </div>
      </div>
      <p className="glab-note">Les commandes de cette maquette ne modifient pas la lecture. Le verre réfracte le fond du laboratoire, pas les autres écrans de l’application.</p>
      {report && <textarea className="glab-report" aria-label="Rapport de mesure" readOnly value={report} />}
    </div>
  </div>
}
