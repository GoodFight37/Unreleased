# Unreleased Glass

Juice WRLD's unreleased catalogue, with a cover-led interface and Liquid Glass controls.
Built from [Unreleased](https://github.com/Juice-WRLD-API/Unreleased), powered by the
[Juice WRLD API](https://juicewrldapi.com).

## What's different

- **Discover, Catalogue, Collection.** Three main destinations, larger covers
  and exploration through Juice WRLD's eras. Collection opens your playlists
  directly, with liked songs, albums and local files alongside them.
  Discover follows the selected song with catalogue credits, dates and notes.
- **Glass where it floats.** The navigation, player, menus and dialogs keep
  their glass treatment; music lists stay crisp and readable.
  All three destinations share the same ambient backdrop.
- **Dark, Light and album themes.** The saved palette is restored before
  the main interface loads.
- **Simple settings.** Everyday music controls stay visible. Technical tools
  and detailed customization live behind Developer mode, without removing
  saved preferences. Settings open large inside the main window.
- **Clearer listening.** Version groups offer direct playback, missing audio
  is distinguished from playable versions, and WRLD has a visible return action.
  Pause 999 FM and resume on the live stream without leaving the station.
- **A compiled launch.** The Windows launcher opens the built application
  directly instead of starting a development server every time. It starts on
  Discover in normal mode and uses its own data profile, importing existing
  preferences once without overwriting the original player's profile.
- **Connected panels.** Notifications link directly to the news page;
  notifications and downloads share a neutral, translucent glass finish.

![Discover](docs/screenshots/home.png)

Screenshots use a local verification track in the player; catalogue artwork
comes from the API.

## Windows

An installer has not been published yet. The current local version opens with
**Lancer Unreleased Glass.cmd** (or its desktop shortcut).
An installable `.exe` will be a separate release after application validation.

For the original player's downloads and full feature list, see
[Unreleased](https://github.com/Juice-WRLD-API/Unreleased#readme).

<details>
<summary>Build from source and contribute</summary>

Requires Node.js 22 and npm.

```bash
npm install
npm run build
```

Then open `Lancer Unreleased Glass.cmd` on Windows. After editing sources,
run `npm run build` again before using this launcher.

Close the original player and earlier Glass windows before the first launch
with the separate profile. An active browser database stops the import so its
preferences can be copied safely. Offline downloads are copied into Glass's
own storage, which can require extra disk space; the originals stay untouched.
Your scanned music-folder paths are preserved.

The development server is optional and reserved for development.
Verification: `npm run typecheck:electron`, `npm run test:electron`,
`npm run test:scripts`, `npm run ui:verify`, `npm run ui:discover`, `npm run ui:motion`.

See [validation and known limits](docs/VALIDATION.md) for the current audit baseline.
The [next WRLD project](docs/WRLD-STORIES.md) builds on the existing full-screen
lyrics experience, with optional layouts for shareable videos. It is a proposal.

</details>

## Credits and license

The original player, API and catalogue are the work of the Unreleased team.
This fork keeps the [MIT license](LICENSE), copyright leanwrldd.
Bundled third-party licenses are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
