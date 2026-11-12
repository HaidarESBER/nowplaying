/* Now Playing - Library sheet: playlists + devices tabs, greeting and name.
 * Classic script: shares one global scope with the other files in js/ (loaded in order, see index.html). */
'use strict';

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
