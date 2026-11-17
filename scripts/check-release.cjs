const fs = require('node:fs')
const path = require('node:path')

function validateRelease(pkg, lock, tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || tag !== `v${pkg.version}`) throw new Error('Release tag must match the stable package.json version')
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) throw new Error('package-lock.json version is out of sync')
  const feed = pkg.build?.publish
  if (feed?.provider !== 'github' || feed.owner !== 'GoodFight37' || feed.repo !== 'Unreleased') throw new Error('Updates must use GoodFight37/Unreleased')
  if (pkg.build?.appId !== 'com.goodfight37.unreleased.glasslab') throw new Error('Keep the installed Glass application identity for upgrades')
}
module.exports = { validateRelease }
if (require.main === module) {
  const root = path.join(__dirname, '..')
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  validateRelease(pkg, lock, process.argv[2])
  console.log(`Release ${process.argv[2]} validated for GoodFight37/Unreleased`)
}
