/* Now Playing - Cover colours and the line-animation engine (sliced, shattered, torn, word effects), plus the calm-mode phrase.
 * Classic script: shares one global scope with the other files in js/ (loaded in order, see index.html). */
'use strict';

// ------------------------------------------------------------------ colours of the cover -> three hues for the genre looks

function paletteOf(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const im = new Image();
    im.crossOrigin = 'anonymous';                                   // Spotify's image servers allow this; otherwise we keep the look's own colours
    const to = setTimeout(() => resolve(null), 3000);
    im.onload = () => {
      clearTimeout(to);
      try {
        const N = 40, cv = document.createElement('canvas');
        cv.width = cv.height = N;
        const g = cv.getContext('2d', { willReadFrequently: true });
        g.drawImage(im, 0, 0, N, N);
        const d = g.getImageData(0, 0, N, N).data;
        const wgt = new Array(36).fill(0), sx = new Array(36).fill(0), sy = new Array(36).fill(0);
        let vivid = 0;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
          const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), df = mx - mn;
          if (mx < 0.2 || df < 0.12) continue;                      // too dark or grey: no useful hue
          let h = mx === r ? ((gg - b) / df) % 6 : mx === gg ? (b - r) / df + 2 : (r - gg) / df + 4;
          h = (h * 60 + 360) % 360;
          const w = (df / mx) * (df / mx) * mx;                     // vivid, bright pixels count most
          const k = Math.floor(h / 10) % 36;
          wgt[k] += w; sx[k] += w * Math.cos(h * Math.PI / 180); sy[k] += w * Math.sin(h * Math.PI / 180); vivid += w;
        }
        if (vivid < N * N * 0.02) return resolve(null);              // a grey / dark cover keeps the look's own colours
        const hueOf = (k) => Math.round(((Math.atan2(sy[k], sx[k]) * 180 / Math.PI) + 360) % 360);
        const score = (k) => wgt[k] + 0.5 * (wgt[(k + 35) % 36] + wgt[(k + 1) % 36]);
        const order = Array.from({ length: 36 }, (_, k) => k).sort((a, b) => score(b) - score(a));
        const gap = (a, b) => { const x = Math.abs(a - b) % 360; return x > 180 ? 360 - x : x; };
        const h1 = hueOf(order[0]);
        let h2 = null, h3 = null;
        for (const k of order) {
          if (!wgt[k]) break;
          const h = hueOf(k);
          if (h2 === null) { if (gap(h, h1) >= 40) h2 = h; }
          else if (gap(h, h1) >= 40 && gap(h, h2) >= 40) { h3 = h; break; }
        }
        if (h2 === null) h2 = (h1 + 35) % 360;                       // single-colour cover: a neighbour and the complement
        if (h3 === null) h3 = (h1 + 180) % 360;
        resolve({ h1, h2, h3 });
      } catch (e) { resolve(null); }
    };
    im.onerror = () => { clearTimeout(to); resolve(null); };
    im.src = url;
  });
}
function applyPalette(p) {
  const st = document.body.style;
  if (p) { st.setProperty('--h1', p.h1); st.setProperty('--h2', p.h2); st.setProperty('--h3', p.h3); }
  else ['--h1', '--h2', '--h3'].forEach((k) => st.removeProperty(k));
}
if (DEMO) window.__npPalette = paletteOf;                            // for testing

// ------------------------------------------------------------------ line animations: sliced, shattered, torn, chopped...
// The playing line is drawn as several clipped copies ("pieces") that fly in and lock together exactly over the real
// text, or as individually animated words. Geometry (cut angles, shard shapes, offsets, timing) is random per line, and the
// pieces start in colours taken from the cover and turn into the text colour as they land. Clip-path pieces keep Arabic
// and other joined scripts intact.
const R = (a, b) => a + Math.random() * (b - a);
const sgn = () => (Math.random() < 0.5 ? -1 : 1);
const tint = () => ['var(--ca)', 'var(--cb)', 'var(--cc)'][Math.floor(Math.random() * 3)];
const poly = (pts) => 'polygon(' + pts.map((p) => p[0].toFixed(1) + '% ' + p[1].toFixed(1) + '%').join(',') + ')';
const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

const WORD_FX = { chop: 1, wave: 1, swing: 1, pop: 1 };
const FX_LABEL = { katana: 'Katana slash', xcut: 'X-cut', shatter: 'Shatter', tear: 'Tear', blinds: 'Blinds', zip: 'Zipper', glitch: 'Glitch bands',
  doors: 'Split doors', chop: 'Word chop', wave: 'Word wave', swing: 'Word swing', pop: 'Word pop',
  v0: 'Signature 1', v1: 'Signature 2', v2: 'Signature 3', v3: 'Signature 4' };
// each look draws from its own set (v0-v3 are the look's own CSS signature entrances)
const FX_POOL = {
  hiphop:     ['v0', 'v1', 'v2', 'v3', 'chop', 'zip', 'katana', 'blinds'],
  rock:       ['v0', 'v1', 'v2', 'v3', 'katana', 'xcut', 'shatter', 'tear', 'blinds'],
  electronic: ['v0', 'v1', 'v2', 'v3', 'glitch', 'blinds', 'zip', 'shatter'],
  classical:  ['v0', 'v1', 'v2', 'v3', 'doors', 'blinds', 'wave', 'swing'],
  chill:      ['v0', 'v1', 'v2', 'v3', 'wave', 'swing', 'doors'],
  soul:       ['v0', 'v1', 'v2', 'v3', 'wave', 'swing', 'pop'],
  country:    ['v0', 'v1', 'v2', 'v3', 'tear', 'swing', 'pop'],
  arabic:     ['v0', 'v1', 'v2', 'v3', 'doors', 'blinds', 'katana', 'wave', 'swing', 'pop'],
  tropical:   ['v0', 'v1', 'v2', 'v3', 'pop', 'chop', 'shatter', 'wave'],
  pop:        ['v0', 'v1', 'v2', 'v3', 'pop', 'chop', 'shatter', 'wave', 'zip'],
};
const activeFam = () => (cfg.genre ? (S.gforce !== undefined ? S.gforce : S.gfam) : '');

function clearFx(n) {
  clearTimeout(n._fxT);
  n.querySelectorAll('.sl, .slash').forEach((x) => x.remove());
  n.classList.remove('fx-run', 'fx-fade', 'wfx-chop', 'wfx-wave', 'wfx-swing', 'wfx-pop');
  if (n._wrapped) { n.textContent = n.dataset.t || n.textContent; n._wrapped = false; }
  n._fx = false;
}

// geometry of one effect: pieces {cp, dx, dy, rot, sc, d, tint, cls}, optional slash lines, duration in seconds
function fxGeometry(kind, w, h) {
  const pieces = [], slashes = [];
  let dur = 0.9;
  if (kind === 'katana') {
    const y1 = R(26, 52), y2 = 100 - y1 + R(-10, 10);
    const ang = Math.atan2(((y2 - y1) / 100) * h, w);
    pieces.push({ cp: poly([[0, 0], [100, 0], [100, y2], [0, y1]]), dx: -R(80, 140), dy: -R(16, 30), rot: R(-3, 0), sc: 1, d: 0, tint: tint(), cls: 'k' });
    pieces.push({ cp: poly([[0, y1], [100, y2], [100, 100], [0, 100]]), dx: R(80, 140), dy: R(16, 30), rot: R(0, 3), sc: 1, d: 0, tint: tint(), cls: 'k' });
    slashes.push({ y: (y1 + y2) / 2, ang: (ang * 180) / Math.PI, len: Math.hypot(w, ((y2 - y1) / 100) * h), sd: 0.3 });
    dur = 1.0;
  } else if (kind === 'xcut') {
    const cx = 50 + R(-10, 10), cy = 50 + R(-12, 12);
    const a = (Math.atan2(h, w) * 180) / Math.PI, len = Math.hypot(w, h);
    pieces.push({ cp: poly([[0, 0], [100, 0], [cx, cy]]), dx: R(-30, 30), dy: -R(26, 40), rot: R(-4, 4), sc: 1, d: 0, tint: tint(), cls: 'k' });
    pieces.push({ cp: poly([[100, 0], [100, 100], [cx, cy]]), dx: R(70, 120), dy: R(-14, 14), rot: R(-4, 4), sc: 1, d: 0, tint: tint(), cls: 'k' });
    pieces.push({ cp: poly([[100, 100], [0, 100], [cx, cy]]), dx: R(-30, 30), dy: R(26, 40), rot: R(-4, 4), sc: 1, d: 0, tint: tint(), cls: 'k' });
    pieces.push({ cp: poly([[0, 100], [0, 0], [cx, cy]]), dx: -R(70, 120), dy: R(-14, 14), rot: R(-4, 4), sc: 1, d: 0, tint: tint(), cls: 'k' });
    slashes.push({ y: 50, ang: a, len, sd: 0.22 }, { y: 50, ang: -a, len, sd: 0.34 });
    dur = 1.05;
  } else if (kind === 'tear') {
    const n = 14, top = [];
    for (let i = 0; i <= n; i++) { const y = 50 + (i % 2 ? -1 : 1) * R(3, 11); top.push([(i * 100) / n, y]); }
    pieces.push({ cp: poly([[0, 0], [100, 0]].concat(top.slice().reverse())), dx: R(-14, 14), dy: -R(24, 40), rot: R(-3, 0), sc: 1, d: 0, tint: tint(), cls: 'k' });
    pieces.push({ cp: poly(top.concat([[100, 100], [0, 100]])), dx: R(-14, 14), dy: R(24, 40), rot: R(0, 3), sc: 1, d: 0, tint: tint(), cls: 'k' });
    dur = 0.95;
  } else if (kind === 'doors') {
    pieces.push({ cp: 'inset(0 50% 0 0)', dx: -R(200, 280), dy: 0, rot: 0, sc: 1, d: 0, tint: tint() });
    pieces.push({ cp: 'inset(0 0 0 50%)', dx: R(200, 280), dy: 0, rot: 0, sc: 1, d: 0, tint: tint() });
    dur = 0.85;
  } else if (kind === 'blinds') {
    const n = 7;
    for (let i = 0; i < n; i++) {
      pieces.push({ cp: 'inset(' + Math.max(0, (i * 100) / n - 0.4).toFixed(2) + '% 0 ' + Math.max(0, 100 - ((i + 1) * 100) / n - 0.4).toFixed(2) + '% 0)',
        dx: (i % 2 ? 1 : -1) * R(180, 300), dy: 0, rot: 0, sc: 1, d: i * 0.05, tint: tint() });
    }
    dur = 0.7;
  } else if (kind === 'zip') {
    const n = Math.max(8, Math.min(16, Math.round(w / 40)));
    for (let i = 0; i < n; i++) {
      pieces.push({ cp: 'inset(0 ' + Math.max(0, 100 - ((i + 1) * 100) / n - 0.3).toFixed(2) + '% 0 ' + Math.max(0, (i * 100) / n - 0.3).toFixed(2) + '%)',
        dx: 0, dy: (i % 2 ? -1 : 1) * R(46, 90), rot: 0, sc: 1, d: i * 0.035, tint: tint() });
    }
    dur = 0.65;
  } else if (kind === 'glitch') {
    const cuts = [0];
    for (let i = 0; i < 5; i++) cuts.push(R(8, 92));
    cuts.sort((p, q) => p - q); cuts.push(100);
    for (let i = 0; i < cuts.length - 1; i++) {
      pieces.push({ cp: 'inset(' + cuts[i].toFixed(1) + '% 0 ' + (100 - cuts[i + 1]).toFixed(1) + '% 0)', dx: sgn() * R(30, 120), dy: 0, rot: 0, sc: 1, d: i * 0.03, tint: tint(), cls: 'g' });
    }
    dur = 0.65;
  } else {                                                          // shatter: a jittered grid of jagged shards
    const cols = Math.max(4, Math.min(9, Math.round(w / 70))), rows = 3;
    const V = [];
    for (let r = 0; r <= rows; r++) {
      V.push([]);
      for (let c = 0; c <= cols; c++) {
        const edgeX = c === 0 || c === cols, edgeY = r === 0 || r === rows;
        V[r].push([(c * 100) / cols + (edgeX ? 0 : R(-5, 5)), (r * 100) / rows + (edgeY ? 0 : R(-14, 14))]);
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        pieces.push({ cp: poly([V[r][c], V[r][c + 1], V[r + 1][c + 1], V[r + 1][c]]), dx: R(-300, 300), dy: R(-200, 200), rot: R(-45, 45), sc: R(0.5, 1.8), d: R(0, 0.22), tint: tint() });
      }
    }
    dur = 0.75;
  }
  return { pieces, slashes, dur };
}

function runFx(n, kind) {
  const w = n.offsetWidth, h = n.offsetHeight, text = n.dataset.t || '';
  if (!w || !h || !text) return;
  n._fx = true;
  if (WORD_FX[kind]) {                                              // words animate one after another
    const toks = text.split(/(\s+)/);
    n.textContent = '';
    let i = 0;
    toks.forEach((tk) => {
      if (!tk || /^\s+$/.test(tk)) { if (tk) n.appendChild(document.createTextNode(tk)); return; }
      const sp = document.createElement('span');
      sp.className = 'wd'; sp.textContent = tk;
      sp.style.setProperty('--i', i++); sp.style.setProperty('--r', R(-25, 25).toFixed(1));
      n.appendChild(sp);
    });
    n._wrapped = true;
    n.classList.add('wfx-' + kind);
    n._fxT = setTimeout(() => clearFx(n), 600 + i * 110 + 900);
    return;
  }
  const g = fxGeometry(kind, w, h);
  n.classList.add('fx-run');                                        // the real text waits while the pieces assemble
  let tail = 0;
  g.pieces.forEach((p) => {
    const s = document.createElement('span');
    s.className = 'sl ' + (p.cls || '');
    s.dir = 'auto';
    s.textContent = text;
    s.style.cssText = '--cp:' + p.cp + ';--dx:' + p.dx.toFixed(0) + 'px;--dy:' + p.dy.toFixed(0) + 'px;--rot:' + p.rot.toFixed(1) + 'deg;--sc:' + p.sc.toFixed(2) +
      ';--d:' + p.d.toFixed(3) + 's;--dur:' + g.dur + 's;--tint:' + p.tint;
    n.appendChild(s);
    tail = Math.max(tail, p.d);
  });
  g.slashes.forEach((sl) => {                                       // the blade that "does" the cutting
    const i = document.createElement('i');
    i.className = 'slash';
    i.style.cssText = 'top:' + sl.y.toFixed(1) + '%;width:' + sl.len.toFixed(0) + 'px;--sa:' + sl.ang.toFixed(2) + 'deg;--dur:' + g.dur + 's;--sd:' + sl.sd + 's';
    n.appendChild(i);
  });
  n._fxT = setTimeout(() => {
    n.classList.remove('fx-run'); n.classList.add('fx-fade');      // the real text shows underneath while the pieces fade out
    n._fxT = setTimeout(() => clearFx(n), 260);
  }, (g.dur + tail) * 1000 + 90);
}

// entrances whose keyframes animate letter-spacing: they tear Arabic's joined letters apart, so right-to-left lines never get them
const LETTER_SPACING_FX = { hiphop: ['v2'], classical: ['v0', 'v2'] };
function poolFor(fam, n, ignoreWords) {
  let pool = (FX_POOL[fam] || []).slice();
  if (!ignoreWords && wantsWords()) pool = pool.filter((t) => /^v\d$/.test(t));      // karaoke / word-by-word keep their own word timing
  if (n && n.classList.contains('rtl')) pool = pool.filter((t) => (LETTER_SPACING_FX[fam] || []).indexOf(t) < 0);
  return pool;
}

// choose the entrance for a line that just became active (never the same twice in a row)
function startLineFx(n, forced) {
  clearFx(n);
  forced = forced || S.fxForce;
  const fam = activeFam();
  const pool = poolFor(fam, n, !!forced);
  if (!fam || REDUCED || !pool.length) { n.dataset.v = '0'; return; }
  let t = forced;
  if (!t) { do { t = pool[Math.floor(Math.random() * pool.length)]; } while (t === S.fxLast && pool.length > 1); }
  S.fxLast = t;
  if (/^v\d$/.test(t)) { n.dataset.v = t.slice(1); return; }
  n.dataset.v = 'x';
  runFx(n, t);
}
const fxParam = new URLSearchParams(location.search).get('fx');   // ?fx=katana always uses that effect (preview / testing)
if (fxParam) S.fxForce = fxParam;
let fxCycle = -1;
function cycleFx() {                                              // X: replay the playing line with the next effect of this look
  const fam = activeFam();
  const act = el.lyricsInner.querySelector('.ln.act');
  if (!fam || !act) { toast('Play a song with lyrics and a genre look first'); return; }
  const pool = poolFor(fam, act, true);
  fxCycle = (fxCycle + 1) % pool.length;
  S.fxForce = undefined;
  startLineFx(act, pool[fxCycle]);
  toast(FX_LABEL[pool[fxCycle]] + '  (' + (fxCycle + 1) + '/' + pool.length + ')');
}

// ------------------------------------------------------------------ the phrase shown while the buttons are hidden
function renderAmbient() {                                      // always English, whatever the song's language
  const n = getName();
  $('ambMain').textContent = n ? 'Hi ' + n + ',' : 'Hi there,';
  $('ambSub').textContent = 'you’re now listening to:';
  $('ambient').dir = 'ltr';
}
renderAmbient();
