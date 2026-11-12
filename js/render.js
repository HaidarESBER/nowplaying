/* Now Playing - Rendering the player: new track, cover + background, progress, play state.
 * Classic script: shares one global scope with the other files in js/ (loaded in order, see index.html). */
'use strict';

// ------------------------------------------------------------------ rendering
const SWAP_MS = 220;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const preload = (url) => new Promise((res) => {
  if (!url) return res();
  const im = new Image();
  im.onload = im.onerror = () => res();
  im.src = url;
  setTimeout(res, 1500);                       // never wait forever on a slow image
});

function newTrack(t) {
  const first = !S.track;
  S.trackId = t.id;
  S.track = t;
  S.liked = false; renderLike(); loadLiked(t); loadGenre(t);
  el.tDur.textContent = fmt(t.dur);
  el.seek.max = Math.max(1, Math.floor(t.dur / 1000));

  // lyrics: keep the current layout, fade the old text out while the new ones load
  S.lines = null; S.lineIdx = -3;
  el.lyrics.classList.add('loading');
  if (!DEMO) loadLyrics(t);

  const apply = () => {
    if (S.trackId !== t.id) return;            // skipped again meanwhile
    el.title.textContent = t.title;
    el.artist.textContent = t.album && t.album !== t.title ? t.artist + '  ·  ' + t.album : t.artist;
    el.cover.src = t.art || '';
    setWash(t.art);
    tickClock(); renderAmbient();
    paletteOf(t.art).then((p) => { if (S.trackId === t.id) applyPalette(p); });
    el.coverWrap.classList.remove('swap'); el.meta.classList.remove('swap');
  };
  if (first) { apply(); } else {
    el.coverWrap.classList.add('swap'); el.meta.classList.add('swap');
    Promise.all([preload(t.art), sleep(SWAP_MS)]).then(apply);
  }

  if ('mediaSession' in navigator) {
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork: t.art ? [{ src: t.art }] : [] }); } catch (e) { /* ignore */ }
  }
  tick(true);
}

function setWash(url) {
  const on = S.bgFlip ? el.bgA : el.bgB, off = S.bgFlip ? el.bgB : el.bgA;
  S.bgFlip = !S.bgFlip;
  on.style.backgroundImage = url ? 'url("' + url + '")' : 'none';
  on.classList.add('on');
  off.classList.remove('on');
}

function renderPlayState() {
  // SVG elements have no .hidden property, so toggle the attribute directly
  el.icoPlay.toggleAttribute('hidden', S.playing);
  el.icoPause.toggleAttribute('hidden', !S.playing);
  document.body.classList.toggle('paused', !S.playing);
}

function position() {
  let p = S.anchor.p;
  if (S.playing) p += Date.now() - S.anchor.t;
  const d = S.track ? S.track.dur : 0;
  return Math.max(0, d ? Math.min(p, d) : p);
}

// progress + lyric line: a light 2 Hz tick (cheap; only touches the DOM when something changed)
let lastSecond = -1;
function tick(force) {
  if (S.screen !== 'player' || !S.track) return;
  const p = position();
  const sec = Math.floor(p / 1000);
  if (sec !== lastSecond || force) {
    lastSecond = sec;
    if (!S.dragging) {
      el.seek.value = sec;
      el.seek.style.setProperty('--p', (S.track.dur ? (p / S.track.dur) * 100 : 0) + '%');
      el.tCur.textContent = fmt(p);
    }
  }
  updateLyricLine(p);
}
setInterval(() => tick(false), 500);
