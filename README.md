# Now Playing (web app)

An always-on "now playing" screen for Spotify: cover, scrolling synced lyrics, play / pause / next / previous / seek.
Works on iPhone and Android (add it to the home screen). No server, no libraries, no tracking.

## Set it up (about 10 minutes, free)

1. **Host the files** (they must be served over HTTPS). Easiest: GitHub Pages.
   - Create a repository, upload everything in this folder, then Settings -> Pages -> deploy from the `main` branch.
   - You get an address like `https://YOURNAME.github.io/REPO/`.
2. **Create a Spotify app**: https://developer.spotify.com/dashboard -> *Create app*, tick *Web API*,
   and add your site address (with the trailing `/`) as a **Redirect URI**. Copy the **Client ID**.
3. **On the iPhone**: open the address in Safari -> Share -> **Add to Home Screen**.
   Then open it **from the home screen** (not from Safari), paste the Client ID, tap *Connect*, log in to Spotify.
4. Start playing in the Spotify app. Controlling playback needs Spotify **Premium**.

## What it does / doesn't do

- Keeps the screen awake (Screen Wake Lock, iOS 16.4+) and, after 20 s without a touch, puts a black veil over it
  (saves power on OLED iPhones; the first tap only wakes it).
- Lyrics: LRCLIB (https://lrclib.net), one request per song. Tap the lyrics button (top right) to hide / show them.
- Network: one Spotify request every ~3.5 s while playing (8 s paused, none in the background).
- Not possible in a web app: the audio equalizer graph (browsers can't tap another app's audio) and real
  screen-brightness control.

## Try it without Spotify

Open `index.html?demo` (any web server) for a demo with fake songs. `?demo=idle` and `?demo=setup` show the other screens.
