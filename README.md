# Unreleased Glass

Juice WRLD's unreleased catalogue, with a cover-led interface and Liquid Glass controls.
Built from [Unreleased](https://github.com/Juice-WRLD-API/Unreleased), powered by the
[Juice WRLD API](https://juicewrldapi.com).

## What's different

- **Discover, Catalogue, Collection.** Three main destinations, larger covers
  and exploration through Juice WRLD's eras.
- **Glass where it floats.** The navigation, player, menus and dialogs keep
  their glass treatment; music lists stay crisp and readable.
- **Dark, Light and album themes.** The saved palette is restored before
  the main interface loads.
- **Simple settings.** Everyday music controls stay visible. Technical tools
  and detailed customization live behind Developer mode, without removing
  saved preferences. Settings open large inside the main window.
- **Clearer listening.** Version groups offer direct playback, missing audio
  is distinguished from playable versions, and WRLD has a visible return action.
- **A compiled launch.** The Windows launcher opens the built application
  directly instead of starting a development server every time.

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

The development server is optional and reserved for development.
Verification: `npm run typecheck:electron`, `npm run test:electron`,
`npm run test:scripts`, `npm run ui:verify`, `npm run ui:motion`.

</details>

## Credits and license

The original player, API and catalogue are the work of the Unreleased team.
This fork keeps the [MIT license](LICENSE), copyright leanwrldd.
Bundled third-party licenses are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
