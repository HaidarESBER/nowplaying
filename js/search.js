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
function srSkeleton() {
  $('srChips').hidden = true;
  const box = $('srList'); box.textContent = '';
  for (let k = 0; k < 6; k++) {
    const r = document.createElement('div'); r.className = 'srSk';
    r.innerHTML = '<i></i><div><b></b><small></small></div>';
    box.appendChild(r);
  }
}
const srCache = new Map();                                          // query -> { t, groups }: no second request for a query seen in the last 5 minutes
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
  const hit = srCache.get(q.toLowerCase());
  if (hit && Date.now() - hit.t < 300000) { srGroups = hit.groups; renderResults(); return; }
  srSkeleton();
  try {
    // market=from_token: only songs playable in the user's country (without it Spotify lists songs the player then silently refuses)
    const base = '/search?type=track,artist,album,playlist&limit=8&q=' + encodeURIComponent(q);
    let r = await api('GET', base + '&market=from_token');
    if (!r.ok && r.status !== 429) r = await api('GET', base);
    if (my !== searchSeq) return;
    if (r.status === 429) { srNote('Spotify is busy, try again in a moment.'); return; }
    if (!r.ok) { srNote('Search failed (' + r.status + ').'); return; }
    const j = await r.json();
    if (my !== searchSeq) return;
    const small = (o) => { const a = (o && o.images) || []; return a.length ? a[a.length - 1].url : ''; };
    const big = (o) => { const a = (o && o.images) || []; return a.length ? a[0].url : ''; };
    const mkUri = (type, o) => o.uri || (o.id ? 'spotify:' + type + ':' + o.id : '');
    const names = (a) => (a || []).map((x) => x.name).join(', ');
    srGroups = [
      { key: 'track', title: 'Songs', items: ((j.tracks || {}).items || []).filter((t) => t && t.is_playable !== false).map((t) => ({ kind: 'track', id: t.id, name: t.name, sub: names(t.artists), album: (t.album || {}).name || '', dur: t.duration_ms || 0, img: small(t.album), art: big(t.album), uri: mkUri('track', t), artistId: (t.artists && t.artists[0] && t.artists[0].id) || '' })) },
      { key: 'artist', title: 'Artists', items: ((j.artists || {}).items || []).filter(Boolean).map((a) => ({ kind: 'artist', name: a.name, sub: 'Artist', img: small(a), uri: mkUri('artist', a) })) },
      { key: 'album', title: 'Albums', items: ((j.albums || {}).items || []).filter(Boolean).map((a) => ({ kind: 'album', name: a.name, sub: 'Album · ' + names(a.artists), img: small(a), uri: mkUri('album', a) })) },
      { key: 'playlist', title: 'Playlists', items: ((j.playlists || {}).items || []).filter(Boolean).map((p) => ({ kind: 'playlist', name: p.name, sub: 'Playlist' + ((p.owner && p.owner.display_name) ? ' · ' + p.owner.display_name : ''), img: small(p), uri: mkUri('playlist', p) })) },
    ];
    rememberSearch(q);
    srCache.set(q.toLowerCase(), { t: Date.now(), groups: srGroups });
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
  let first = srFilter === 'all';                                   // the very first result gets a big card
  have.filter((g) => srFilter === 'all' || g.key === srFilter).forEach((g) => {
    if (srFilter === 'all' && !first) { const h = document.createElement('div'); h.className = 'srH'; h.textContent = g.title; box.appendChild(h); }
    g.items.forEach((it) => {
      const b = document.createElement('button'); b.className = 'dev pl sr' + (first ? ' top' : '');
      if (first) { const h = document.createElement('div'); h.className = 'srH'; h.textContent = 'Top result'; box.appendChild(h); }
      b.dataset.kind = it.kind;
      const im = document.createElement('img'); im.alt = ''; im.loading = 'lazy'; im.decoding = 'async'; im.src = (first && it.art) || it.img || '';
      if (it.kind === 'artist') im.style.borderRadius = '50%';
      const l = document.createElement('div');
      const n = document.createElement('b'); n.textContent = it.name || 'Untitled';
      const sm = document.createElement('small'); sm.textContent = it.sub;
      l.append(n, sm); b.append(im, l);
      b.addEventListener('click', () => playResult(it));
      box.appendChild(b);
      if (first) { first = false; if (g.items.length > 1) { const h = document.createElement('div'); h.className = 'srH'; h.textContent = g.title; box.appendChild(h); } }
    });
  });
}

async function readPlayer() {
  try { const r = await api('GET', '/me/player?additional_types=episode'); return r.status === 200 ? await r.json() : null; } catch (e) { return null; }
}
async function errWhy(r) {
  try { const j = await r.clone().json(); return (j.error && (j.error.reason || j.error.message)) || ''; } catch (e) { return ''; }
}
// did Spotify really start what we asked for?
const isPlayingIt = (j, it) => !!(j && j.is_playing && (it.kind === 'track'
  ? (j.item && (j.item.id === it.id || j.item.uri === it.uri || j.item.name === it.name))
  : (j.context && j.context.uri === it.uri)));

async function playResult(it) {
  if (DEMO) { $('searchSheet').hidden = true; const i = DEMO_TRACKS.findIndex((d) => 'demo:' + d.id === it.uri); if (i >= 0) { demoIdx = i; demoLoad(i); } toast('Playing ' + it.name); return; }
  if (!it.uri) { toast('Spotify sent no link for this result'); return; }
  srNote('Starting “' + it.name + '”…');
  const log = [];
  const dev = S.device && S.device.id ? S.device : null;
  const body = it.kind === 'track' ? { uris: [it.uri], position_ms: 0 } : { context_uri: it.uri };
  let j = null;

  // songs: do what the Next button does. Queue the song, give Spotify a moment to register it, then press next
  // (pressing next straight away skips before the queue knows about the song, and the player ends up idle)
  const viaQueue = async () => {
    const qa = await api('POST', '/me/player/queue?uri=' + encodeURIComponent(it.uri)).catch(() => null);
    log.push('queue: ' + (qa ? qa.status + ' ' + (await errWhy(qa)) : 'no answer'));
    if (!qa || !qa.ok) return;
    await sleep(1000);
    for (let k = 0; k < 3 && !isPlayingIt(j, it); k++) {            // more than one press if other songs were queued before it
      const nx = await api('POST', '/me/player/next').catch(() => null);
      log.push('next: ' + (nx ? nx.status + ' ' + (await errWhy(nx)) : 'no answer'));
      if (!nx || !nx.ok) break;
      await sleep(1300); j = await readPlayer();
      if (j && j.item && !j.is_playing && !isPlayingIt(j, it)) {    // skipped but paused
        const rs = await api('PUT', '/me/player/play').catch(() => null); log.push('resume: ' + (rs ? rs.status : 'no answer'));
        await sleep(700); j = await readPlayer();
      }
    }
    if (j && j.item && !j.is_playing && isPlayingIt({ ...j, is_playing: true }, it)) {   // the right song, but paused
      const rs = await api('PUT', '/me/player/play').catch(() => null); log.push('resume: ' + (rs ? rs.status : 'no answer'));
      await sleep(700); j = await readPlayer();
    }
  };
  if (it.kind === 'track') await viaQueue();

  // direct command (albums, artists, playlists; and songs when the queue route did not work)
  if (!isPlayingIt(j, it)) {
    let r = await api('PUT', '/me/player/play' + (dev && !dev.is_active ? '?device_id=' + encodeURIComponent(dev.id) : ''), body).catch(() => null);
    log.push('play: ' + (r ? r.status + ' ' + (await errWhy(r)) : 'no answer'));
    if (r && r.status === 403) { toast('This needs Spotify Premium'); }
    if (r && r.status === 404 && dev) {                                 // no active device: wake the one we know, then ask again
      const t = await api('PUT', '/me/player', { device_ids: [dev.id], play: true }).catch(() => null);
      log.push('wake device: ' + (t ? t.status : 'no answer'));
      await sleep(900);
      r = await api('PUT', '/me/player/play', body).catch(() => null);
      log.push('play again: ' + (r ? r.status + ' ' + (await errWhy(r)) : 'no answer'));
    } else if (r && r.status === 404) { openLibrary('dev'); $('searchSheet').hidden = true; toast('Pick a device to play on first'); return; }
    if (r && r.ok) { await sleep(1300); j = await readPlayer(); }
  }

  if (isPlayingIt(j, it)) {
    $('searchSheet').hidden = true;
    toast('Playing ' + it.name);
    setPlayer(j); setTimeout(poll, 1500);
    return;
  }

  // 3) it did not work: say exactly why, in the sheet
  const d = (j && j.device) || dev || {};
  const lines = [
    'Spotify did not start “' + it.name + '”.',
    'Device: ' + (d.name || 'none') + (d.type ? ' (' + d.type + ')' : '') + (d.is_restricted ? ', RESTRICTED: it ignores remote commands' : '') + (d.is_active === false ? ', idle' : ''),
    'Spotify now plays: ' + (j && j.item ? j.item.name + (j.is_playing ? '' : ' (paused)') : 'nothing'),
  ].concat(log);
  const box = $('srList'); box.textContent = '';
  lines.forEach((t, k) => { const p = document.createElement('p'); p.className = 'devNote'; p.textContent = t; if (k === 0) p.style.fontWeight = '700'; box.appendChild(p); });
  const again = document.createElement('button'); again.className = 'pill'; again.textContent = 'Try again';
  again.addEventListener('click', () => playResult(it)); box.appendChild(again);
  setTimeout(poll, 500);
}
