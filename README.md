<div align="center">

# Now Playing

**An always-on Spotify "now playing" screen for an old phone or tablet.**
Big cover art, live scrolling lyrics, transport controls. It stays awake, and it's a static web page: no server, no libraries, no tracking.

<p>
<a href="https://github.com/HaidarESBER/nowplaying/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/HaidarESBER/nowplaying/actions/workflows/ci.yml/badge.svg"></a>
<a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
<a href="https://haidaresber.github.io/nowplaying/?demo"><img alt="Live demo" src="https://img.shields.io/badge/demo-live-1db954.svg"></a>
<img alt="PWA" src="https://img.shields.io/badge/PWA-installable-5a0fc8.svg">
<img alt="No dependencies" src="https://img.shields.io/badge/dependencies-none-lightgrey.svg">
</p>

<img src="docs/demo.gif" alt="Demo: synced lyrics scrolling in landscape, English then Arabic" width="720">

[**Live demo (no Spotify needed)**](https://haidaresber.github.io/nowplaying/?demo) · [Set it up](#set-it-up-10-minutes-free) · [How it works](#how-it-works)

</div>

## Screenshots

| Landscape + lyrics | Landscape, cover only | Arabic / right-to-left |
|---|---|---|
| ![](docs/landscape-lyrics.png) | ![](docs/landscape-cover.png) | ![](docs/arabic.png) |

| Portrait + lyrics | Portrait, cover only | Connect screen | Idle clock |
|---|---|---|---|
| <img src="docs/portrait-lyrics.png" width="200"> | <img src="docs/portrait-cover.png" width="200"> | <img src="docs/setup.png" width="200"> | ![](docs/idle.png) |

| Device switcher | Settings |
|---|---|
| ![](docs/devices.png) | <img src="docs/settings.png" width="200"> |

*Screenshots use the built-in demo mode (fake songs), so no real artwork is shown.*

## Features

- **Now playing**: cover, title, artist, progress bar, play / pause / next / previous / seek.
- **Shuffle and repeat** (off / all / one) buttons beside the transport controls.
- **Like**: a heart next to the artist adds the song to your Liked Songs, and shows when it already is.
- **Volume**: swipe up or down on the cover (scroll wheel on desktop).
- **Device switcher**: the speaker button in the top bar moves playback to any of your Spotify Connect devices.
- **Settings**: lyric size (S to XL), show or hide the clock, and keep-screen-awake on or off. Saved in this browser.
- **Synced lyrics** from [LRCLIB](https://lrclib.net) that scroll with the song, big and readable from across the room. Works with right-to-left languages. One lyrics button hides or shows them.
- **Tap a lyric line to jump there**: Spotify seeks to that line of the song (needs Premium, like the other controls).
- **Colours from the cover**: the background is a blurred wash of the current album art.
- **Layouts for both orientations**, with or without lyrics.
- **Always on**: Screen Wake Lock keeps the display awake, and the app never changes your brightness.
- **Full screen** button (Android, desktop, iPad). On iPhone, install it to the home screen for a bar-free full screen.
- **Idle mode**: a large clock when nothing is playing.
- **Light on the network**: one Spotify request every ~3.5 s while playing, every 8 s when paused, none in the background.
- **Private**: your Spotify login stays in your browser (PKCE, no client secret). The only other request is one lyrics lookup per song.

## Set it up (10 minutes, free)

You need **Spotify Premium** (Spotify only lets Premium accounts control playback) and a GitHub account.

### 1. Get your own copy online

**Option A, one command** (needs the [GitHub CLI](https://cli.github.com), logged in with `gh auth login`):

```bash
./setup.sh          # macOS / Linux / Git Bash
.\setup.ps1         # Windows PowerShell
```

It forks this repo, turns on GitHub Pages and prints your two values: the **site address** and the **Redirect URI**.

**Option B, by hand**: click **Fork**, then in your fork go to *Settings -> Pages -> Deploy from a branch -> `main` / root*.
Your address will be `https://YOUR-NAME.github.io/nowplaying/`.

### 2. Create a Spotify app (the one step that can't be automated)

1. Open the [Spotify developer dashboard](https://developer.spotify.com/dashboard) and choose **Create app**.
2. Name it anything. Tick **Web API**.
3. Under **Redirect URIs**, add your site address *exactly*, including the trailing `/`:
   `https://YOUR-NAME.github.io/nowplaying/`
4. Save, then copy the **Client ID**. (Open your site: the connect screen also shows the exact Redirect URI to copy.)

### 3. Connect

- **iPhone**: open your site in Safari -> Share -> **Add to Home Screen**. Open it **from the home-screen icon**, paste the Client ID, tap **Connect**, and log in to Spotify.
- **Android**: open the site in Chrome, paste the Client ID, tap **Connect**. Optionally *Install app* from the menu.

Start playing in the Spotify app and it appears within a few seconds.

> **Tip:** do the login inside the installed home-screen app on iPhone. Logging in from Safari and then installing means logging in again, because the two don't share storage.

### Try it without Spotify

Add `?demo` to the address. `?demo=idle` and `?demo=setup` show the other screens. Extra knobs for screenshots: `&n=1` (second song), `&t=40` (start at 40 s), `&ly=0` (hide lyrics).

## Troubleshooting

| Problem | Fix |
|---|---|
| "INVALID_CLIENT: Invalid redirect URI" | The Redirect URI in the Spotify dashboard must match the site address exactly (trailing `/`, `https`, same capitalisation). |
| Nothing shows after login | Press play in Spotify first. The web API only reports an active playback device. |
| Buttons do nothing | Controlling playback needs Premium. |
| The heart asks to reconnect | Likes need two extra Spotify permissions. Tap the heart again (or Settings -> Reconnect) and approve once. |
| Volume swipe says the device sets its own volume | Some devices, such as iPhones running Spotify, don't let other apps change their volume. |
| Screen turns off on iPhone | Screen Wake Lock needs iOS 16.4+, and works best from the home-screen app. |
| Full screen button shows a guide on iPhone | Safari can't do real full screen. Use the home-screen app instead. |
| No lyrics for a song | LRCLIB doesn't have every track. The cover layout is used instead. |

## How it works

<p align="center"><img src="docs/architecture.svg" alt="Architecture diagram: GitHub Pages serves static files to the browser, which talks to Spotify and LRCLIB" width="860"></p>

Plain HTML, CSS and JS in three files (`index.html`, `style.css`, `app.js`), no build step.

- **Auth**: Spotify Authorization Code with PKCE. Only your Client ID is stored, in `localStorage`; there is no secret to leak.
- **State**: polls `GET /v1/me/player` and interpolates the progress locally between polls. Controls are `PUT/POST /v1/me/player/*`, with an optimistic play/pause toggle.
- **Lyrics**: LRCLIB `get` with a `search` fallback, parsed from LRC, scrolled with the DOM.
- **Layout**: CSS grid areas per orientation, with and without lyrics.

## Limits

- A web page cannot hear other apps' audio, so there is no audio-reactive equalizer here. (The Android sibling app has one.)
- Spotify only. The web API needs the Spotify app (or another Spotify Connect device) to be playing.
- iPhone Safari has no real full screen, only the home-screen route above.

## Privacy

No analytics, no cookies, no server of mine. Requests go to Spotify (to play/control) and LRCLIB (lyrics), and your Spotify tokens never leave your browser.

## License

MIT. See [LICENSE](LICENSE). Not affiliated with Spotify. Spotify is a trademark of Spotify AB.
