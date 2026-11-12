/* Now Playing - Setup shared by everything: constants, element map, storage, settings, state, helpers, clock, keep-awake, full screen.
 * Classic script: shares one global scope with the other files in js/ (loaded in order, see index.html). */
'use strict';

/* Now Playing — web app for Spotify.
 *
 * No server, no libraries. Login = Spotify "Authorization Code with PKCE" (your own Client ID, stored only in
 * this browser). Now-playing comes from Spotify's Web API; lyrics from LRCLIB (https://lrclib.net).
 *
 * Network use is deliberately small: one /me/player request every ~3.5 s while playing (8 s when paused,
 * none while the app is in the background) and one lyrics request per track.
 */

const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing user-library-read user-library-modify playlist-read-private playlist-read-collaborative';
const REDIRECT = location.origin + location.pathname.replace(/index\.html$/, '');
const DEMO = new URLSearchParams(location.search).has('demo');

const $ = (id) => document.getElementById(id);
const el = {
  bgA: $('bgA'), bgB: $('bgB'), clock: $('clock'), btnLyrics: $('btnLyrics'),
  btnFull: $('btnFull'),
  player: $('player'), idle: $('idle'), setup: $('setup'),
  cover: $('cover'), title: $('title'), artist: $('artist'),
  lyrics: $('lyrics'), lyricsInner: $('lyricsInner'), coverWrap: $('coverWrap'), meta: $('meta'), lyricsNow: $('lyricsNow'),
  seek: $('seek'), tCur: $('tCur'), tDur: $('tDur'),
  prev: $('prev'), play: $('play'), next: $('next'), icoPlay: $('icoPlay'), icoPause: $('icoPause'),
  idleClock: $('idleClock'), idleDate: $('idleDate'), idleMsg: $('idleMsg'), disconnect: $('disconnect'),
  redirectUri: $('redirectUri'), cid: $('cid'), connect: $('connect'), setupMsg: $('setupMsg'),
  toast: $('toast'),
  btnDev: $('btnDev'), btnSet: $('btnSet'),
  shuf: $('shuf'), rep: $('rep'), icoRep: $('icoRep'), icoRep1: $('icoRep1'),
  like: $('like'), icoLike: $('icoLike'), icoLiked: $('icoLiked'),
  vol: $('vol'), volFill: $('volFill'), volNum: $('volNum'),
  devSheet: $('devSheet'), devList: $('devList'), setSheet: $('setSheet'),
};

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};

// ------------------------------------------------------------------ settings (this browser only)
const cfg = { lscale: 1, clock: true, awake: true, autohide: true, lstyle: 'scroll', genre: true, autosize: true };
try { Object.assign(cfg, JSON.parse(store.get('cfg') || '{}')); } catch (e) { /* defaults */ }

// ------------------------------------------------------------------ state
const S = {
  token: null,                 // {access, refresh, exp}
  trackId: null, track: null,
  playing: false,
  anchor: { p: 0, t: 0 },      // progress (ms) at wall-clock time t
  lines: null, lineIdx: -3,
  showLyrics: store.get('showLyrics') !== '0',
  screen: '',
  bgFlip: false,
  pollT: null, lyricAbort: null,
  dragging: false,
  shuffle: false, repeat: 'off', device: null, liked: false, hold: 0,
};

// ------------------------------------------------------------------ helpers
const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const isRTL = (s) => /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(s);

// ---- name + greeting
const demoName = DEMO ? (new URLSearchParams(location.search).get('name') || '') : '';
const getName = () => demoName || (store.get('name') || '').trim();
const hello = () => { const hr = new Date().getHours(); return hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'; };
function renderIdleGreet() { const n = getName(); $('idleGreet').textContent = n ? hello() + ', ' + n : ''; }
function showGreeting() {
  const n = getName(); if (!n) return;
  const g = $('greet');
  $('greetHi').textContent = hello() + ',';
  $('greetName').textContent = n;
  g.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => g.classList.add('show')));
  setTimeout(() => g.classList.remove('show'), 2600);
  setTimeout(() => { g.hidden = true; }, 3300);
}

let toastT;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.toast.classList.remove('show'), 2600);
}

function show(screen) {
  S.screen = screen;
  el.player.hidden = screen !== 'player';
  el.idle.hidden = screen !== 'idle';
  el.setup.hidden = screen !== 'setup';
  el.clock.hidden = screen !== 'player';
  if (screen !== 'player') { el.btnLyrics.hidden = true; document.body.classList.remove('lyrics'); }
  if (screen === 'idle') { tickClock(); renderIdleGreet(); }
  if (screen === 'player' && window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches && !store.get('hintKeys')) {
    store.set('hintKeys', '1'); setTimeout(() => toast('Tip: press ? to see the keyboard shortcuts'), 3500);
  }
  if (screen === 'player') armHide(); else document.body.classList.remove('chrome-off');
}

// ------------------------------------------------------------------ clock
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const toArabicDigits = (x) => String(x).replace(/[0-9]/g, (dg) => AR_DIGITS[+dg]).replace(/\bAM\b/i, 'ص').replace(/\bPM\b/i, 'م');
// a song counts as Arabic by its script (title, artist, lyrics) or by the Arabic look, not only by the look:
// an Arabic pop song keeps the pop look but still gets Arabic numerals and an Arabic greeting
function arabicSong() { return !!(S.track && (S.gfam === 'arabic' || arabicByScript(S.track))); }

function tickClock() {
  const now = new Date();
  const t = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const ar = S.screen === 'player' && arabicSong();                // Arabic song: Arabic numerals (and AM/PM) on the player clock
  el.clock.textContent = ar ? toArabicDigits(t) : t;
  el.clock.classList.toggle('ar', ar);
  el.idleClock.textContent = t;
  el.idleDate.textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}
setInterval(tickClock, 15000);

// ------------------------------------------------------------------ keep the screen awake
// 1) the Screen Wake Lock API where it works; 2) on iPhone / iPad (home-screen apps before iOS 18.4 accept the request but
// never hold it) and wherever the API is missing or refused, a 1.6 KB invisible looping video, which makes the OS think media
// is playing and keeps the screen on. The Settings row says which of the two is active.
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const SLEEP_MP4 = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAANDbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAm50cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAABAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAAAAABAAAAAAHmbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAgABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABkW1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAVFzdGJsAAAAuXN0c2QAAAAAAAAAAQAAAKlhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAQABIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMiBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAAL2F2Y0MBQsAK/+EAF2dCwArZBCbARAAAAwAEAAADACA8SJkgAQAFaMuDyyAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAALWAAAAAAAAAAYc3R0cwAAAAAAAAABAAAACAAAEAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAACAAAAAEAAAA0c3RzegAAAAAAAAAAAAAACAAAAo8AAAAKAAAACwAAAAoAAAAKAAAACgAAAAoAAAAKAAAAFHN0Y28AAAAAAAAAAQAAA3MAAABhdWR0YQAAAFltZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAACxpbHN0AAAAJKl0b28AAAAcZGF0YQAAAAEAAAAATGF2ZjYzLjEuMTAyAAAACGZyZWUAAALebWRhdAAAAnAGBf//bNxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgcjMyMjMgMDQ4MGNiMCAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0wIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDE6MHgxMTEgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTAgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0yIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MCB3ZWlnaHRwPTAga2V5aW50PTI1MCBrZXlpbnRfbWluPTQgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAXZYiEBLyYoAA4oycnJ1111111111114AAAAAGQZo4CXhGAAAAB0GaVAJeEYAAAAAGQZpgEvCMAAAABkGagBLwjAAAAAZBmqAS8IwAAAAGQZrAEfCMAAAABkGa4BDwjA==';
let wake = null, sleepVideo = null;
S.awake = '';                                                       // '', 'lock', 'video', 'none'

function setAwakeStatus() {
  S.awake = !cfg.awake ? '' : (wake ? 'lock' : (sleepVideo && !sleepVideo.paused ? 'video' : 'none'));
  const e = $('awakeInfo');
  if (!e) return;
  e.textContent = !cfg.awake ? 'Off: the screen can turn off by itself.'
    : S.awake === 'lock' ? 'On: using the Screen Wake Lock.'
    : S.awake === 'video' ? 'On: using the invisible-video workaround' + (wake ? ' together with the Wake Lock.' : '.')
    : 'Not holding the screen yet. Touch the screen once; if it still says this, set Auto-Lock to Never in your device settings' + (IOS ? ' (Settings > Display & Brightness > Auto-Lock).' : '.');
}
function startSleepVideo() {
  if (!sleepVideo) {
    sleepVideo = document.createElement('video');
    sleepVideo.setAttribute('playsinline', ''); sleepVideo.setAttribute('webkit-playsinline', '');
    sleepVideo.muted = true; sleepVideo.loop = true; sleepVideo.setAttribute('aria-hidden', 'true');
    sleepVideo.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:.02;pointer-events:none;z-index:-1';
    sleepVideo.src = SLEEP_MP4;
    sleepVideo.addEventListener('pause', setAwakeStatus); sleepVideo.addEventListener('playing', setAwakeStatus);
    document.body.appendChild(sleepVideo);
  }
  if (sleepVideo.paused) { const p = sleepVideo.play(); if (p && p.catch) p.catch(() => { /* needs a touch first: lockScreen runs again on the next one */ }); }
}
function stopAwake() {
  if (wake) { try { wake.release(); } catch (e) { /* ignore */ } wake = null; }
  if (sleepVideo) sleepVideo.pause();
  setAwakeStatus();
}
async function lockScreen() {
  if (!cfg.awake) { stopAwake(); return; }
  try {
    if ('wakeLock' in navigator && !wake && document.visibilityState === 'visible') {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; setAwakeStatus(); });
    }
  } catch (e) { wake = null; }                                      // refused (battery saver, not visible, no support)
  if (IOS || !wake) startSleepVideo();                              // iOS: always both; elsewhere only when the Wake Lock isn't held
  else if (sleepVideo) sleepVideo.pause();
  setAwakeStatus();
}

// (Re)request the wake lock on any touch: browsers release it when the page goes to the background.
['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
  window.addEventListener(ev, lockScreen, { passive: true, capture: true }));

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(S.pollT); }
  else { lockScreen(); if (!DEMO && S.token) poll(); }
});

// ------------------------------------------------------------------ full screen
// Android / desktop / iPad: Fullscreen API. iPhone Safari has none for web pages: the way to get full screen
// there is to install the app (Share -> Add to Home Screen) and open it from the home screen.
const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
if (standalone) document.body.classList.add('standalone');

const rootEl = document.documentElement;
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
const canFullscreen = !!(rootEl.requestFullscreen || rootEl.webkitRequestFullscreen);

// Fallback when the browser can't / won't do real full screen: explain the iPhone fix, or just hide the buttons.
const sheet = $('sheet'), exitZone = $('exitZone');
function setImmersive(on) {
  document.body.classList.toggle('immersive', on);
  exitZone.hidden = !on;
  if (on) toast('Tap the top-right corner to bring the buttons back');
}
$('sheetOk').addEventListener('click', () => { sheet.hidden = true; });
$('sheetHide').addEventListener('click', () => { sheet.hidden = true; setImmersive(true); });
exitZone.addEventListener('click', () => setImmersive(false));

function toggleFullscreen() {
  if (document.body.classList.contains('immersive')) { setImmersive(false); return; }
  if (!canFullscreen && !fsElement()) { sheet.hidden = false; return; }
  const refused = () => { sheet.hidden = false; };
  try {
    // both calls return a Promise in modern browsers (the old webkit one returns undefined)
    const p = fsElement()
      ? (document.exitFullscreen || document.webkitExitFullscreen).call(document)
      : (rootEl.requestFullscreen || rootEl.webkitRequestFullscreen).call(rootEl, { navigationUI: 'hide' });
    if (p && typeof p.catch === 'function') p.catch(refused);
  } catch (e) { refused(e); }
}
el.btnFull.addEventListener('click', () => { el.setSheet.hidden = true; toggleFullscreen(); });
['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) => document.addEventListener(ev, () => {
  const on = !!fsElement();
  el.btnFull.textContent = on ? 'Exit' : 'Enter';
  lockScreen();
}));
