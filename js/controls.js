/* Now Playing - Controls: transport, seek, setup screen, shuffle/repeat, like, volume, devices.
 * Classic script: shares one global scope with the other files in js/ (loaded in order, see index.html). */
'use strict';

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
