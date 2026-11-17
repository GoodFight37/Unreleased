// Restore the last painted palette before the renderer bundle is ready.
(() => {
  const root = document.documentElement
  let dark = true
  root.style.setProperty('--surface', '#000000')
  try {
    let id = JSON.parse(localStorage.getItem('unreleased:theme') || '"glass-dark"')
    if (!['glass-dark', 'glass-light', '999', 'gbgr', 'drfl', 'lnd', 'fd'].includes(id)) {
      const skins = JSON.parse(localStorage.getItem('unreleased:customSkins') || '[]')
      const custom = Array.isArray(skins) ? skins.find((skin) => skin && skin.id === id && skin.vars) : null
      const light = custom ? !custom.dark : ['light', 'blossom', 'paper', 'arctic', 'mint', 'lavender', 'solar', 'peach', 'sunshine', 'sage', 'mist'].includes(id)
      id = light ? 'glass-light' : 'glass-dark'
    }
    dark = id !== 'glass-light' && id !== 'gbgr'
    root.style.setProperty('--surface', dark ? '#000000' : '#ffffff')
    const cached = JSON.parse(localStorage.getItem('unreleased:startupTheme') || 'null')
    if (cached && cached.id === id && cached.dark === dark && cached.vars && typeof cached.vars === 'object') {
      for (const [key, value] of Object.entries(cached.vars)) {
        if (key.startsWith('--') && typeof value === 'string') root.style.setProperty(key, value)
      }
    }
  } catch { /* unavailable storage keeps the fallback palette */ }
  root.classList.toggle('dark', dark)
  root.style.backgroundColor = 'var(--surface)'
})()
