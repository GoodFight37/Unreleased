# Validation and audit baseline

Snapshot: November 17, 2026, branch `liquid-glass`. The two earlier external
audits inspected `bab31378`, before these corrections. Review the current branch
or pin its commit when producing a new audit. This is a source snapshot, not an
installer release or a claim that every feature has been tested.

## Corrections in this snapshot

- Separate compiled/packaged data profile, with a one-time import that preserves
  the original player's data. Imported offline audio and covers receive independent
  copies; index paths and the download destination point into Glass storage.
- Normal startup opens Discover. Collection opens playlists, with direct access
  to liked songs, albums and local files; returning from these stays in Collection.
- Discover, Catalogue and Collection share an ambient backdrop. Navigation has
  no brand badge. The selected track's catalogue credits, original date labels and
  notes appear beside its artwork, with a full-details action. Missing metadata
  stays missing. Loading, empty and failed catalogue states offer a useful action.
- Search, shortcut labels and navigation use consistent listening-page names,
  retaining original search aliases and saved shortcut identifiers. Terminal,
  DevTools and direct archive navigation remain behind Developer mode.
- 999 FM pause detaches its audio source safely. Resume joins the live broadcast;
  clocks, lyrics, scrobbling, Discord presence, widgets, tray and media commands
  follow its paused state. Track-only actions are disabled for live radio.
- Catalogue session playback keeps the selected track's place in its queue.
  Version-group playback respects the displayed version, and unresolved session
  placeholders do not count as playable bulk selections or preloads.
- Notifications link to News. Notifications and downloads use the same neutral
  translucent material and respect reduced transparency.
- Desktop CI includes `liquid-glass`; the obsolete arena-branch packaging trigger
  is removed. The installer workflow remains available manually.
- Optional yt-dlp installation resolves one release tag for both binary and
  checksum, verifies the exact asset before replacement, and preserves reuse and
  explicit updates. Third-party notices are included as packaging resources.
  Product name is Unreleased Glass; its application identifier remains stable.

## Local results

| Check | Observed result |
| --- | --- |
| `npm run build` | Exit 0, including renderer type checking |
| `npm run typecheck:electron` | Exit 0 |
| `npm run test:electron` | 127 passed, 0 failed |
| `npm run test:scripts` | 120 passed, 0 failed |
| `npm run ui:verify` | Exit 0; 28 navigation/usability checks passed; no page errors, console errors or blocking failures |
| `npm run ui:discover` | Exit 0; 6 checks covering selected-track changes, shared file paths, partial data, keyboard focus, responsive layout, empty/error/loading states |
| `npm run ui:motion` | Exit 0; 1,252 animation observations recorded; existing skeleton delays and modal transitions remain in the report |
| `git diff --check` | Exit 0 |
| `npm run terminal:check-coverage` | Exit 1; existing 26-function gap remains, 478/504 covered |

UI checks run against the compiled Electron renderer, with temporary profiles and
muted audio. Discover fixtures are explicitly fictional test data; the product
uses catalogue metadata. Screenshots and full local sensor reports are written
to `.ui-verify/`. Existing Vite chunk-size and module warnings remain.

The first remote Windows run for `922ec49a` exposed a line-ending dependency in
`skins-contrast.test.cjs`: its source-text parser found no themes after a CRLF
checkout. Build and Electron tests passed; Linux passed. The test now normalizes
line endings before parsing. All eight theme checks were verified against both
LF and CRLF input; no palette or application behavior changed for this fix.
The replacement [desktop CI run](https://github.com/GoodFight37/Unreleased/actions/runs/44102382835)
for `427ffa31` passed on both Windows and Linux, including the Electron launches.

On the tested Windows/NVIDIA machine, the final general UI pass measured a
165.2 fps compositor, 164.9 fps WRLD animation and 0.09 ms Glass Lab GPU p95.
These are local measurements, not guarantees for other hardware.

A separate muted test decoded the real 999 FM stream using both MSE and HTTP
fallback, then paused and resumed it without restarting a previous queued song.
Profile tests operate on temporary data, including independent offline files and
retry after a failed import; they do not migrate a real personal profile.

## Known limits and next work

- The terminal coverage command still reports the pre-existing 26 uncovered
  functions/helpers. No new API request function is introduced by this snapshot.
- No installer was built or published for this snapshot. Packaging resources are
  configured, but actual installer contents and packaged Electron fuses require
  a packaging check. Raw Electron development launches do not apply package fuses.
- Real personal-profile migration, forced interruption during import, macOS/Linux
  migration, physical media keys, actual external widget/Discord displays and
  audio quality by ear were not verified. The first import needs the old player
  closed and space for an independent copy of offline downloads.
- The optional downloader was tested with mocked release/download responses;
  no real tool binary was downloaded for these checks. Checksums come from the
  release publisher; this is not independent signature verification.
- GPU performance on modest hardware and exhaustive accessibility across every
  view, role, skin and artwork remain unmeasured. Local UI checks do not substitute
  for manual listening and interaction review.
- The skull-logo direction was rejected after visual review. No new logo is
  selected or integrated; the next reference will come from the project owner.
  No external fan drawing was added. The existing full-screen WRLD view is preserved.
- Share Studio and LyricsEdit integration are on hold. The next proposed project
  is [shareable WRLD videos](WRLD-STORIES.md), built on the current full-screen
  experience, with optional alternative layouts rather than mandatory vertical video.

The repository's default branch remains `app`. Changes and these notes are on
[`liquid-glass`](https://github.com/GoodFight37/Unreleased/tree/liquid-glass).
