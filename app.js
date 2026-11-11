/* Now Playing — web app for Spotify.
 *
 * No server, no libraries. Login = Spotify "Authorization Code with PKCE" (your own Client ID, stored only in
 * this browser). Now-playing comes from Spotify's Web API; lyrics from LRCLIB (https://lrclib.net).
 *
 * Network use is deliberately small: one /me/player request every ~3.5 s while playing (8 s when paused,
 * none while the app is in the background) and one lyrics request per track.
 */
(() => {
  'use strict';

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
  const cfg = { lscale: 1, clock: true, awake: true, autohide: true, lstyle: 'scroll', genre: true };
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
  function tickClock() {
    const now = new Date();
    const t = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    el.clock.textContent = t;
    el.idleClock.textContent = t;
    el.idleDate.textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  }
  setInterval(tickClock, 15000);

  // ------------------------------------------------------------------ keep awake + night dim
  let wake = null;
  async function lockScreen() {
    try {
      if (cfg.awake && 'wakeLock' in navigator && !wake) {
        wake = await navigator.wakeLock.request('screen');
        wake.addEventListener('release', () => { wake = null; });
      }
    } catch (e) { /* not allowed right now */ }
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

  // ------------------------------------------------------------------ Spotify auth (PKCE)
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const rand = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, (b) => CHARS[b % CHARS.length]).join(''); };
  async function challengeOf(v) {
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
    return btoa(String.fromCharCode(...new Uint8Array(h))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function startLogin(clientId) {
    store.set('cid', clientId);
    const verifier = rand(96);
    const state = rand(16);
    store.set('verifier', verifier);
    store.set('state', state);
    const q = new URLSearchParams({
      client_id: clientId, response_type: 'code', redirect_uri: REDIRECT,
      code_challenge_method: 'S256', code_challenge: await challengeOf(verifier),
      scope: SCOPES, state,
    });
    location.href = 'https://accounts.spotify.com/authorize?' + q;
  }

  async function tokenRequest(params) {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: store.get('cid') || '', ...params }),
    });
    if (!r.ok) throw new Error('token ' + r.status);
    const j = await r.json();
    S.token = {
      access: j.access_token,
      refresh: j.refresh_token || (S.token && S.token.refresh),
      exp: Date.now() + (j.expires_in - 60) * 1000,
      scope: j.scope || (S.token && S.token.scope) || '',
    };
    store.set('tok', JSON.stringify(S.token));
  }

  async function handleRedirect() {
    const q = new URLSearchParams(location.search);
    if (!q.has('code') && !q.has('error')) return null;
    history.replaceState(null, '', REDIRECT);                       // clean the URL
    if (q.has('error')) return 'Spotify said: ' + q.get('error');
    if (q.get('state') !== store.get('state')) return 'Login state mismatch — please try again.';
    try {
      await tokenRequest({
        grant_type: 'authorization_code', code: q.get('code'),
        redirect_uri: REDIRECT, code_verifier: store.get('verifier') || '',
      });
      return null;
    } catch (e) {
      return 'Could not finish login (' + e.message + '). Check the Redirect URI in your Spotify app.';
    }
  }

  async function ensureToken(force) {
    if (!S.token) throw new Error('no token');
    if (!force && Date.now() < S.token.exp) return;
    if (!S.token.refresh) throw new Error('no refresh token');
    await tokenRequest({ grant_type: 'refresh_token', refresh_token: S.token.refresh });
  }

  async function api(method, path, body, retried) {
    await ensureToken();
    const headers = { Authorization: 'Bearer ' + S.token.access };
    if (body) headers['Content-Type'] = 'application/json';
    const r = await fetch('https://api.spotify.com/v1' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401 && !retried) { await ensureToken(true); return api(method, path, body, true); }
    return r;
  }

  function logout() {
    ['tok', 'verifier', 'state'].forEach(store.del);
    S.token = null;
    clearTimeout(S.pollT);
    showSetup('');
  }

  // ------------------------------------------------------------------ polling
  async function poll() {
    clearTimeout(S.pollT);
    if (document.hidden || !S.token) return;
    let next = 4000;
    try {
      const r = await api('GET', '/me/player?additional_types=episode');
      if (r.status === 204) { setPlayer(null); next = 7000; }
      else if (r.status === 200) { const j = await r.json(); setPlayer(j); next = j.is_playing ? 3500 : 8000; }
      else if (r.status === 429) { next = (parseInt(r.headers.get('Retry-After'), 10) || 5) * 1000 + 500; }
      else if (r.status === 401 || r.status === 403) { toast('Spotify access was refused — reconnect'); next = 15000; }
      else { next = 8000; }
    } catch (e) {
      if (String(e.message).startsWith('token') || e.message === 'no token' || e.message === 'no refresh token') { logout(); return; }
      next = 8000;                                                      // offline etc.
    }
    S.pollT = setTimeout(poll, next);
  }

  function setPlayer(j) {
    if (!j || !j.item) { if (S.screen !== 'idle') show('idle'); S.trackId = null; return; }
    const it = j.item;
    const images = (it.album && it.album.images) || (it.images) || [];
    const track = {
      id: it.id || it.uri,
      title: it.name || '—',
      artist: it.artists ? it.artists.map((a) => a.name).join(', ') : ((it.show && it.show.publisher) || ''),
      album: (it.album && it.album.name) || (it.show && it.show.name) || '',
      art: (images[0] && images[0].url) || '',
      dur: it.duration_ms || 0,
      type: it.type || 'track',
      artistId: (it.artists && it.artists[0] && it.artists[0].id) || '',
    };
    S.playing = !!j.is_playing;
    if (Date.now() > S.hold) {
      S.shuffle = !!j.shuffle_state; S.repeat = j.repeat_state || 'off';
      if (j.device) S.device = j.device;
      renderModes();
    }
    S.anchor = { p: j.progress_ms || 0, t: Date.now() };
    if (S.screen !== 'player') show('player');
    if (track.id !== S.trackId) newTrack(track);
    renderPlayState();
  }

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

  // ------------------------------------------------------------------ lyrics (LRCLIB)
  const TS = /\[(\d+):(\d+)(?:[.:](\d+))?\]/g;
  function parseLrc(lrc) {
    const out = [];
    for (const raw of (lrc || '').split('\n')) {
      TS.lastIndex = 0;
      const times = []; let m, end = 0;
      while ((m = TS.exec(raw))) {
        let ms = 0;
        if (m[3]) { ms = parseInt(m[3], 10); if (m[3].length === 1) ms *= 100; else if (m[3].length === 2) ms *= 10; }
        times.push(parseInt(m[1], 10) * 60000 + parseInt(m[2], 10) * 1000 + ms);
        end = TS.lastIndex;
      }
      if (!times.length) continue;
      const text = raw.slice(end).trim();
      times.forEach((t) => out.push({ t, s: text }));
    }
    return out.sort((a, b) => a.t - b.t);
  }

  async function loadLyrics(t) {
    if (S.lyricAbort) S.lyricAbort.abort();
    const ac = new AbortController(); S.lyricAbort = ac;
    const q = 'track_name=' + encodeURIComponent(t.title) + '&artist_name=' + encodeURIComponent((t.artist || '').split(',')[0]);
    const get = async (url) => {
      const r = await fetch(url, { signal: ac.signal });
      return r.ok ? r.json() : null;
    };
    try {
      let lines = null;
      const exact = await get('https://lrclib.net/api/get?' + q +
        (t.album ? '&album_name=' + encodeURIComponent(t.album) : '') + (t.dur ? '&duration=' + Math.round(t.dur / 1000) : ''));
      if (exact && exact.syncedLyrics) lines = parseLrc(exact.syncedLyrics);
      if (!lines || !lines.length) {
        const list = await get('https://lrclib.net/api/search?' + q);
        for (const it of (list || [])) { const l = parseLrc(it.syncedLyrics); if (l.length) { lines = l; break; } }
      }
      if (S.trackId !== t.id) return;
      if (lines && lines.length) setLyrics(lines); else clearLyrics();
    } catch (e) {
      if (S.trackId === t.id && !ac.signal.aborted) clearLyrics();   // offline: simply no lyrics
    }
  }

  function setLyrics(lines) {
    S.lines = lines; S.lineIdx = -3;
    renderLyrics();
    updateLyricLine(position());
  }
  function clearLyrics() {
    S.lines = null; S.lineIdx = -3;
    renderLyrics();
  }

  function renderLyrics() {
    const wantNow = !!(S.lines && S.lines.length) && S.showLyrics;
    const fill = () => {
      const has = !!(S.lines && S.lines.length);      // read the latest state when the fade ends
      const want = has && S.showLyrics;
      leaveBrowse();
      W = null;
      el.lyricsInner.textContent = '';
      if (has) {
        const frag = document.createDocumentFragment();
        S.lines.forEach((l) => {
          const p = document.createElement('p');
          p.className = 'ln' + (isRTL(l.s) ? ' rtl' : '');
          p.textContent = l.s || '♪';
          p.dir = 'auto';
          frag.appendChild(p);
        });
        el.lyricsInner.appendChild(frag);
      }
      el.btnLyrics.hidden = !has;
      document.body.classList.toggle('lyrics', want);
      el.lyricsInner.style.transition = 'none';
      el.lyricsInner.style.transform = 'translateY(0)';
      requestAnimationFrame(() => {
        el.lyricsInner.style.transition = '';
        centerLine(S.lineIdx, true);
        el.lyrics.classList.remove('loading');   // fade the new lyrics in
        el.player.classList.remove('relayout');
      });
    };
    // switching between the lyrics layout and the plain layout is a jump: hide it behind a short fade
    if (wantNow !== document.body.classList.contains('lyrics') && S.screen === 'player') {
      el.player.classList.add('relayout');
      setTimeout(fill, 160);
    } else fill();
  }

  function updateLyricLine(p) {
    if (!S.lines || !S.lines.length) return;
    const t = p + 250;
    let idx = -1;
    for (let i = 0; i < S.lines.length; i++) { if (S.lines[i].t <= t) idx = i; else break; }
    if (idx === S.lineIdx) return;
    const old = S.lineIdx;
    S.lineIdx = idx;
    const nodes = el.lyricsInner.children;
    const lo = Math.max(0, Math.min(old < 0 ? 0 : old, idx < 0 ? 0 : idx) - 3);
    const hi = Math.min(nodes.length - 1, Math.max(old, idx) + 3);
    for (let i = (old === -3 ? 0 : lo); i <= (old === -3 ? nodes.length - 1 : hi); i++) {
      const d = Math.abs(i - idx);
      const n = nodes[i];
      n.classList.toggle('act', d === 0);
      n.classList.toggle('d1', d === 1);
      n.classList.toggle('d2', d === 2);
      n.classList.toggle('nx', i === idx + 1);
    }
    prepareWords(idx);
    centerLine(idx, old === -3);
  }

  function centerLine(idx, instant) {
    const nodes = el.lyricsInner.children;
    if (!nodes.length || !el.lyrics.clientHeight) return;
    const i = idx < 0 ? 0 : Math.min(idx, nodes.length - 1);
    const n = nodes[i];
    let y = n.offsetTop + n.offsetHeight / 2;
    if (idx < 0) y -= n.offsetHeight * 1.4;                    // first line waits just below centre
    const shift = el.lyrics.clientHeight / 2 - y;
    B.auto = shift;
    if (B.on) {
      if (!instant) { updateNowPill(); return; }             // the user is browsing: don't pull the lyrics away
      leaveBrowse();                                         // new lyrics / resize: start fresh
    }
    if (instant) el.lyricsInner.style.transition = 'none';
    el.lyricsInner.style.transform = 'translateY(' + shift + 'px)';
    if (instant) requestAnimationFrame(() => { el.lyricsInner.style.transition = ''; });
  }

  window.addEventListener('resize', () => centerLine(S.lineIdx, true));
  window.addEventListener('orientationchange', () => setTimeout(() => centerLine(S.lineIdx, true), 250));

  // ------------------------------------------------------------------ browse the lyrics yourself (drag / wheel)
  const B = { on: false, cur: 0, auto: 0, t: 0, raf: 0, suppressClick: false };

  function lyricBounds() {                                    // translateY range that keeps the first / last line reachable
    const nodes = el.lyricsInner.children;
    if (!nodes.length) return [0, 0];
    const mid = el.lyrics.clientHeight / 2, f = nodes[0], l = nodes[nodes.length - 1];
    return [mid - (l.offsetTop + l.offsetHeight / 2), mid - (f.offsetTop + f.offsetHeight / 2)];
  }
  function updateNowPill() { el.lyricsNow.textContent = B.cur > B.auto ? 'Now ↓' : 'Now ↑'; }
  function setBrowse(v) {
    const [lo, hi] = lyricBounds();
    B.cur = Math.max(lo, Math.min(hi, v));
    el.lyricsInner.style.transition = 'none';
    el.lyricsInner.style.transform = 'translateY(' + B.cur + 'px)';
    updateNowPill();
    return B.cur === lo || B.cur === hi;
  }
  function enterBrowse() {
    if (B.on) return;
    B.on = true; B.cur = B.auto;
    el.lyrics.classList.add('browsing');
    el.lyricsNow.hidden = false;
    updateNowPill();
  }
  function leaveBrowse() {                                     // no animation: used when the lyrics are replaced
    cancelAnimationFrame(B.raf); clearTimeout(B.t);
    B.on = false;
    el.lyrics.classList.remove('browsing');
    el.lyricsNow.hidden = true;
  }
  function exitBrowse() {                                      // glide back to the line that is playing
    if (!B.on) return;
    leaveBrowse();
    el.lyricsInner.style.transition = '';
    centerLine(S.lineIdx, false);
  }
  const armReturn = () => { clearTimeout(B.t); B.t = setTimeout(exitBrowse, 4500); };

  function fling(v) {                                          // keep gliding after a quick swipe
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(48, now - last); last = now;
      const atEdge = setBrowse(B.cur + v * dt);
      v *= Math.pow(0.9, dt / 16);
      if (Math.abs(v) > 0.02 && !atEdge) B.raf = requestAnimationFrame(step); else armReturn();
    };
    B.raf = requestAnimationFrame(step);
  }

  (() => {
    let drag = null, lastY = 0, lastT = 0, vel = 0;
    el.lyrics.addEventListener('pointerdown', (e) => {
      if (!S.lines || e.target.closest('#lyricsNow')) return;
      cancelAnimationFrame(B.raf);
      drag = { id: e.pointerId, y0: e.clientY, base: B.on ? B.cur : B.auto, moved: false };
      lastY = e.clientY; lastT = e.timeStamp; vel = 0;
    });
    el.lyrics.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dy = e.clientY - drag.y0;
      if (!drag.moved) {
        if (Math.abs(dy) < 7) return;                         // still a tap
        drag.moved = true;
        enterBrowse();
        try { el.lyrics.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      }
      clearTimeout(B.t);
      setBrowse(drag.base + dy);
      const dt = e.timeStamp - lastT;
      if (dt > 0) vel = 0.7 * vel + 0.3 * ((e.clientY - lastY) / dt);
      lastY = e.clientY; lastT = e.timeStamp;
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const moved = drag.moved; drag = null;
      if (!moved) return;
      B.suppressClick = true; setTimeout(() => { B.suppressClick = false; }, 60);   // a drag is not a tap
      if (Math.abs(vel) > 0.15) fling(vel); else armReturn();
    };
    el.lyrics.addEventListener('pointerup', end);
    el.lyrics.addEventListener('pointercancel', end);
    el.lyrics.addEventListener('wheel', (e) => {              // mouse wheel / trackpad
      if (!S.lines) return;
      e.preventDefault();
      cancelAnimationFrame(B.raf);
      enterBrowse();
      setBrowse(B.cur - e.deltaY);
      armReturn();
    }, { passive: false });
    el.lyricsNow.addEventListener('click', exitBrowse);
  })();

  // ------------------------------------------------------------------ word-by-word lyrics (Karaoke / Word by word styles)
  // LRCLIB only has line timings, so word times are estimated: the words share the line's time by their length.
  let W = null;
  const wantsWords = () => cfg.lstyle === 'karaoke' || cfg.lstyle === 'words';
  function clearWords() {
    if (W && W.node && W.node.isConnected) W.node.textContent = W.text || '\u266a';
    W = null;
  }
  function prepareWords(idx) {
    clearWords();
    if (!wantsWords() || idx < 0 || !S.lines || !S.lines[idx]) return;
    const node = el.lyricsInner.children[idx], line = S.lines[idx];
    const text = line.s || '';
    const toks = text.split(/\s+/).filter(Boolean);
    if (!node || toks.length < 2) return;                          // a single word has nothing to stagger
    node.textContent = '';
    const wt = toks.map((t) => t.length + 1.5), total = wt.reduce((a, b) => a + b, 0);
    const spans = [], starts = [];
    let acc = 0;
    toks.forEach((t, i) => {
      const sp = document.createElement('span');
      sp.className = 'w'; sp.textContent = t;
      node.appendChild(sp);
      if (i < toks.length - 1) node.appendChild(document.createTextNode(' '));
      spans.push(sp); starts.push(acc / total); acc += wt[i];
    });
    const next = S.lines[idx + 1];
    const gap = next ? next.t - line.t : 6000;
    W = { node, text, t: line.t, spans, starts, span: Math.min(gap * 0.9, Math.max(1400, text.length * 105)), n: -1 };
    wordTick();
  }
  function wordTick() {
    if (!W) return;
    const rel = position() - W.t;
    let n = 0;
    for (let i = 0; i < W.starts.length; i++) if (rel >= W.starts[i] * W.span) n = i + 1;
    if (n === W.n) return;
    W.n = n;
    W.spans.forEach((sp, i) => sp.classList.toggle('on', i < n));
  }
  setInterval(wordTick, 100);

  // ------------------------------------------------------------------ controls
  async function control(kind) {
    if (DEMO) return demoControl(kind);
    const map = {
      play: ['PUT', '/me/player/play'], pause: ['PUT', '/me/player/pause'],
      next: ['POST', '/me/player/next'], prev: ['POST', '/me/player/previous'],
    };
    const [method, path] = map[kind];
    try {
      const r = await api(method, path);
      if (r.status === 403) toast('Controlling playback needs Spotify Premium');
      else if (r.status === 404) toast('No active Spotify device — start playing first');
      else if (r.status === 429) toast('Spotify is busy, try again in a moment');
    } catch (e) { toast('Could not reach Spotify'); }
    setTimeout(poll, 450);
  }

  el.play.addEventListener('click', () => {
    const kind = S.playing ? 'pause' : 'play';
    S.anchor = { p: position(), t: Date.now() };            // optimistic: freeze/resume the clock now
    S.playing = !S.playing;
    renderPlayState();
    control(kind);
  });
  el.next.addEventListener('click', () => control('next'));
  el.prev.addEventListener('click', () => control('prev'));

  el.seek.addEventListener('input', () => {
    S.dragging = true;
    el.tCur.textContent = fmt(el.seek.value * 1000);
    el.seek.style.setProperty('--p', (el.seek.value / el.seek.max) * 100 + '%');
  });
  // jump to a position (progress bar and tapped lyric lines share this)
  async function seekTo(ms) {
    ms = Math.max(0, Math.round(ms));
    if (S.track && S.track.dur) ms = Math.min(ms, Math.max(0, S.track.dur - 500));
    S.anchor = { p: ms, t: Date.now() };
    S.dragging = false;
    tick(true);                                   // progress bar + highlighted line update at once
    if (DEMO) return;
    try { await api('PUT', '/me/player/seek?position_ms=' + ms); } catch (e) { toast('Could not jump (is Spotify playing?)'); }
    setTimeout(poll, 450);
  }
  el.seek.addEventListener('change', () => seekTo(el.seek.value * 1000));

  // tap a lyric line to jump to it in the song
  el.lyricsInner.addEventListener('click', (e) => {
    if (B.suppressClick) return;
    const ln = e.target.closest('.ln');
    if (!ln || !S.lines) return;
    const i = Array.prototype.indexOf.call(el.lyricsInner.children, ln);
    if (i < 0 || !S.lines[i]) return;
    ln.classList.add('tapped');
    setTimeout(() => ln.classList.remove('tapped'), 220);
    exitBrowse();
    seekTo(S.lines[i].t);
  });

  el.btnLyrics.addEventListener('click', () => {
    S.showLyrics = !S.showLyrics;
    store.set('showLyrics', S.showLyrics ? '1' : '0');
    document.body.classList.toggle('lyrics', S.showLyrics && !!(S.lines && S.lines.length));
    setTimeout(() => centerLine(S.lineIdx, true), 60);
  });

  // swipe left/right on the cover = next / previous
  (() => {
    let x0 = null;
    el.cover.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    el.cover.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 60) control(dx < 0 ? 'next' : 'prev');
    }, { passive: true });
  })();

  // ------------------------------------------------------------------ setup screen
  function showSetup(msg) {
    show('setup');
    el.redirectUri.textContent = REDIRECT;
    el.cid.value = store.get('cid') || '';
    el.setupMsg.textContent = msg || '';
    $('nameStep').hidden = true; $('setupCard').hidden = false;
  }
  let nameAsked = false, pendingCid = '';
  function showNameStep() {
    $('setupCard').hidden = true; $('nameStep').hidden = false;
    $('nameIn').value = getName();
    setTimeout(() => $('nameIn').focus(), 50);
  }
  el.connect.addEventListener('click', () => {
    const id = el.cid.value.trim();
    if (!/^[0-9a-f]{32}$/i.test(id)) { el.setupMsg.textContent = 'That doesn\u2019t look like a Client ID (32 letters/numbers).'; return; }
    pendingCid = id;
    if (!getName() && !nameAsked) { nameAsked = true; showNameStep(); return; }   // onboarding: ask the name once
    startLogin(id);
  });
  function finishName(skip) {
    if (!skip) { const n = $('nameIn').value.trim().slice(0, 24); if (n) store.set('name', n); }
    if (DEMO) { $('nameStep').hidden = true; $('setupCard').hidden = false; return; }
    startLogin(pendingCid || store.get('cid') || '');
  }
  $('nameGo').addEventListener('click', () => finishName(false));
  $('nameSkip').addEventListener('click', () => finishName(true));
  $('nameIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') finishName(false); });
  el.disconnect.addEventListener('click', logout);

  // ------------------------------------------------------------------ shuffle / repeat
  function renderModes() {
    el.shuf.classList.toggle('on', !!S.shuffle);
    el.rep.classList.toggle('on', S.repeat !== 'off');
    el.icoRep.toggleAttribute('hidden', S.repeat === 'track');
    el.icoRep1.toggleAttribute('hidden', S.repeat !== 'track');
    el.shuf.setAttribute('aria-pressed', String(!!S.shuffle));
  }
  const holdUI = () => { S.hold = Date.now() + 1800; };          // don't let a stale poll undo a tap

  async function playerCall(method, path, body) {
    try {
      const r = await api(method, path, body);
      if (r.status === 403) toast('This needs Spotify Premium');
      else if (r.status === 404) toast('No active Spotify device — start playing first');
      else if (r.status === 429) toast('Spotify is busy, try again in a moment');
      return r;
    } catch (e) { toast('Could not reach Spotify'); return null; }
  }
  el.shuf.addEventListener('click', async () => {
    S.shuffle = !S.shuffle; holdUI(); renderModes();
    toast(S.shuffle ? 'Shuffle on' : 'Shuffle off');
    if (DEMO) return;
    await playerCall('PUT', '/me/player/shuffle?state=' + S.shuffle);
    setTimeout(poll, 600);
  });
  el.rep.addEventListener('click', async () => {
    S.repeat = S.repeat === 'off' ? 'context' : S.repeat === 'context' ? 'track' : 'off';
    holdUI(); renderModes();
    toast(S.repeat === 'off' ? 'Repeat off' : S.repeat === 'context' ? 'Repeat all' : 'Repeat this song');
    if (DEMO) return;
    await playerCall('PUT', '/me/player/repeat?state=' + S.repeat);
    setTimeout(poll, 600);
  });

  // ------------------------------------------------------------------ like (saved songs)
  const LIB = ['user-library-read', 'user-library-modify'];
  const hasLib = () => !!(S.token && S.token.scope && LIB.every((x) => S.token.scope.split(' ').includes(x)));
  const likeable = (t) => !!(t && t.type === 'track' && t.id && !/^spotify:local|^local/.test(String(t.id)));
  const trackUri = (t) => 'spotify:track:' + t.id;

  function renderLike() {
    el.like.hidden = !likeable(S.track);
    el.icoLike.toggleAttribute('hidden', S.liked);
    el.icoLiked.toggleAttribute('hidden', !S.liked);
    el.like.classList.toggle('on', S.liked);
    el.like.setAttribute('aria-pressed', String(S.liked));
  }
  async function loadLiked(t) {
    if (DEMO || !likeable(t) || !hasLib()) return;
    try {
      const r = await api('GET', '/me/library/contains?uris=' + encodeURIComponent(trackUri(t)));
      if (r.ok) { const j = await r.json(); if (S.trackId === t.id) { S.liked = !!j[0]; renderLike(); } }
    } catch (e) { /* ignore */ }
  }
  let reconnectArmed = 0;
  function reconnectForLikes() {
    if (Date.now() < reconnectArmed) { startLogin(store.get('cid') || ''); return; }
    reconnectArmed = Date.now() + 6000;
    toast('Spotify needs one more permission for likes. Tap again to reconnect');
  }
  el.like.addEventListener('click', async () => {
    const t = S.track;
    if (!likeable(t)) return;
    if (!DEMO && !hasLib()) { reconnectForLikes(); return; }
    const want = !S.liked;
    S.liked = want; renderLike();
    el.like.classList.remove('pop'); void el.like.offsetWidth; el.like.classList.add('pop');
    toast(want ? 'Added to Liked Songs' : 'Removed from Liked Songs');
    if (DEMO) return;
    try {
      const r = await api(want ? 'PUT' : 'DELETE', '/me/library?uris=' + encodeURIComponent(trackUri(t)));
      if (!r.ok) throw new Error(r.status);
    } catch (e) {
      if (S.trackId === t.id) { S.liked = !want; renderLike(); }
      toast('Could not update Liked Songs');
    }
  });

  // ------------------------------------------------------------------ volume: swipe up / down on the cover
  let volT, volSend = 0, volLast = -1;
  const curVol = () => (S.device && typeof S.device.volume_percent === 'number') ? S.device.volume_percent : 50;
  function showVol(v) {
    el.volFill.style.width = v + '%'; el.volNum.textContent = v;
    el.vol.classList.add('show');
    clearTimeout(volT); volT = setTimeout(() => el.vol.classList.remove('show'), 1100);
  }
  async function sendVol(v) {
    volLast = v;
    if (S.device) S.device.volume_percent = v;
    if (DEMO) return;
    const now = Date.now();
    if (now - volSend < 200) { clearTimeout(sendVol.t); sendVol.t = setTimeout(() => sendVol(volLast), 220); return; }
    volSend = now;
    const r = await playerCall('PUT', '/me/player/volume?volume_percent=' + v);
    if (r && r.status === 403) toast('This device sets its volume itself');
  }
  function volumeBlocked() {
    if (!S.device && !DEMO) { toast('Start playing first'); return true; }
    if (S.device && S.device.supports_volume === false) { toast('This device’s volume is set on the device itself'); return true; }
    return false;
  }
  (() => {
    let start = null;
    const w = el.coverWrap;
    w.addEventListener('pointerdown', (e) => { start = { y: e.clientY, v: curVol(), moved: false }; try { w.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } });
    w.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dy = start.y - e.clientY;
      if (!start.moved && Math.abs(dy) < 8) return;
      if (!start.moved && volumeBlocked()) { start = null; return; }
      start.moved = true;
      const v = Math.max(0, Math.min(100, Math.round(start.v + dy / (w.clientHeight * 0.9) * 100)));
      showVol(v); sendVol(v); holdUI();
    });
    const end = () => { if (start && start.moved && volLast >= 0) { clearTimeout(sendVol.t); volSend = 0; sendVol(volLast); } start = null; };
    w.addEventListener('pointerup', end); w.addEventListener('pointercancel', end);
    w.addEventListener('wheel', (e) => {                       // desktop: scroll over the cover
      e.preventDefault();
      if (volumeBlocked()) return;
      const v = Math.max(0, Math.min(100, curVol() + (e.deltaY < 0 ? 5 : -5)));
      showVol(v); sendVol(v); holdUI();
    }, { passive: false });
  })();

  // ------------------------------------------------------------------ devices (Spotify Connect)
  const DEMO_DEVICES = [
    { id: 'd1', name: 'Living room', type: 'Speaker', is_active: true, volume_percent: 55, supports_volume: true },
    { id: 'd2', name: 'Kitchen display', type: 'Smartphone', is_active: false, volume_percent: 40, supports_volume: true },
    { id: 'd3', name: 'Desktop', type: 'Computer', is_active: false, volume_percent: 70, supports_volume: true },
  ];
  function renderDevices(list) {
    el.devList.textContent = '';
    if (!list.length) {
      const p = document.createElement('p'); p.className = 'devNote';
      p.textContent = 'No devices found. Open Spotify on a phone, speaker or computer, then try again.';
      el.devList.appendChild(p); return;
    }
    list.forEach((d) => {
      const b = document.createElement('button');
      b.className = 'dev' + (d.is_active ? ' on' : '');
      const l = document.createElement('div');
      const n = document.createElement('b'); n.textContent = d.name;
      const sm = document.createElement('small'); sm.textContent = d.type + (typeof d.volume_percent === 'number' ? ' · volume ' + d.volume_percent + '%' : '');
      l.append(n, sm); b.appendChild(l);
      b.addEventListener('click', () => transferTo(d));
      el.devList.appendChild(b);
    });
  }
  async function loadDevices() {
    el.devList.textContent = 'Loading\u2026';
    if (DEMO) { renderDevices(DEMO_DEVICES); return; }
    try {
      const r = await api('GET', '/me/player/devices');
      if (!r.ok) { el.devList.textContent = 'Could not load devices (' + r.status + ').'; return; }
      renderDevices((await r.json()).devices || []);
    } catch (e) { el.devList.textContent = 'Could not reach Spotify.'; }
  }
  async function transferTo(d) {
    el.devSheet.hidden = true;
    if (DEMO) { DEMO_DEVICES.forEach((x) => { x.is_active = x.id === d.id; }); S.device = d; toast('Playing on ' + d.name); return; }
    const r = await playerCall('PUT', '/me/player', { device_ids: [d.id], play: S.playing });
    if (r && r.ok) toast('Playing on ' + d.name);
    setTimeout(poll, 900);
  }
  el.btnDev.addEventListener('click', () => openLibrary());
  $('devClose').addEventListener('click', () => { el.devSheet.hidden = true; });

  // ------------------------------------------------------------------ genre looks
  // The artist's Spotify genres pick a "family"; the family decides the lyric typeface, glow, entrance animation
  // and a soft drifting background (all CSS, see style.css). One lookup per new artist, cached in this browser.
  const GENRE_RULES = [
    ['hiphop', /hip.?hop|\brap\b|trap|drill|grime|boom bap|crunk|phonk/],
    ['rock', /metal|rock|punk|grunge|hardcore|\bemo\b|garage/],
    ['electronic', /^dance$|dance\/electronic|\bedm\b|electro|house|techno|trance|dubstep|drum and bass|\bdnb\b|synthwave|big room|future bass|hardstyle|\bclub\b|\brave\b/],
    ['classical', /classical|orchestra|opera|baroque|piano|jazz|bebop|swing|big band|soundtrack|\bscore\b|cinematic/],
    ['chill', /lo-?fi|chill|ambient|dream|downtempo|sleep|shoegaze|new age|bedroom|meditation|\bstudy\b/],
    ['soul', /r&b|\brnb\b|soul|funk|motown|disco|quiet storm|gospel/],
    ['country', /country|folk|bluegrass|americana|blues|singer.songwriter|acoustic|cowboy|western|\broots\b/],
    ['tropical', /reggae|dancehall|reggaeton|latin|salsa|bachata|afro|dembow|cumbia|tropical|samba|bossa|arab|\brai\b|ra\u00ef|khaleeji|mizrahi|amapiano/],
    ['pop', /pop|dance|teen|boy band|idol/],
    ['rock', /alternative|indie rock|britpop/],                 // weak match: only when nothing more specific fits
  ];
  const FAMS = GENRE_RULES.map((r) => r[0]).filter((v, i, a) => a.indexOf(v) === i);
  const FAM_NAMES = { hiphop: 'Hip-hop', rock: 'Rock', electronic: 'Electronic', classical: 'Classical & jazz', chill: 'Lo-fi & chill',
    soul: 'R&B & soul', country: 'Country & folk', tropical: 'Latin & reggae', pop: 'Pop' };
  const familyOf = (gs) => {
    const l = (gs || []).map((g) => String(g).toLowerCase());
    for (const [f, re] of GENRE_RULES) if (l.some((g) => re.test(g))) return f;
    return '';
  };
  S.gfam = '';
  { const gp = new URLSearchParams(location.search).get('genre'); if (gp) S.gforce = FAMS.indexOf(gp) >= 0 ? gp : ''; }   // ?genre=rock previews a look

  function applyGenre() {
    const f = cfg.genre ? (S.gforce !== undefined ? S.gforce : S.gfam) : '';
    FAMS.forEach((k) => document.body.classList.toggle('gn-' + k, k === f));
    setTimeout(() => centerLine(S.lineIdx, true), 60);             // the typeface changes line heights: re-centre
  }
  // Genre detection: look the song up online first (Apple Music search, then MusicBrainz tags), and only if neither
  // knows it fall back to the artist's Spotify genres. Slow is fine: the look appears when the answer arrives, and
  // the result is cached in this browser so each song is looked up once.
  const norm = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\b(feat|ft|featuring)\b.*$/, '').replace(/ - .*$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  // tolerant name match: "Fairuz" ~ "Fairouz", "Beyonce" ~ "Beyoncé"
  function lev(a, b) {
    const m = a.length, n = b.length;
    if (!m || !n) return Math.max(m, n);
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  const sameName = (a, b) => !!a && !!b && (a === b || a.includes(b) || b.includes(a) ||
    (Math.min(a.length, b.length) >= 4 && 1 - lev(a, b) / Math.max(a.length, b.length) >= 0.78));

  async function fetchJson(url, ms) {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), ms || 7000);
    try {
      const r = await fetch(url, { signal: ac.signal });
      return r.ok ? await r.json() : null;
    } finally { clearTimeout(to); }
  }

  // 1) Apple Music (iTunes Search): one genre per song. Only trust results whose artist matches.
  async function genreFromItunes(names, title) {
    const j = await fetchJson('https://itunes.apple.com/search?term=' + encodeURIComponent((names[0] + ' ' + title).slice(0, 120)) + '&entity=song&limit=10');
    const res = (j && j.results) || [];
    const want = names.map(norm).filter((n) => n.length > 1);
    const t = norm(title);
    const sameArtist = res.filter((r) => { const ra = norm(r.artistName); return ra && want.some((w) => sameName(ra, w)); });
    const exact = sameArtist.find((r) => { const rt = norm(r.trackName); return rt === t || rt.startsWith(t) || t.startsWith(rt); });
    const pick = exact || sameArtist[0];
    return pick ? pick.primaryGenreName : null;
  }

  // 2) MusicBrainz: community tags of the artist ("thrash metal", "jazz rap"...). Needs an exact name match; max 1 request/s.
  let mbLast = 0;
  async function genreFromMusicBrainz(name) {
    const wait = mbLast + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    mbLast = Date.now();
    const j = await fetchJson('https://musicbrainz.org/ws/2/artist/?query=' + encodeURIComponent('artist:"' + name.replace(/"/g, '') + '"') + '&fmt=json&limit=3', 9000);
    const n = norm(name);
    const hit = ((j && j.artists) || []).find((x) => (norm(x.name) === n || sameName(norm(x.name), n)) && (x.score || 0) >= 80);
    if (!hit) return null;
    const tags = (hit.tags || []).slice().sort((p, q) => q.count - p.count).slice(0, 8).map((x) => x.name);
    return tags.length ? tags : null;
  }

  // 3) Spotify artist genres (last resort)
  async function genreFromSpotify(artistId, why) {
    if (!artistId || !S.token) return null;
    let gs = null;
    try { gs = JSON.parse(store.get('g_' + artistId) || 'null'); } catch (e) { gs = null; }
    if (gs && gs.length) return gs;
    const r = await api('GET', '/artists/' + artistId);
    if (!r.ok) { why.push('Spotify artist lookup answered ' + r.status); return null; }
    gs = (await r.json()).genres || [];
    if (gs.length) store.set('g_' + artistId, JSON.stringify(gs)); else why.push('Spotify lists no genre for this artist');
    return gs.length ? gs : null;
  }

  async function detectGenre(t) {
    const names = String(t.artist || '').split(/,\s*/).filter(Boolean);
    const key = 'gv2:' + norm(names[0]) + '|' + norm(t.title);
    let c = null;
    try { c = JSON.parse(store.get(key) || 'null'); } catch (e) { c = null; }
    if (c && (c.fam || Date.now() - c.at < 30 * 60 * 1000)) return c;     // misses are retried after 30 minutes
    const why = [];
    const done = (fam, raw, src) => {
      const r = { fam, raw, src, why: why.join('; '), at: Date.now() };
      store.set(key, JSON.stringify(r));
      return r;
    };
    try {
      const g = await genreFromItunes(names, t.title);
      if (g) { const f = familyOf([g]); if (f) return done(f, g, 'Apple Music'); why.push('Apple Music says “' + g + '”'); } else why.push('not on Apple Music');
    } catch (e) { why.push('Apple Music unreachable'); }
    try {
      const tags = names[0] ? await genreFromMusicBrainz(names[0]) : null;
      if (tags) { const f = familyOf(tags); if (f) return done(f, tags.slice(0, 3).join(', '), 'MusicBrainz'); why.push('MusicBrainz tags didn’t match a look'); } else why.push('no MusicBrainz tags');
    } catch (e) { why.push('MusicBrainz unreachable'); }
    try {
      const gs = await genreFromSpotify(t.artistId, why);
      if (gs) { const f = familyOf(gs); if (f) return done(f, gs.slice(0, 3).join(', '), 'Spotify'); why.push('Spotify genres didn’t match a look'); }
    } catch (e) { why.push('Spotify lookup failed'); }
    return done('', '', '');
  }
  if (DEMO) window.__npDetect = detectGenre;                          // for testing the lookup against the real services

  function updateGenreInfo() { const g = $('genreInfo'); if (g) g.textContent = S.ginfo || 'Waiting for a song'; }

  async function loadGenre(t) {
    S.gfam = '';
    if (t.genres) { S.gfam = familyOf(t.genres); S.ginfo = (S.gfam ? FAM_NAMES[S.gfam] : 'No look') + ' · demo song'; applyGenre(); updateGenreInfo(); return; }
    applyGenre();
    if (!cfg.genre) { S.ginfo = 'Genre animations are off'; updateGenreInfo(); return; }
    S.ginfo = 'Looking up the genre…'; updateGenreInfo();
    let r;
    try { r = await detectGenre(t); } catch (e) { r = { fam: '', why: 'lookup failed' }; }
    if (S.trackId !== t.id) return;                                  // skipped to another song meanwhile
    S.gfam = r.fam;
    S.ginfo = r.fam ? FAM_NAMES[r.fam] + ' · via ' + r.src + (r.raw ? ' (' + r.raw + ')' : '')
                    : 'No genre found' + (r.why ? ' — ' + r.why : '');
    applyGenre(); updateGenreInfo();
  }

  function cycleGenreLook() {                                      // G: preview every look (auto -> each family -> auto)
    const order = [undefined].concat(FAMS);
    const i = order.indexOf(S.gforce);
    S.gforce = order[(i + 1) % order.length];
    applyGenre();
    toast(S.gforce === undefined ? 'Genre look: automatic' + (S.gfam ? ' (' + FAM_NAMES[S.gfam] + ')' : '') : 'Genre look: ' + FAM_NAMES[S.gforce]);
  }

  // ------------------------------------------------------------------ library: playlists + devices (one sheet, two tabs)
  let libTab = 'pl';
  const hasScopes = (list) => !!(S.token && S.token.scope && list.every((x) => S.token.scope.split(' ').includes(x)));
  const hasPl = () => hasScopes(['playlist-read-private', 'playlist-read-collaborative']);

  const DEMO_PLAYLISTS = [
    { id: 'p1', name: 'Late Night Drive', owner: 'You', count: 42, hue: 265, uri: 'demo:1' },
    { id: 'p2', name: 'Morning Coffee', owner: 'You', count: 28, hue: 28, uri: 'demo:2' },
    { id: 'p3', name: 'Focus Flow', owner: 'Spotify', count: 120, hue: 175, uri: 'demo:3' },
    { id: 'p4', name: 'Road Trip Classics', owner: 'You', count: 64, hue: 350, uri: 'demo:4' },
    { id: 'p5', name: 'Arabic Chill', owner: 'You', count: 36, hue: 205, uri: 'demo:5' },
  ];

  function syncTabs() {
    document.querySelectorAll('#libTabs button').forEach((b) => b.classList.toggle('on', b.dataset.v === libTab));
  }
  function loadTab() { if (libTab === 'dev') loadDevices(); else loadPlaylists(); }
  function openLibrary(tab) {
    if (tab) libTab = tab;
    el.devSheet.hidden = false;
    syncTabs(); loadTab();
  }
  $('libTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    libTab = b.dataset.v; syncTabs(); loadTab();
  });

  function note(msg, withReconnect) {
    el.devList.textContent = '';
    const p = document.createElement('p'); p.className = 'devNote'; p.textContent = msg;
    el.devList.appendChild(p);
    if (withReconnect) {
      const b = document.createElement('button'); b.className = 'pill'; b.textContent = 'Reconnect Spotify';
      b.addEventListener('click', () => startLogin(store.get('cid') || ''));
      el.devList.appendChild(b);
    }
  }

  async function loadPlaylists() {
    el.devList.textContent = 'Loading…';
    if (DEMO) { renderPlaylists(DEMO_PLAYLISTS); return; }
    if (!hasPl()) { note('To show your playlists, Spotify needs one more permission. You only do this once.', true); return; }
    try {
      let all = [], url = '/me/playlists?limit=50';
      for (let i = 0; i < 4 && url; i++) {                         // up to 200 playlists
        const r = await api('GET', url);
        if (r.status === 403) { note('Spotify refused the request. Reconnect to grant the playlist permission.', true); return; }
        if (!r.ok) { note('Could not load playlists (' + r.status + ').'); return; }
        const j = await r.json();
        all = all.concat((j.items || []).filter(Boolean));
        url = j.next ? j.next.replace('https://api.spotify.com/v1', '') : null;
      }
      renderPlaylists(all);
    } catch (e) { note('Could not reach Spotify.'); }
  }

  function renderPlaylists(list) {
    el.devList.textContent = '';
    if (!list.length) { note('No playlists yet. Create one in Spotify and it will show up here.'); return; }
    list.forEach((p) => {
      const b = document.createElement('button');
      b.className = 'dev pl';
      const img = document.createElement('img');
      img.alt = ''; img.loading = 'lazy';
      const imgs = p.images || [];
      img.src = p.hue != null ? demoCover(p.hue) : (imgs.length ? imgs[imgs.length - 1].url : '');
      const l = document.createElement('div');
      const n = document.createElement('b'); n.textContent = p.name || 'Untitled';
      const total = p.count != null ? p.count : ((p.items && p.items.total) != null ? p.items.total : (p.tracks && p.tracks.total));
      const owner = p.owner && (p.owner.display_name || p.owner) ;
      const sm = document.createElement('small');
      sm.textContent = [typeof total === 'number' ? total + ' songs' : '', typeof owner === 'string' ? owner : ''].filter(Boolean).join(' · ');
      l.append(n, sm);
      b.append(img, l);
      b.addEventListener('click', () => playPlaylist(p));
      el.devList.appendChild(b);
    });
  }

  async function playPlaylist(p) {
    el.devSheet.hidden = true;
    if (DEMO) { demoControl('next'); toast('Playing ' + p.name); return; }
    const r = await playerCall('PUT', '/me/player/play', { context_uri: p.uri });
    if (r && r.ok) { toast('Playing ' + p.name); S.anchor = { p: 0, t: Date.now() }; S.playing = true; renderPlayState(); setTimeout(poll, 900); }
    else if (r && r.status === 404) { openLibrary('dev'); toast('Pick a device to play on first'); }
  }

  // ------------------------------------------------------------------ greeting + name
  // (the helpers themselves are defined near the top; this wires the settings field)

  // ------------------------------------------------------------------ keyboard shortcuts (desktop)
  const SHORTCUTS = [
    [['Space'], 'Play / pause'], [['←', '→'], 'Back / forward 5 s'], [['Shift', '← →'], 'Previous / next song'],
    [['N', 'B'], 'Next / previous song'], [['↑', '↓'], 'Volume up / down'], [['M'], 'Mute'],
    [['S'], 'Shuffle'], [['R'], 'Repeat'], [['L'], 'Like'], [['T'], 'Show / hide lyrics'], [['Y'], 'Next lyric style'], [['G'], 'Preview a genre look'],
    [['F'], 'Full screen'], [['P'], 'Playlists'], [['D'], 'Devices'], [[','], 'Settings'], [['?'], 'This list'], [['Esc'], 'Close a panel'],
  ];
  (() => {
    const list = $('helpList');
    SHORTCUTS.forEach(([keys, desc]) => {
      const k = document.createElement('div'); k.className = 'keys';
      keys.forEach((x) => { const e = document.createElement('kbd'); e.textContent = x; k.appendChild(e); });
      const d = document.createElement('div'); d.textContent = desc;
      list.append(k, d);
    });
  })();

  const LYRIC_STYLES = ['scroll', 'karaoke', 'focus', 'duo', 'words'];
  const LYRIC_NAMES = { scroll: 'Scroll', karaoke: 'Karaoke', focus: 'One line', duo: 'Two lines', words: 'Word by word' };
  function cycleLyricStyle() {
    cfg.lstyle = LYRIC_STYLES[(LYRIC_STYLES.indexOf(cfg.lstyle) + 1) % LYRIC_STYLES.length];
    saveCfg(); applyCfg(); syncSettingsUI();
    toast('Lyrics: ' + LYRIC_NAMES[cfg.lstyle]);
  }
  let preMute = 0;
  function stepVol(d) {
    if (volumeBlocked()) return;
    const v = Math.max(0, Math.min(100, curVol() + d));
    showVol(v); sendVol(v); holdUI();
  }
  function toggleMute() {
    if (volumeBlocked()) return;
    const c = curVol();
    const v = c > 0 ? 0 : (preMute || 30);
    if (c > 0) preMute = c;
    showVol(v); sendVol(v); holdUI();
    toast(v === 0 ? 'Muted' : 'Volume ' + v);
  }
  function closePanels() {
    el.devSheet.hidden = true; el.setSheet.hidden = true; $('helpSheet').hidden = true; sheet.hidden = true;
  }
  const anyPanel = () => !el.devSheet.hidden || !el.setSheet.hidden || !$('helpSheet').hidden || !sheet.hidden;

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    const typing = t && ((t.tagName === 'INPUT' && !['checkbox', 'range', 'button'].includes(t.type)) || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (typing) { if (e.key === 'Escape') t.blur(); return; }
    const k = e.key;
    if (k === 'Escape') { closePanels(); return; }
    if (k === '?') { $('helpSheet').hidden = !$('helpSheet').hidden; e.preventDefault(); return; }
    if (S.screen !== 'player' || anyPanel()) return;
    let handled = true;
    switch (k) {
      case ' ': case 'k': case 'K': el.play.click(); break;
      case 'ArrowLeft': if (e.shiftKey) el.prev.click(); else if (S.track) seekTo(position() - 5000); break;
      case 'ArrowRight': if (e.shiftKey) el.next.click(); else if (S.track) seekTo(position() + 5000); break;
      case 'ArrowUp': stepVol(5); break;
      case 'ArrowDown': stepVol(-5); break;
      case 'n': case 'N': el.next.click(); break;
      case 'b': case 'B': el.prev.click(); break;
      case 'm': case 'M': toggleMute(); break;
      case 's': case 'S': el.shuf.click(); break;
      case 'r': case 'R': el.rep.click(); break;
      case 'l': case 'L': el.like.click(); break;
      case 't': case 'T': if (!el.btnLyrics.hidden) el.btnLyrics.click(); break;
      case 'y': case 'Y': cycleLyricStyle(); break;
      case 'g': case 'G': cycleGenreLook(); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 'p': case 'P': openLibrary('pl'); break;
      case 'd': case 'D': openLibrary('dev'); break;
      case ',': el.btnSet.click(); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  });
  // Space on a focused button would press it a second time: stop that, and don't leave buttons focused after a click
  document.addEventListener('keyup', (e) => { if (e.key === ' ' && e.target && e.target.tagName === 'BUTTON') e.preventDefault(); });
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b && b.blur) b.blur(); });

  // ------------------------------------------------------------------ auto-hide the buttons
  let hideT = 0, lastAct = 0, swallow = false;
  const anySheet = () => !el.devSheet.hidden || !el.setSheet.hidden || !sheet.hidden || !$('helpSheet').hidden;
  function armHide() {
    clearTimeout(hideT);
    if (!cfg.autohide || S.screen !== 'player') return;
    hideT = setTimeout(() => {
      if (anySheet() || B.on) { armHide(); return; }               // never hide while a panel is open or while scrolling lyrics
      document.body.classList.add('chrome-off');
    }, 5000);
  }
  function chromeShow() { document.body.classList.remove('chrome-off'); armHide(); }
  function onActivity(e) {
    const off = document.body.classList.contains('chrome-off');
    if (off && e.type === 'pointerdown') { swallow = true; setTimeout(() => { swallow = false; }, 450); }   // that tap only reveals
    const now = Date.now();
    if (!off && e.type !== 'pointerdown' && now - lastAct < 400) return;                                // throttle mouse moves
    lastAct = now;
    chromeShow();
  }
  ['pointerdown', 'pointermove', 'wheel', 'keydown'].forEach((ev) => window.addEventListener(ev, onActivity, { capture: true, passive: true }));
  document.addEventListener('click', (e) => { if (swallow) { e.stopPropagation(); e.preventDefault(); } }, true);

  // ------------------------------------------------------------------ settings panel
  function saveCfg() { store.set('cfg', JSON.stringify(cfg)); }
  function applyCfg() {
    document.documentElement.style.setProperty('--lscale', cfg.lscale);
    document.body.classList.toggle('noclock', !cfg.clock);
    if (['scroll', 'karaoke', 'focus', 'duo', 'words'].indexOf(cfg.lstyle) < 0) cfg.lstyle = 'scroll';
    ['scroll', 'karaoke', 'focus', 'duo', 'words'].forEach((k) => document.body.classList.toggle('ls-' + k, cfg.lstyle === k));
    clearWords(); prepareWords(S.lineIdx);
    if (typeof applyGenre === 'function') applyGenre();
    if (!cfg.awake && wake) { try { wake.release(); } catch (e) { /* ignore */ } wake = null; }
    if (cfg.awake) lockScreen();
    setTimeout(() => centerLine(S.lineIdx, true), 80);           // line heights changed: re-centre the lyrics
  }
  function syncSettingsUI() {
    $('cfgGenre').checked = cfg.genre; updateGenreInfo();
    $('cfgClock').checked = cfg.clock; $('cfgAwake').checked = cfg.awake; $('cfgHide').checked = cfg.autohide;
    document.querySelectorAll('#cfgStyle button').forEach((b) => b.classList.toggle('on', b.dataset.v === cfg.lstyle));
    document.querySelectorAll('#cfgSize button').forEach((b) => b.classList.toggle('on', parseFloat(b.dataset.v) === cfg.lscale));
    $('rowLikes').hidden = DEMO || (hasLib() && hasPl());
    $('cfgName').value = getName();
  }
  el.btnSet.addEventListener('click', () => { syncSettingsUI(); el.setSheet.hidden = false; });
  $('setClose').addEventListener('click', () => { el.setSheet.hidden = true; });
  $('cfgClock').addEventListener('change', (e) => { cfg.clock = e.target.checked; saveCfg(); applyCfg(); });
  $('cfgAwake').addEventListener('change', (e) => { cfg.awake = e.target.checked; saveCfg(); applyCfg(); });
  $('cfgName').addEventListener('change', (e) => { store.set('name', e.target.value.trim().slice(0, 24)); renderIdleGreet(); });
  $('cfgKeys').addEventListener('click', () => { el.setSheet.hidden = true; $('helpSheet').hidden = false; });
  $('cfgGenre').addEventListener('change', (e) => { cfg.genre = e.target.checked; saveCfg(); applyGenre(); if (cfg.genre && S.track && !S.gfam) loadGenre(S.track); else updateGenreInfo(); });
  $('cfgHide').addEventListener('change', (e) => { cfg.autohide = e.target.checked; saveCfg(); chromeShow(); });
  $('cfgStyle').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    cfg.lstyle = b.dataset.v; saveCfg(); applyCfg(); syncSettingsUI();
  });
  $('cfgSize').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    cfg.lscale = parseFloat(b.dataset.v); saveCfg(); applyCfg(); syncSettingsUI();
  });
  $('cfgReconnect').addEventListener('click', () => startLogin(store.get('cid') || ''));
  $('cfgDisconnect').addEventListener('click', () => { el.setSheet.hidden = true; if (DEMO) return; logout(); });
  // tap outside a card closes it; Escape too
  [el.devSheet, el.setSheet, $('helpSheet')].forEach((sh) => sh.addEventListener('click', (e) => { if (e.target === sh) sh.hidden = true; }));
  $('helpClose').addEventListener('click', () => { $('helpSheet').hidden = true; });
  applyCfg();
  renderModes();

  // ------------------------------------------------------------------ demo mode (?demo): fake data, no Spotify needed
  const DEMO_TRACKS = [
    { id: 'd1', title: 'Golden Hour Drive', artist: 'The Demo Band', album: 'Preview Sessions', hue: 22, dur: 214000, genres: ['dance pop', 'pop'],
      lines: ['(intro)', 'Headlights paint the evening gold', 'Windows down and nothing to hold', 'Every mile a little slower now', 'We forgot to ask where, forgot to ask how',
        'Sing it loud, the radio knows', 'Every word that the summer owes', 'Hold the moment, let it ring', 'This is the part where the chorus sings', '', 'Oh, we are golden, we are free', 'Nothing left to prove to me', 'Turn it up, the night is long', 'And the road is carrying the song'] },
    { id: 'd2', title: 'ليل المدينة', artist: 'فرقة العرض', album: 'نسخة تجريبية', hue: 205, dur: 187000, genres: ['arabic pop', 'khaleeji'],
      lines: ['(مقدمة)', 'الليل يمشي على أطراف المدينة', 'والنور يسهر فوق الشرفات', 'نحنا كنا هون وما سألنا حدا', 'والوقت يلعب بين الذكريات', 'غني معي هالأغنية الحلوة', 'كل كلمة بتعرف طريقها', 'ولا تسأل وين رايحين', 'المهم إنو الطريق جميل'] },
  ];
  let demoIdx = 0;

  function demoCover(hue) {
    const c = document.createElement('canvas'); c.width = c.height = 400;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 400, 400);
    gr.addColorStop(0, `hsl(${hue},75%,58%)`); gr.addColorStop(1, `hsl(${(hue + 50) % 360},70%,22%)`);
    g.fillStyle = gr; g.fillRect(0, 0, 400, 400);
    g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.arc(280, 140, 120, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.arc(120, 300, 150, 0, Math.PI * 2); g.fill();
    return c.toDataURL('image/jpeg', 0.85);
  }

  function demoLoad(i) {
    const d = DEMO_TRACKS[i % DEMO_TRACKS.length];
    S.playing = true; S.anchor = { p: 0, t: Date.now() };
    if (S.screen !== 'player') show('player');
    S.trackId = null;
    newTrack({ id: d.id, title: d.title, artist: d.artist, album: d.album, art: demoCover(d.hue), dur: d.dur, type: 'track', genres: d.genres });
    // synthetic synced lyrics: one line every ~7 s
    setLyrics(d.lines.map((s, k) => ({ t: 4000 + k * 7000, s })));
    renderPlayState();
  }
  function demoControl(kind) {
    if (kind === 'next' || kind === 'prev') { demoIdx += kind === 'next' ? 1 : DEMO_TRACKS.length - 1; demoLoad(demoIdx); }
    renderPlayState();
  }

  // ------------------------------------------------------------------ boot
  async function boot() {
    el.redirectUri.textContent = REDIRECT;
    tickClock();
    lockScreen();

    if (DEMO) {
      const at = new URLSearchParams(location.search).get('demo');
      if (at === 'idle') { show('idle'); return; }
      if (at === 'setup') { showSetup(''); return; }
      if (at === 'name') { showSetup(''); showNameStep(); return; }
      // optional knobs for screenshots: &n=track index, &t=start second, &ly=0 hides lyrics
      const q = new URLSearchParams(location.search);
      demoIdx = parseInt(q.get('n') || '0', 10) || 0;
      if (q.get('ly') === '0') S.showLyrics = false;
      S.device = DEMO_DEVICES[0];
      demoLoad(demoIdx);
      showGreeting();
      const t0 = parseFloat(q.get('t') || (at === 'seek' ? '30' : '0'));
      if (t0 > 0) S.anchor = { p: t0 * 1000, t: Date.now() };
      return;
    }

    const err = await handleRedirect();
    try { S.token = JSON.parse(store.get('tok') || 'null'); } catch (e) { S.token = null; }
    if (!store.get('cid') || !S.token) { showSetup(err || ''); return; }
    show('idle');
    showGreeting();
    poll();
  }
  boot();
})();
