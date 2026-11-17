# Windows releases and updates

Unreleased Glass ships from `GoodFight37/Unreleased`, branch `app`. The app's
installed identity and profile stay stable across releases. Original Unreleased
installers and its gated beta channel cannot update this fork.

1. Update `package.json` and both root version entries in `package-lock.json`.
2. Run the checks in `AGENTS.md`, then commit and push `app`.
3. Create a release tag such as `v2.6.50` from the tested commit on `app`.
4. Publish that GitHub release. **Build Windows release** builds the tag and
   attaches `Unreleased Glass-Setup-<version>.exe`, its `.blockmap`, and
   `latest.yml`. Its manual run can rebuild an existing release tag.
5. Confirm the workflow succeeded and those three assets are present before
   sharing the download. A push to `app` alone does not publish a release.

Installed Windows builds check this fork's stable releases at launch and in
the background, respecting the existing automatic download preference. Each
new version must be higher than the installed one. Keep `latest.yml` and the
installer together: the manifest supplies the version, filename and checksum.
macOS keeps the existing manual DMG replacement; Linux uses AppImage updates.

Local package: `npm run electron:build -- --win --publish never`. Output is in
`release/`; `win-unpacked/Unreleased Glass.exe` runs with its adjacent files.
The legacy `scripts/release.bat`/`scripts/python/release.py` multi-branch
publisher belongs to the original app and refuses the Glass target. No GitHub
token, development auth token or user profile belongs in an installer.

Version 2.6.50 of this fork imports the original app's changes through commit
`fbfecbb8` (upstream v2.6.51), adapted to Glass. Official videos are opt-in in
Settings → Lyrics & WRLD; SVG refraction is a fallback when the WebGPU
compositor is unavailable. No pixel mascot is included.
