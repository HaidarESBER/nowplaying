/* Now Playing - Search: find songs, artists, albums and playlists on Spotify and play them.
 * Classic script: shares one global scope with the other files in js/ (loaded in order, see index.html). */
'use strict';

// ------------------------------------------------------------------ search sheet (its own button in the top bar, or press /)
let searchSeq = 0, searchTimer = 0, srGroups = [], srFilter = 'all';
const SR_RECENT_KEY = 'recent';
const recentSearches = () => { try { return JSON.parse(store.get(SR_RECENT_KEY) || '[]'); } catch (e) { return []; } };
function rememberSearch(q) {
  const l = [q].concat(recentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase())).slice(0, 6);
  store.set(SR_RECENT_KEY, JSON.stringify(l));
}

function openSearch() {
  $('searchSheet').hidden = false;
  showSearchHome();
  setTimeout(() => $('searchBox').focus(), 60);
}
function srNote(msg) {
  $('srChips').hidden = true;
  $('srList').textContent = '';
  const p = document.createElement('p'); p.className = 'devNote'; p.textContent = msg;
  $('srList').appendChild(p);
}
function showSearchHome() {
  const q = $('searchBox').value.trim();
  $('srClear').hidden = !q;
  if (q) { if (srGroups.length) renderResults(); return; }
  const rec = recentSearches();
  $('srChips').hidden = true;
  const box = $('srList'); box.textContent = '';
  if (!rec.length) { srNote('Search a song, an artist, an album or a playlist.'); return; }
  const h = document.createElement('div'); h.className = 'srH'; h.textContent = 'Recent searches';
  box.appendChild(h);
  rec.forEach((r) => {
    const b = document.createElement('button'); b.className = 'srRecent'; b.textContent = r;
    b.addEventListener('click', () => { $('searchBox').value = r; $('srClear').hidden = false; runSearch(r); });
    box.appendChild(b);
  });
}
$('btnSearch').addEventListener('click', openSearch);
$('srClose').addEventListener('click', () => { $('searchSheet').hidden = true; });
$('srClear').addEventListener('click', () => { $('searchBox').value = ''; srGroups = []; searchSeq++; showSearchHome(); $('searchBox').focus(); });
$('searchBox').addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = $('searchBox').value.trim();
  $('srClear').hidden = !q;
  if (!q) { srGroups = []; searchSeq++; showSearchHome(); return; }
  searchTimer = setTimeout(() => runSearch(q), 350);               // wait for a pause in typing
});
$('searchBox').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { clearTimeout(searchTimer); const q = e.target.value.trim(); if (q) runSearch(q); e.target.blur(); }
});
$('srChips').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  srFilter = b.dataset.v; renderResults();
});

async function runSearch(q) {
  const my = ++searchSeq;                                          // ignore answers to older queries
  if (DEMO) {
    const n = q.toLowerCase();
    const hits = DEMO_TRACKS.filter((d) => (d.title + ' ' + d.artist + ' ' + (d.album || '')).toLowerCase().includes(n))
      .map((d) => ({ kind: 'track', id: d.id, name: d.title, sub: d.artist, album: d.album, dur: d.dur, img: demoCover(d.hue), art: demoCover(d.hue), uri: 'demo:' + d.id }));
    srGroups = [{ key: 'track', title: 'Songs', items: hits }]; rememberSearch(q); renderResults(); return;
  }
  srNote('Searching…');
  try {
    const r = await api('GET', '/search?type=track,artist,album,playlist&limit=8&q=' + encodeURIComponent(q));
    if (my !== searchSeq) return;
    if (r.status === 429) { srNote('Spotify is busy, try again in a moment.'); return; }
    if (!r.ok) { srNote('Search failed (' + r.status + ').'); return; }
    const j = await r.json();
    if (my !== searchSeq) return;
    const small = (o) => { const a = (o && o.images) || []; return a.length ? a[a.length - 1].url : ''; };
    const big = (o) => { const a = (o && o.images) || []; return a.length ? a[0].url : ''; };
    const names = (a) => (a || []).map((x) => x.name).join(', ');
    srGroups = [
      { key: 'track', title: 'Songs', items: ((j.tracks || {}).items || []).filter(Boolean).map((t) => ({ kind: 'track', id: t.id, name: t.name, sub: names(t.artists), album: (t.album || {}).name || '', dur: t.duration_ms || 0, img: small(t.album), art: big(t.album), uri: t.uri, artistId: (t.artists && t.artists[0] && t.artists[0].id) || '' })) },
      { key: 'artist', title: 'Artists', items: ((j.artists || {}).items || []).filter(Boolean).map((a) => ({ kind: 'artist', name: a.name, sub: 'Artist', img: small(a), uri: a.uri })) },
      { key: 'album', title: 'Albums', items: ((j.albums || {}).items || []).filter(Boolean).map((a) => ({ kind: 'album', name: a.name, sub: 'Album · ' + names(a.artists), img: small(a), uri: a.uri })) },
      { key: 'playlist', title: 'Playlists', items: ((j.playlists || {}).items || []).filter(Boolean).map((p) => ({ kind: 'playlist', name: p.name, sub: 'Playlist' + ((p.owner && p.owner.display_name) ? ' · ' + p.owner.display_name : ''), img: small(p), uri: p.uri })) },
    ];
    rememberSearch(q);
    renderResults();
  } catch (e) { if (my === searchSeq) srNote('Could not reach Spotify.'); }
}

function renderResults() {
  const have = srGroups.filter((g) => g.items.length);
  if (!have.length) { srNote('Nothing found. Try another spelling.'); return; }
  if (srFilter !== 'all' && !have.some((g) => g.key === srFilter)) srFilter = 'all';
  const chips = $('srChips'); chips.textContent = ''; chips.hidden = have.length < 2;
  [{ key: 'all', title: 'All' }].concat(have).forEach((g) => {
    const b = document.createElement('button'); b.dataset.v = g.key; b.textContent = g.title;
    if (g.key === srFilter) b.className = 'on';
    chips.appendChild(b);
  });
  const box = $('srList'); box.textContent = '';
  have.filter((g) => srFilter === 'all' || g.key === srFilter).forEach((g) => {
    if (srFilter === 'all') { const h = document.createElement('div'); h.className = 'srH'; h.textContent = g.title; box.appendChild(h); }
    g.items.forEach((it) => {
      const b = document.createElement('button'); b.className = 'dev pl sr';
      const im = document.createElement('img'); im.alt = ''; im.loading = 'lazy'; im.src = it.img || '';
      if (it.kind === 'artist') im.style.borderRadius = '50%';
      const l = document.createElement('div');
      const n = document.createElement('b'); n.textContent = it.name || 'Untitled';
      const sm = document.createElement('small'); sm.textContent = it.sub;
      l.append(n, sm); b.append(im, l);
      b.addEventListener('click', () => playResult(it));
      box.appendChild(b);
    });
  });
}

async function playResult(it) {
  if (DEMO) { $('searchSheet').hidden = true; const i = DEMO_TRACKS.findIndex((d) => 'demo:' + d.id === it.uri); if (i >= 0) { demoIdx = i; demoLoad(i); } toast('Playing ' + it.name); return; }
  const body = it.kind === 'track' ? { uris: [it.uri] } : { context_uri: it.uri };
  const dev = S.device && S.device.id ? '?device_id=' + encodeURIComponent(S.device.id) : '';   // target the device we know, even if it went idle
  const r = await playerCall('PUT', '/me/player/play' + dev, body);
  if (r && r.ok) {
    $('searchSheet').hidden = true;
    toast('Playing ' + it.name);
    holdUI();
    S.playing = true;
    if (it.kind === 'track' && it.id) {                              // show the chosen song straight away; the polls below confirm it
      if (S.screen !== 'player') show('player');
      newTrack({ id: it.id, title: it.name, artist: it.sub, album: it.album, art: it.art, dur: it.dur, type: 'track', artistId: it.artistId });
    }
    S.anchor = { p: 0, t: Date.now() };
    renderPlayState();
    [700, 1800, 3500].forEach((ms) => setTimeout(poll, ms));         // Spotify takes a moment to report the new song
  } else if (r && r.status === 404) {
    $('searchSheet').hidden = true; openLibrary('dev'); toast('Pick a device to play on first');
  } else if (r && !r.ok && r.status !== 403 && r.status !== 429) {
    toast('Spotify could not play that (' + r.status + ')');
  }
}
