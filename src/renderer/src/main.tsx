import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import FloatApp from './FloatApp'
import './index.css'
import { installGlobalErrorLogging } from './lib/runLog'
import { initWindowSync } from './lib/windowSync'
import { initDesktopBridge } from './lib/desktopBridge'
import { installTranslateDomGuard } from './lib/translateDomGuard'
import { installDebugRecorder } from './lib/debugRecorder'
import { initDebugRecorderSync } from './components/DebugRecorder'
import { installHoverScrollTruncated } from './lib/hoverScrollTruncated'
import { installImageFade } from './lib/imageFade'
import { installSmoothWheel } from './lib/smoothWheel'

installDebugRecorder()
installGlobalErrorLogging()
installTranslateDomGuard()
installHoverScrollTruncated()
installImageFade()
installSmoothWheel()

// Pop-out windows boot this same bundle with ?float=<view> (see main.js
// createFloatWindow) and mount a single view instead of the full app. Every
// Electron window — main and pop-outs — joins the store-sync channel.
const floatView = new URLSearchParams(window.location.search).get('float')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if ((window as any).electron) { initWindowSync(!!floatView); initDebugRecorderSync() }
// Desktop (Windows): only the main window drives the light and the desktop widgets.
if (!floatView) initDesktopBridge()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {floatView ? <FloatApp view={floatView} /> : <App />}
  </React.StrictMode>
)
