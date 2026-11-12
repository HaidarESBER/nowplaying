/* Now Playing - Genre: rules, online lookup (Apple Music, MusicBrainz, Spotify), applying the look.
 * Classic script: shares one global scope with the other files in js/ (loaded in order, see index.html). */
'use strict';

// ------------------------------------------------------------------ genre looks
// The artist's Spotify genres pick a "family"; the family decides the lyric typeface, glow, entrance animation
// and a soft drifting background (all CSS, see style.css). One lookup per new artist, cached in this browser.
const GENRE_RULES = [
  ['arabic', /classic arab|arabic classical|arab classical|arab folk|arabic folk|\btarab\b|andalusian|maqam|\boud\b|qawwali/],   // traditional Arabic music: before "classical" and "pop" can claim it
  ['hiphop', /hip.?hop|\brap\b|trap|drill|grime|boom bap|crunk|phonk/],
  ['rock', /metal|rock|punk|grunge|hardcore|\bemo\b|garage/],
  ['electronic', /^dance$|dance\/electronic|\bedm\b|electro|house|techno|trance|dubstep|drum and bass|\bdnb\b|synthwave|big room|future bass|hardstyle|\bclub\b|\brave\b/],
  ['classical', /classical|orchestra|opera|baroque|piano|jazz|bebop|swing|big band|soundtrack|\bscore\b|cinematic/],
  ['chill', /lo-?fi|chill|ambient|dream|downtempo|sleep|shoegaze|new age|bedroom|meditation|\bstudy\b/],
  ['soul', /r&b|\brnb\b|soul|funk|motown|disco|quiet storm|gospel/],
  ['country', /country|folk|bluegrass|americana|blues|singer.songwriter|acoustic|cowboy|western|\broots\b/],
  ['tropical', /reggae|dancehall|reggaeton|latin|salsa|bachata|afro|dembow|cumbia|tropical|samba|bossa|amapiano/],
  ['pop', /pop|dance|teen|boy band|idol/],
  // regional label only ("Arabic", "Khaleeji", "tarab"...): after the music genres, so Arabic pop is pop and Arabic rock is rock
  ['arabic', /arab|khaleeji|\brai\b|ra\u00ef|mizrahi|oud|tarab|maghreb|levant|egypt|lebanese|syrian|iraqi|gulf|shaabi|chaabi|mahraganat|fairuz|fairouz/],
  ['rock', /alternative|indie rock|britpop/],                 // weak match: only when nothing more specific fits
];
const FAMS = GENRE_RULES.map((r) => r[0]).filter((v, i, a) => a.indexOf(v) === i);
const FAM_NAMES = { hiphop: 'Hip-hop', rock: 'Rock', electronic: 'Electronic', classical: 'Classical & jazz', chill: 'Lo-fi & chill',
  soul: 'R&B & soul', country: 'Country & folk', arabic: 'Arabic', tropical: 'Latin & reggae', pop: 'Pop' };
const familyOf = (gs) => {
  const l = (gs || []).map((g) => String(g).toLowerCase());
  for (const [f, re] of GENRE_RULES) if (l.some((g) => re.test(g))) return f;
  return '';
};
S.gfam = '';
{ const gp = new URLSearchParams(location.search).get('genre'); if (gp) S.gforce = FAMS.indexOf(gp) >= 0 ? gp : ''; }   // ?genre=rock previews a look

function applyGenre() {
  const f = cfg.genre ? (S.gforce !== undefined ? S.gforce : S.gfam) : '';
  const cur = (document.body.className.match(/\bgn-(\w+)/) || [])[1] || '';
  if (cur === f) return;                                          // nothing changes: no relayout, no flicker
  const swap = () => {
    FAMS.forEach((k) => document.body.classList.toggle('gn-' + k, k === f));
    centerLine(S.lineIdx, true);                                  // the typeface changes line heights: re-centre while hidden
    tickClock(); renderAmbient();
    setTimeout(() => el.lyrics.classList.remove('relayout'), 40);
  };
  if (el.lyricsInner.children.length && S.screen === 'player') { el.lyrics.classList.add('relayout'); setTimeout(swap, 220); }
  else swap();
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
const GENERIC_GENRE = /^(worldwide|world|international|music|various|other|unknown|spoken word)$/i;
async function genreFromItunes(names, title) {
  const j = await fetchJson('https://itunes.apple.com/search?term=' + encodeURIComponent((names[0] + ' ' + title).slice(0, 120)) + '&entity=song&limit=15');
  const res = (j && j.results) || [];
  const want = names.map(norm).filter((n) => n.length > 1);
  const t = norm(title);
  const sameArtist = res.filter((r) => { const ra = norm(r.artistName); return ra && want.some((w) => sameName(ra, w)); });
  const exact = sameArtist.find((r) => { const rt = norm(r.trackName); return rt === t || rt.startsWith(t) || t.startsWith(rt); });
  const pick = exact || sameArtist[0];
  if (!pick) return null;
  const out = [pick.primaryGenreName];
  // the artist's other songs (strict name match, so a "feat." collaboration can't mislead), most common genre first
  const count = {};
  res.filter((r) => { const ra = norm(r.artistName); return r !== pick && !/[&,]|feat/i.test(r.artistName) && want.some((w) => sameName(ra, w)); })
     .forEach((r) => { count[r.primaryGenreName] = (count[r.primaryGenreName] || 0) + 1; });
  Object.keys(count).sort((a, b) => count[b] - count[a]).forEach((g) => out.push(g));
  return out;
}

// 2) MusicBrainz: community tags of the artist ("thrash metal", "jazz rap"...). Needs an exact name match; max 1 request/s.
let mbLast = 0;
async function genreFromMusicBrainz(name) {
  const wait = mbLast + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  mbLast = Date.now();
  const j = await fetchJson('https://musicbrainz.org/ws/2/artist/?query=' + encodeURIComponent('artist:"' + name.replace(/"/g, '') + '"') + '&fmt=json&limit=3', 9000);
  const n = norm(name);
  const hit = ((j && j.artists) || []).filter((x) => norm(x.name) === n && (x.score || 0) >= 90)
    .sort((p, q) => (q.tags || []).reduce((a, b) => a + b.count, 0) - (p.tags || []).reduce((a, b) => a + b.count, 0))[0];
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
  // A regional label ("Arabic") is only a last resort: a music genre from any source (rock, pop, hip-hop...) wins over it.
  let regional = null;
  const take = (list, src, shown) => {
    const f = familyOf(list);
    if (!f) return null;
    if (f === 'arabic') { if (!regional) regional = { f, raw: shown, src }; return null; }
    return done(f, shown, src);
  };
  try {
    const gl = await genreFromItunes(names, t.title);
    if (gl) {
      const usable = (g) => !GENERIC_GENRE.test(g) && familyOf([g]);
      const own = gl[0], others = gl.slice(1).filter(usable);
      if (usable(own) && familyOf([own]) !== 'arabic') return done(familyOf([own]), own, 'Apple Music');   // this very song is labelled with a music genre
      if (usable(own)) regional = { f: 'arabic', raw: own, src: 'Apple Music' };
      else if (others.some((g) => familyOf([g]) === 'arabic')) regional = { f: 'arabic', raw: others.find((g) => familyOf([g]) === 'arabic'), src: 'Apple Music (artist’s other songs)' };
      else if (others.length) return done(familyOf([others[0]]), others[0], 'Apple Music (artist’s other songs)');
      why.push('Apple Music says “' + own + '”');
    } else why.push('not on Apple Music');
  } catch (e) { why.push('Apple Music unreachable'); }
  try {
    const tags = names[0] ? await genreFromMusicBrainz(names[0]) : null;
    if (tags) { const r1 = take(tags, 'MusicBrainz', tags.slice(0, 3).join(', ')); if (r1) return r1; if (!regional) why.push('MusicBrainz tags didn’t match a look'); } else why.push('no MusicBrainz tags');
  } catch (e) { why.push('MusicBrainz unreachable'); }
  try {
    const gs = await genreFromSpotify(t.artistId, why);
    if (gs) { const r2 = take(gs, 'Spotify', gs.slice(0, 3).join(', ')); if (r2) return r2; if (!regional) why.push('Spotify genres didn’t match a look'); }
  } catch (e) { why.push('Spotify lookup failed'); }
  if (regional) return done(regional.f, regional.raw, regional.src);
  return done('', '', '');
}
if (DEMO) window.__npDetect = detectGenre;                          // for testing the lookup against the real services

const isArabicScript = (x) => /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(x);
function arabicByScript(t) {
  if (isArabicScript(String(t.title) + String(t.artist))) return 'the title or artist';
  if (S.lines && S.lines.length > 3 && S.lines.filter((l) => isArabicScript(l.s)).length >= S.lines.length * 0.5) return 'the lyrics';
  return '';
}

function lyricsScriptHint() {                                    // no genre found (yet) but the lyrics are Arabic: use the Arabic look
  if (S.gfam || !cfg.genre || !S.track || /Looking up/.test(S.ginfo || '')) return;
  const by = arabicByScript(S.track);
  if (by) { S.gfam = 'arabic'; S.ginfo = 'Arabic \u00b7 via ' + by + ' (Arabic script)'; applyGenre(); updateGenreInfo(); }
}

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
  if (!r.fam) { const by = arabicByScript(t); if (by) r = { fam: 'arabic', raw: 'Arabic script', src: by, why: '' }; }
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
