const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { createHash } = require('crypto')

// Hold LevelDB's lock files against writers while copying its browser storage.
const COPY_BROWSER_STORAGE = `
$ErrorActionPreference = 'Stop'
$handles = @()
try {
  foreach ($name in @('Local Storage', 'IndexedDB')) {
    $source = Join-Path $env:UNRELEASED_PROFILE_SOURCE $name
    $target = Join-Path $env:UNRELEASED_PROFILE_STAGE $name
    if ((Test-Path -LiteralPath $source) -and !(Test-Path -LiteralPath (Join-Path $env:UNRELEASED_PROFILE_TARGET $name))) {
      foreach ($lock in @(Get-ChildItem -LiteralPath $source -Filter LOCK -Recurse -File)) {
        $handles += [IO.File]::Open($lock.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
      }
      Copy-Item -LiteralPath $source -Destination $target -Recurse
    }
  }
} finally {
  foreach ($handle in $handles) { $handle.Dispose() }
}
`

function isolateOfflineFiles(stage, target) {
  const audioDir = path.join(target, 'offline-audio')
  const settingsName = 'app-settings.json'
  const settingsPath = fs.existsSync(path.join(target, settingsName)) ? path.join(target, settingsName) : path.join(stage, settingsName)
  if (fs.existsSync(settingsPath)) {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    if (settings?.offlineLibraryPath) {
      settings.offlineLibraryPath = audioDir
      fs.writeFileSync(path.join(stage, settingsName), JSON.stringify(settings))
    }
  }
  const indexName = 'offline-library.json'
  const indexPath = fs.existsSync(path.join(target, indexName)) ? path.join(target, indexName) : path.join(stage, indexName)
  if (!fs.existsSync(indexPath)) return
  const library = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
  if (!library || !library.tracks || typeof library.tracks !== 'object' || Array.isArray(library.tracks)) {
    throw new Error('The offline library cannot be imported safely. The original files have not been changed.')
  }
  for (const [id, track] of Object.entries(library.tracks)) {
    if (!track || typeof track !== 'object') throw new Error('Invalid offline track in the old profile.')
    for (const [key, folder] of [['localPath', 'offline-audio'], ['localImagePath', 'offline-covers']]) {
      const sourcePath = track[key]
      if (!sourcePath) continue
      if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) throw new Error('Invalid offline file path in the old profile.')
      const ownFolder = path.join(target, folder)
      const relative = path.relative(ownFolder, sourcePath)
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) continue
      const extension = path.extname(sourcePath)
      const name = createHash('sha256').update(id).digest('hex') + (/^\.[a-z0-9]{1,8}$/i.test(extension) ? extension : '.bin')
      const stagedFolder = path.join(stage, folder)
      fs.mkdirSync(stagedFolder, { recursive: true })
      if (fs.existsSync(sourcePath)) {
        // Reflinks, when supported, retain independent writes without a full copy.
        fs.copyFileSync(sourcePath, path.join(stagedFolder, name), fs.constants.COPYFILE_FICLONE)
      }
      // Missing originals must not become live shared references if they reappear.
      track[key] = path.join(ownFolder, name)
    }
  }
  fs.writeFileSync(path.join(stage, indexName), JSON.stringify(library))
}

/** @param {Pick<Electron.App, 'getPath' | 'setPath' | 'requestSingleInstanceLock'>} app */
function configureForkProfile(app) {
  const source = app.getPath('userData')
  const target = path.join(app.getPath('appData'), 'unreleased-glass')
  fs.mkdirSync(target, { recursive: true })
  // Even a failed import must never fall back to writing the official profile.
  app.setPath('userData', target)
  app.setPath('sessionData', target)
  if (!app.requestSingleInstanceLock()) return false
  const marker = path.join(target, '.profile-import-v2')
  if (fs.existsSync(marker)) return true
  if (path.resolve(source).toLowerCase() === path.resolve(target).toLowerCase()) return true
  // A hard kill mid-import leaves its staging folder behind; the lock above makes this the only importer.
  for (const entry of fs.readdirSync(target)) {
    if (entry.startsWith('.profile-import-')) fs.rmSync(path.join(target, entry), { recursive: true, force: true })
  }
  const stage = fs.mkdtempSync(path.join(target, '.profile-import-'))
  try {
    const browserDirs = ['Local Storage', 'IndexedDB']
    if (process.platform === 'win32') {
      const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', COPY_BROWSER_STORAGE], {
        windowsHide: true, timeout: 60_000,
        env: { ...process.env, UNRELEASED_PROFILE_SOURCE: source, UNRELEASED_PROFILE_TARGET: target, UNRELEASED_PROFILE_STAGE: stage },
      })
      if (result.error || result.status !== 0) throw new Error('Close Unreleased and earlier Glass windows before importing preferences. Check that the old profile is readable and that disk space is available.')
    } else {
      // Chromium holds this symlink for the lifetime of its Linux/macOS profile.
      try {
        fs.lstatSync(path.join(source, 'SingletonLock'))
        throw new Error('Close Unreleased before importing its preferences.')
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      for (const name of browserDirs) {
        if (fs.existsSync(path.join(source, name)) && !fs.existsSync(path.join(target, name))) {
          fs.cpSync(path.join(source, name), path.join(stage, name), { recursive: true, dereference: true })
        }
      }
    }
    for (const name of ['app-settings.json', 'library-data.json', 'local-playlists.json', 'offline-library.json']) {
      if (fs.existsSync(path.join(source, name)) && !fs.existsSync(path.join(target, name))) {
        fs.cpSync(path.join(source, name), path.join(stage, name), { recursive: true, dereference: true })
      }
    }
    isolateOfflineFiles(stage, target)
    // Publish complete media before the index that points to it, so retries stay safe.
    const names = fs.readdirSync(stage)
    for (const name of names.filter((entry) => fs.statSync(path.join(stage, entry)).isDirectory())) {
      const stagedDir = path.join(stage, name)
      const finalDir = path.join(target, name)
      if (!fs.existsSync(finalDir)) fs.renameSync(stagedDir, finalDir)
      else for (const file of fs.readdirSync(stagedDir)) fs.renameSync(path.join(stagedDir, file), path.join(finalDir, file))
    }
    for (const name of names.filter((entry) => fs.existsSync(path.join(stage, entry)) && fs.statSync(path.join(stage, entry)).isFile())) {
      fs.renameSync(path.join(stage, name), path.join(target, name))
    }
    fs.writeFileSync(marker, new Date().toISOString(), 'utf8')
  } finally {
    fs.rmSync(stage, { recursive: true, force: true })
  }
  return true
}

module.exports = { configureForkProfile }
