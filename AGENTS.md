# Agent Guide — Unreleased Glass

**Version 2.0** · updated 2026-11-19. Keep this file under **16 KB** so it never truncates when loaded into agent context.

---

## 1. Repository, Scope & Git Rules

- **Repository:** `GoodFight37/Unreleased` (desktop-only Electron fork of `Juice-WRLD-API/Unreleased`).
- **Single active branch:** **`app`**. Do not create parallel branches/worktrees or reference the deleted `liquid-glass` branch unless explicitly requested.
- **Scope:** Electron 42 + React 18 + TypeScript + Tailwind + Zustand + WebGPU (`src/renderer/src/lib/glass/`) desktop player. There is no `backend/`, `web`, `android/`, `ios/`, `unreleased-cli/`, or `jwa-cdn-node/` in this checkout.
- **Git hygiene:**
  - Author commits as `GoodFight37`. **Zero AI mentions** anywhere (no `Co-Authored-By`, no "Generated with", no Claude/Codex/AI mentions in commits, code, or comments).
  - Never push to `origin` unless the user explicitly asks. If `origin/app` moved ahead, `git pull --rebase origin app` (no `--force`, no merge commit).
  - Never commit local ignored files (`CLAUDE.md`, `PROGRESS.md`, `LESSONS.md`, `.agents/`, `.claude/skills/`, `.ui-verify/`, `.env.local`, `docs/design/`).
- **Port 3018 / Dev Server:** Never start `npm run electron:dev` or occupy port `3018` (reserved for the user's launcher). Use `npm run build` + `ui:verify` / `ui:motion` (isolated `--user-data-dir` and `--load-dist`).
- **Releases:** Deliberate manual releases only (see `docs/RELEASING.md`). Long `electron:build` runs belong in a visible terminal window.

---

## 2. Architecture & Layout

```
electron/                  main.js, preload.js (window.electron), offlineLibrary.js,
                           alacPlayback.js, discordLogin.js, discordRpc.js, passkey.js,
                           desktop/ + desktopPreload.js (window.desktopPage)
src/renderer/src/
  App.tsx, FloatApp.tsx    main window; pop-out & mini-player windows (?float=)
  components/              views, modals, panels (Player, ApiTrackerView, WrldView, CoffreHome…)
  desktop/                 Desktop widgets, edge light, lyric scenes (Cut, Karaoke…)
  lib/                     API clients, audioEffects, glass/ (WebGPU), terminal/ (CLI commands)
  store/                   Zustand stores (useStore, usePlayheadStore, queueSlice, chatStore, vizStore)
  hooks/                   useVirtualWindow, useSlidingIndicator, useListMotion, useExitGhost
scripts/                   ui-verify.mjs, motion-audit.mjs, check-terminal-coverage.mjs, *.test.cjs
```

### Mandatory Code Rules
- **API access:** Never call `fetch` directly in components. Use `lib/apiClient.ts` (`apiRequest` / `authedRequest`), `lib/juicewrldApi.ts`, `lib/userApi.ts`, or `lib/<area>Api.ts`.
- **Never hard-code base URLs:** Always build URLs via `routeUrl` / `baseFor` in `lib/apiServers.ts`.
- **In-app terminal parity:** Every new API request function in `lib/` must be covered by a command in `lib/terminal/*.ts` (`covers: ['module.fn']`) or explicitly excluded in `scripts/check-terminal-coverage.mjs`. Run `npm run terminal:check-coverage`. Never reuse chat slash command names (`role`, `feedback`, `broadcast`, `np`…).
- **Desktop feature & CSP:** Desktop pages (`src/renderer/src/desktop/`) run under strict CSP (no inline `style` attributes or `<style>` tags).
- **Keep fan features intact:** Preserve Discover, Catalogue, Collection, Footage, WRLD, 999 FM, **Heardle**, Playlists/Offline, Lyrics Sync, EQ, Terminal, Discord RPC, Tray, media keys, and `FloatApp`. Technical/staff tools stay behind `developerMode`.

---

## 3. Live Juice WRLD API Quirks (`https://juicewrldapi.com/juicewrld`)

- **User-Agent:** Plain reads require a browser-like `User-Agent` (Python `urllib` default gets 403).
- **`next`/`previous` URLs come back as `http://`:** Always paginate by `page` number, never follow raw `next` links.
- **Song IDs:** Internal `id` (e.g. `94316`) is for `/songs/{id}/`, `/versions/{song_id}/`, favorites, playlists, plays, proposals, `/track/<id>`. `public_id` (e.g. `2354`) is ONLY for `/songs/?ids=`. Mixing them fails silently.
- **Bulk & pagination:** `/eras/` (34 eras) and `/albums/` (24 rows incl. editions on page 2) are paginated (20/page). `/songs/?all=true` returns a flat array; always pass `omit=lyrics,synced_lyrics,groupbuy_info` for bulk loads (cuts 12.9 MB → 3.5 MB). `/versions/?all=true` ignores filter params; filter client-side.
- **Images & covers:** `/files/image-thumbnail/` 404s on many real images — always keep `/files/download/?…&small=1` as fallback (`FallbackImg` with `stallMs` / `ProgressiveCover`). `song.image_url` is site-relative (`/assets/...`); go through `buildImageUrl` / `resolvePrefCoverUrl`. Treat literal `"null"` as no cover.
- **Archive files & photos:** Comp channels are `comp` (primary), `redemptionz`, `legacy` (non-primary needs `&channel=<slug>`). Real Juice WRLD photo archives live under `Others/Photos/2018 Photos/<Month>`, `Others/Photos/2019 Photos/<Month>`, and `Others/Photos/Unsorted`.
- **Song dates:** Free-text labeled lines (`record_dates`, `date_leaked`, `release_date`…). Always parse through `songDates()` in `lib/onThisDay.ts`.
- **Auth & roles:** Header `Authorization: Token <token>` (or `X-API-Key`). Never show `discord_<id>` placeholder when `username_chosen: false`. Roles (`is_editor`, `is_contributor`, `is_manager`, `is_administrator`, `is_news`) are independent flags and can also be channel-scoped via `account.memberships`.
- **999 FM & Staff Chat:** Never add frame types to `/ws/radio/` (chat uses `/ws/radio/chat/`). Staff chat E2E uses libsodium `crypto_aead_xchacha20poly1305_ietf` (24-byte nonce, no AAD, `crypto_box_seal` room keys to every active device).

---

## 4. UX, Motion & Visual Standards (Single Source of Truth)

- **Target performance:** **60–100 fps stables** (never chase 120+ at the cost of stability or simplicity).
- **Motion:** **150–250 ms**, smooth ease-out (`cubic-bezier(0.22, 1, 0.36, 1)`), **no bounce**. No new animation `> 300 ms` except 3 rare moments (playlist open, era enter, player video open) up to `~450 ms`. Animate `transform` and `opacity` only; never scale text; honor `prefers-reduced-motion` and Game/Economy mode.
- **Themes & Contrast:** Dark, Light, and 5 album themes (`999`, `gbgr`, `drfl`, `lnd`, `fd`) from `lib/skins.ts`. Guarantee **WCAG AA ≥ 4.5:1** without slapping opaque black boxes behind text. Never transition root palette CSS vars on `<html>`; use `paintPalette` in `lib/themeEffects.ts`.
- **WebGPU Glass & `backdrop-filter`:** `backdrop-filter` creates a containing block for `position: fixed` descendants — use portals or `.glass-backdrop` (`::before`). Keep floating cover controls inside a positioned wrapper (not directly on `.glass-field`, which forces `position: relative`).
- **Tailwind opacity gotcha:** Theme color tokens (`surface`, `text-*`, etc.) are raw `var(--…)` values in `tailwind.config.js`, so `bg-surface/85` compiles to nothing. Use plain classes, glass classes, or `color-mix()` in `index.css`.
- **Optimistic UI:** Apply immediately and roll back on error for quick non-destructive actions (like, follow, playlist add/reorder).
- **Scroll & Layout:** `lib/smoothWheel.ts` eases mouse wheel globally (mark custom wheel scrollers `data-native-wheel`). `SCROLL_UNDER` views must pad scrollers with `.pb-player`. Fade hero backdrops with `mask-image`, never into `var(--surface)`.
- **Screenshots for `README.md`:** Never copy `.ui-verify/` fixture screenshots ("999 GLASS" fake tracks/palette) into `docs/screenshots/`. Public screenshots must use live catalogue data and real themes.

---

## 5. Commands & Verification

| Task | Command |
|---|---|
| Renderer typecheck + Vite build | `npm run build` |
| Electron main typecheck | `npm run typecheck:electron` |
| Main-process tests | `npm run test:electron` |
| Script & utility tests | `npm run test:scripts` |
| Platform / offline targeted tests | `npm run test:platform` / `npm run test:offline-library` |
| Terminal coverage check | `npm run terminal:check-coverage` |
| UI & WebGPU sensor check | `npm run ui:verify` |
| Discover targeted UI check | `npm run ui:discover` |
| Motion audit | `npm run ui:motion` |
| Smoke test | `npm run electron:smoke` |
| Package installer (visible terminal) | `npm run electron:build` |

Before concluding a milestone: run `npm run build`, `npm run typecheck:electron`, `npm run test:electron`, `npm run test:scripts`, `git diff --check`, plus `ui:verify` / `ui:motion` for UI/GPU changes and `terminal:check-coverage` if `lib/` changed. Node 22.

---

## 6. Known Desktop & Glass Pitfalls

1. **Discover / backdrop artwork sync:** Always resolve cover artwork through `backdropArt` in `lib/skins.ts` so theme selection and cover-color toggle stay synchronized across Discover, AmbientBackdrop, and WebGPU glass.
2. **Electron-builder schema:** `desktopName` belongs at the root of `package.json`, never inside `build.linux`. Run `scripts/release-config.test.cjs` after editing `package.json` `build`.
3. **Windows CRLF preservation:** Never run Git Bash `sed -i` on CRLF files; use Node/Python with preserved line endings.
4. **999 FM live lag:** Never read `getAudioCurrentTime` or raw `elapsed_ms + wallTime` for FM lyrics; use `radioFmSeconds` / `playingSeconds` (`desktop/playClock.ts`).
5. **Virtualization:** Every long list/grid (Catalogue, Playlists list/compact/grid, Liked, Files, Queue) must stay windowed (`hooks/useVirtualWindow.ts`).
6. **Cover image reuse & stalls:** An `<img>` reused by React key never re-fires `onLoad`; always check `img.complete` and keep `FallbackImg` `stallMs` fallback.
7. **ALAC playback:** Chromium reports `audio/mp4` playable even for ALAC `.m4a` it cannot decode; desktop sniffs via `electron/alac.js` and transcodes to FLAC via on-demand FFmpeg (`FFMPEG_SHA256` hashes validated by `electron/toolChecksums.test.js`).
8. **Offline library integrity:** Only `ENOENT` means empty library; never overwrite a transiently unreadable `offline-library.json`. Save atomically via temp file + rename.
9. **Float windows (`?float=`):** Stores mutated from Settings pop-out must sync via `storage` events or `windowSync`. Never bounce to `backView` when `IS_FLOAT_WINDOW`. Use `playingLength` from synced position when `track.duration` is missing.
10. **Electron permissions & CDP testing:** Web APIs like `fileSystem` must be allowed in both permission check and request handlers (`electron/microphonePermission.js`). Always pass `--user-data-dir=<scratch>` when running test Electron instances (single-instance lock exits 0 silently otherwise).
11. **Albums navigation order:** Call `setAlbumsSelectedId(id)` BEFORE `setActiveView('albums')` so browser history gets one entry with `?id=`.
12. **Display twins:** Always name monitors via `displayName(d, all)` in `electron/desktop/widgets.js` (never raw `display.label` or `id`).
13. **Lyrics sync:** Single editor inside `LyricsGenModal` Sync tab (`SyncedLyricsTool.tsx`); enhanced LRC word tags parsed by `parseLrc`. Keep `lyrics`/`synced_lyrics` stripped from cached list payloads.
14. **Discord RPC:** Always include live `startTimestamp` and `duration` in the dedupe key; re-send on `discord-rpc-connected`.
15. **macOS unsigned builds:** Keep `build.mac.identity: null` until code-signed; macOS updates use `checkMacUpdate` DMG flow in `main.js`.
