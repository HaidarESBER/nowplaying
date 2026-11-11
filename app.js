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

  const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing';
  const REDIRECT = location.origin + location.pathname.replace(/index\.html$/, '');
  const DEMO = new URLSearchParams(location.search).has('demo');

  const $ = (id) => document.getElementById(id);
  const el = {
    bgA: $('bgA'), bgB: $('bgB'), clock: $('clock'), btnLyrics: $('btnLyrics'),
    btnFull: $('btnFull'), icoFull: $('icoFull'), icoFullExit: $('icoFullExit'),
    player: $('player'), idle: $('idle'), setup: $('setup'),
    cover: $('cover'), title: $('title'), artist: $('artist'),
    lyrics: $('lyrics'), lyricsInner: $('lyricsInner'), coverWrap: $('coverWrap'), meta: $('meta'),
    seek: $('seek'), tCur: $('tCur'), tDur: $('tDur'),
    prev: $('prev'), play: $('play'), next: $('next'), icoPlay: $('icoPlay'), icoPause: $('icoPause'),
    idleClock: $('idleClock'), idleDate: $('idleDate'), idleMsg: $('idleMsg'), disconnect: $('disconnect'),
    redirectUri: $('redirectUri'), cid: $('cid'), connect: $('connect'), setupMsg: $('setupMsg'),
    toast: $('toast'),
  };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

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
  };

  // ------------------------------------------------------------------ helpers
  const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const isRTL = (s) => /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(s);

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
    if (screen === 'idle') tickClock();
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
      if ('wakeLock' in navigator && !wake) {
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
  el.btnFull.addEventListener('click', toggleFullscreen);
  ['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) => document.addEventListener(ev, () => {
    const on = !!fsElement();
    el.icoFull.toggleAttribute('hidden', on);
    el.icoFullExit.toggleAttribute('hidden', !on);
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

  async function api(method, path, retried) {
    await ensureToken();
    const r = await fetch('https://api.spotify.com/v1' + path, {
      method, headers: { Authorization: 'Bearer ' + S.token.access },
    });
    if (r.status === 401 && !retried) { await ensureToken(true); return api(method, path, true); }
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
    };
    S.playing = !!j.is_playing;
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
    }
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
    if (instant) el.lyricsInner.style.transition = 'none';
    el.lyricsInner.style.transform = 'translateY(' + shift + 'px)';
    if (instant) requestAnimationFrame(() => { el.lyricsInner.style.transition = ''; });
  }

  window.addEventListener('resize', () => centerLine(S.lineIdx, true));
  window.addEventListener('orientationchange', () => setTimeout(() => centerLine(S.lineIdx, true), 250));

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
  el.seek.addEventListener('change', async () => {
    const ms = Math.round(el.seek.value * 1000);
    S.anchor = { p: ms, t: Date.now() };
    S.dragging = false;
    if (DEMO) return;
    try { await api('PUT', '/me/player/seek?position_ms=' + ms); } catch (e) { /* ignore */ }
    setTimeout(poll, 450);
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
  }
  el.connect.addEventListener('click', () => {
    const id = el.cid.value.trim();
    if (!/^[0-9a-f]{32}$/i.test(id)) { el.setupMsg.textContent = 'That doesn’t look like a Client ID (32 letters/numbers).'; return; }
    startLogin(id);
  });
  el.disconnect.addEventListener('click', logout);

  // ------------------------------------------------------------------ demo mode (?demo): fake data, no Spotify needed
  const DEMO_TRACKS = [
    { id: 'd1', title: 'Golden Hour Drive', artist: 'The Demo Band', album: 'Preview Sessions', hue: 22, dur: 214000,
      lines: ['(intro)', 'Headlights paint the evening gold', 'Windows down and nothing to hold', 'Every mile a little slower now', 'We forgot to ask where, forgot to ask how',
        'Sing it loud, the radio knows', 'Every word that the summer owes', 'Hold the moment, let it ring', 'This is the part where the chorus sings', '', 'Oh, we are golden, we are free', 'Nothing left to prove to me', 'Turn it up, the night is long', 'And the road is carrying the song'] },
    { id: 'd2', title: 'ليل المدينة', artist: 'فرقة العرض', album: 'نسخة تجريبية', hue: 205, dur: 187000,
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
    newTrack({ id: d.id, title: d.title, artist: d.artist, album: d.album, art: demoCover(d.hue), dur: d.dur });
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
      // optional knobs for screenshots: &n=track index, &t=start second, &ly=0 hides lyrics
      const q = new URLSearchParams(location.search);
      demoIdx = parseInt(q.get('n') || '0', 10) || 0;
      if (q.get('ly') === '0') S.showLyrics = false;
      demoLoad(demoIdx);
      const t0 = parseFloat(q.get('t') || (at === 'seek' ? '30' : '0'));
      if (t0 > 0) S.anchor = { p: t0 * 1000, t: Date.now() };
      return;
    }

    const err = await handleRedirect();
    try { S.token = JSON.parse(store.get('tok') || 'null'); } catch (e) { S.token = null; }
    if (!store.get('cid') || !S.token) { showSetup(err || ''); return; }
    show('idle');
    poll();
  }
  boot();
})();
