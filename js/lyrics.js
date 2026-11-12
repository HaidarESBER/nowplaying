/* Now Playing - Lyrics: LRCLIB lookup, choosing between versions, scrolling/browsing, word-by-word timing.
 * Classic script: shares one global scope with the other files in js/ (loaded in order, see index.html). */
'use strict';

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

// ------------------------------------------------------------------ lyrics from LRCLIB: choose the best version
// LRCLIB is a community database: one song can have a dozen uploads by different people, filed under different artists
// and titles, and their texts really differ (typos, missing ad-libs, even different words). So we collect every candidate,
// score each against the real song (title, artist, album, duration), merge identical copies (the more uploads agree, the
// more likely it is right), pick the best, and let the user switch to another version (key V or Settings), remembered per song.
const lyrKey = (t) => 'lyrpick:' + norm(String(t.artist || '').split(',')[0]) + '|' + norm(t.title);

function scoreLyr(r, t) {
  const names = String(t.artist || '').split(/,\s*/).filter(Boolean).map(norm);
  const rt = norm(r.trackName), tt = norm(t.title), ra = norm(r.artistName);
  let sc = 0;
  sc += rt === tt ? 4 : (rt && tt && (rt.includes(tt) || tt.includes(rt))) ? 2 : sameName(rt, tt) ? 1 : -2;
  sc += names.some((n) => ra === n || sameName(ra, n)) ? 3 : names.some((n) => n && ra.includes(n)) ? 2 : 0;
  if (t.album && norm(r.albumName) === norm(t.album)) sc += 1;
  if (r.duration) { const dd = Math.abs(r.duration - (t.dur || 0) / 1000); sc += dd <= 2 ? 3 : dd <= 6 ? 1 : -3; }
  if (r.instrumental) sc -= 5;
  return sc;
}

async function lyricCandidates(t, get) {
  const q = 'track_name=' + encodeURIComponent(t.title) + '&artist_name=' + encodeURIComponent(String(t.artist || '').split(',')[0]);
  const all = new Map();
  const add = (r) => { if (r && r.id != null && r.syncedLyrics && !all.has(r.id)) all.set(r.id, r); };
  add(await get('https://lrclib.net/api/get?' + q + (t.album ? '&album_name=' + encodeURIComponent(t.album) : '') + (t.dur ? '&duration=' + Math.round(t.dur / 1000) : '')));
  ((await get('https://lrclib.net/api/search?' + q)) || []).forEach(add);
  if (all.size < 3) ((await get('https://lrclib.net/api/search?q=' + encodeURIComponent((t.title + ' ' + String(t.artist || '').split(',')[0]).trim()))) || []).forEach(add);
  const groups = new Map();
  all.forEach((r) => {
    const lines = parseLrc(r.syncedLyrics);
    if (!lines.length) return;
    const sig = lines.map((l) => norm(l.s)).join('|');
    const g = groups.get(sig) || { recs: [], lines };
    g.recs.push(r); groups.set(sig, g);
  });
  const out = Array.from(groups.values()).map((g) => {
    g.recs.sort((a, b) => scoreLyr(b, t) - scoreLyr(a, t));
    g.best = g.recs[0]; g.n = g.recs.length;
    // uploads with a missing / wrong duration are usually sloppy copies; many identical uploads only mean one text was copied a lot
    const sane = g.recs.filter((r) => r.duration && Math.abs(r.duration - (t.dur || 0) / 1000) <= 6).length / g.n;
    g.score = scoreLyr(g.best, t) + 2 * sane + Math.min(g.n - 1, 4) * 0.15;
    return g;
  });
  out.sort((a, b) => b.score - a.score || b.lines.length - a.lines.length);
  return out;
}
if (DEMO) window.__npLoadLyrics = (t) => loadLyrics(t);
if (DEMO) window.__npLyrics = (t) => lyricCandidates(t, async (u) => { const r = await fetch(u); return r.ok ? r.json() : null; });

function lyrDescribe() {
  const L = S.lyr;
  if (!L) return S.lyrInfo || '';
  const g = L.cands[L.idx];
  return 'Version ' + (L.idx + 1) + ' of ' + L.cands.length + ' · ' + g.best.artistName + ' — ' + g.best.trackName + ' (' + g.lines.length + ' lines' + (g.n > 1 ? ', ' + g.n + ' identical uploads' : '') + ')';
}
function updateLyrInfo() { const e = $('lyrInfo'); if (e) e.textContent = lyrDescribe() || 'No lyrics yet'; }

async function useLyricVersion(i, remember) {
  const L = S.lyr; if (!L) return;
  L.idx = i;
  const g = L.cands[i];
  if (remember) store.set(lyrKey(L.t), String(g.best.id));
  if (g.lines.some((l) => /[؀-ۿ]/.test(l.s))) await loadArabicFonts();
  if (S.lyr !== L) return;
  setLyrics(g.lines);
  updateLyrInfo();
}
function nextLyricVersion() {
  const L = S.lyr;
  if (!L || L.cands.length < 2) { toast(L ? 'Only one version of these lyrics was found' : 'No lyrics to switch'); return; }
  useLyricVersion((L.idx + 1) % L.cands.length, true);
  toast(lyrDescribe());
}

async function loadLyrics(t) {
  if (S.lyricAbort) S.lyricAbort.abort();
  const ac = new AbortController(); S.lyricAbort = ac;
  S.lyr = null; S.lyrInfo = 'Looking up the lyrics…'; updateLyrInfo();
  const get = async (url) => {
    const r = await fetch(url, { signal: ac.signal });
    return r.ok ? r.json() : null;
  };
  try {
    const cands = await lyricCandidates(t, get);
    if (S.trackId !== t.id) return;
    if (!cands.length) { S.lyrInfo = 'No timed lyrics found for this song'; updateLyrInfo(); clearLyrics(); return; }
    let idx = 0;
    const picked = store.get(lyrKey(t));                             // a version you chose earlier wins
    if (picked) { const k = cands.findIndex((g) => g.recs.some((r) => String(r.id) === picked)); if (k >= 0) idx = k; }
    S.lyr = { cands, idx, t };
    await useLyricVersion(idx, false);
  } catch (e) {
    if (S.trackId === t.id && !ac.signal.aborted) { S.lyrInfo = 'Could not reach the lyrics service'; updateLyrInfo(); clearLyrics(); }   // offline: simply no lyrics
  }
}

let arabicFontsReady = null;
function loadArabicFonts() {
  if (!arabicFontsReady) {
    const loads = ['NP Cairo', 'NP Naskh', 'NP Kufi'].map((f) => (document.fonts && document.fonts.load ? document.fonts.load('700 20px "' + f + '"', 'ع') : Promise.resolve()));
    arabicFontsReady = Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 1800))]);
  }
  return arabicFontsReady;
}

function setLyrics(lines) {
  S.lines = lines; S.lineIdx = -3;
  if (typeof lyricsScriptHint === 'function') lyricsScriptHint();
  if (typeof lyricsLanguageHint === 'function') lyricsLanguageHint();
  renderLyrics();
  tickClock(); renderAmbient();
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
        p.dataset.t = l.s || '\u266a';                      // copy of the text: the rock "slice" animation draws it in halves
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

// "auto size": in the One line and Word by word styles a line of one or two words is drawn larger than the others.
// It only sets --act (the playing line's scale) on that line, so every entrance animation scales along with it.
const wordCount = (n) => (n.dataset.t || n.textContent || '').trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
function autoSize(n, isAct) {
  n.style.removeProperty('--act');
  if (!isAct || !cfg.autosize || (cfg.lstyle !== 'focus' && cfg.lstyle !== 'words')) return;
  const w = wordCount(n);
  if (w < 1 || w > 2) return;
  const base = parseFloat(getComputedStyle(n).getPropertyValue('--act')) || 1.25;
  n.style.setProperty('--act', (base * (w === 1 ? 1.9 : 1.5)).toFixed(2));
}
function refreshAutoSize() {                                          // after a settings change: redo the playing line
  const n = el.lyricsInner.children[S.lineIdx];
  if (n) { autoSize(n, true); setTimeout(() => centerLine(S.lineIdx, true), 60); }
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
    autoSize(n, d === 0);
    if (d === 0) startLineFx(n); else if (n._fx) clearFx(n);
    n.classList.toggle('d1', d === 1);
    n.classList.toggle('d2', d === 2);
    n.classList.toggle('nx', i === idx + 1);
  }
  prepareWords(idx);
  centerLine(idx, old === -3);
}

// Landscape / PC with lyrics showing: the top bar's right edge lines up with the right edge of the lyrics, so the clock's
// last digit sits on the same vertical line as the first letter of an Arabic (right-to-left) line.
function alignTopbar() {
  const tb = $('topbar');
  if (!tb) return;
  if (!(window.matchMedia && matchMedia('(orientation: landscape)').matches) || !document.body.classList.contains('lyrics')) { tb.style.removeProperty('right'); return; }
  const r = el.lyricsInner.getBoundingClientRect();
  if (r.width > 0) tb.style.right = Math.max(8, document.documentElement.clientWidth - r.right) + 'px';
}
new ResizeObserver(alignTopbar).observe(el.lyrics);
window.addEventListener('resize', alignTopbar);
window.addEventListener('orientationchange', () => setTimeout(alignTopbar, 250));

function centerLine(idx, instant) {
  alignTopbar();
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
