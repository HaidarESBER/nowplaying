/* Now Playing - Picture in picture: a small always-on-top player (cover, title, current lyric line, progress, controls).
 * Chrome / Edge / Opera on a computer: a real window we design ourselves (Document Picture-in-Picture), fully interactive.
 * Safari / iPhone / Firefox / Android: the same picture drawn on a canvas and shown as a video in picture-in-picture,
 * with the play / next / previous buttons coming from the system's media controls.
 * Classic script: shares one global scope with the other files in js/ (loaded in order, see index.html). */
'use strict';

const PIP_DOC = 'documentPictureInPicture' in window;
const PIP_VID = !!(document.createElement('canvas').captureStream) &&
  !!((document.pictureInPictureEnabled) || (HTMLVideoElement.prototype.webkitSetPresentationMode));
let pip = null;                                                      // { mode: 'doc' | 'video', ... } while open
const pipActive = () => !!pip;

const PIP_ICO = {
  prev: 'M6 6h2v12H6zm3.5 6l8.5 6V6z', next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z', play: 'M8 5v14l11-7z', pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  heart: 'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z',
  hearton: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  back: 'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
};
const pipSvg = (d, cls) => '<svg viewBox="0 0 24 24" class="' + (cls || '') + '"><path d="' + d + '"/></svg>';

// the palette and look of the main page, read live: three hues from the cover, the genre family and its typeface
function pipLook() {
  const cs = getComputedStyle(document.body);
  const g = (n, d) => (cs.getPropertyValue(n).trim() || d);
  return { h1: g('--h1', '30'), h2: g('--h2', '200'), h3: g('--h3', '320'), font: g('--gfont', ''), fam: (document.body.className.match(/\bgn-(\w+)/) || [])[1] || '' };
}
// the Arabic fonts of the page, with absolute URLs, so the small window can use them too
function pipFontCss() {
  const base = new URL('.', location.href).href;
  let out = '';
  try {
    for (const sh of document.styleSheets) for (const r of sh.cssRules) {
      if (r.type === CSSRule.FONT_FACE_RULE) out += r.cssText.replace(/url\((["']?)(?!https?:|data:)(?:\.\/)?/g, 'url($1' + base) + '\n';
    }
  } catch (e) { /* cross-origin sheets: skip */ }
  return out;
}

// ------------------------------------------------------------------ the window (Document Picture-in-Picture)
const PIP_CSS = `
*{box-sizing:border-box;margin:0}
html,body{height:100%;overflow:hidden;background:#0b0b0e;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#fff;-webkit-font-smoothing:antialiased}
button{font:inherit;color:inherit;border:0;background:none;cursor:pointer;-webkit-tap-highlight-color:transparent}
svg{fill:currentColor;display:block}
.pp{position:fixed;inset:0;container-type:size;overflow:hidden;--h1:30;--h2:200;--h3:320;
  --a:hsl(var(--h1) 95% 62%);--b:hsl(var(--h2) 95% 64%);--c:hsl(var(--h3) 95% 70%)}
.bg{position:absolute;inset:-35%;background:#222 center/cover no-repeat;filter:blur(36px) saturate(1.8) brightness(.55);transition:background-image .6s ease}
.tint{position:absolute;inset:0;background:
  radial-gradient(110% 80% at 0% 0%,hsl(var(--h1) 95% 58%/.38),transparent 62%),
  radial-gradient(90% 70% at 100% 100%,hsl(var(--h2) 95% 58%/.3),transparent 60%),
  linear-gradient(180deg,rgba(0,0,0,.12),rgba(0,0,0,.62))}
.wrap{position:relative;height:100%;display:grid;gap:clamp(6px,2.6cqh,12px) clamp(10px,3cqw,16px);padding:clamp(10px,4.2cqmin,18px);
  grid-template-columns:auto minmax(0,1fr) auto;grid-template-rows:auto minmax(0,1fr) auto auto;
  grid-template-areas:"art meta side" "lyr lyr lyr" "bar bar bar" "ctl ctl ctl"}
.art{grid-area:art;width:clamp(52px,24cqh,92px);aspect-ratio:1;border-radius:clamp(9px,3cqh,16px);object-fit:cover;background:#2a2a2e center/cover;
  box-shadow:0 10px 28px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.12);transition:transform .4s cubic-bezier(.2,.9,.3,1)}
.pp.playing .art{animation:glow 2.4s ease-in-out infinite}
@keyframes glow{0%,100%{box-shadow:0 10px 28px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.12),0 0 0 0 hsl(var(--h1) 95% 60%/0)}50%{box-shadow:0 10px 28px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.2),0 0 26px 2px hsl(var(--h1) 95% 60%/.55)}}
.meta{grid-area:meta;min-width:0;align-self:center}
.t{font-weight:800;font-size:clamp(14px,7.4cqh,21px);line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 2px 12px rgba(0,0,0,.5)}
.a{margin-top:3px;font-size:clamp(11px,5.2cqh,14.5px);color:rgba(255,255,255,.72);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.side{grid-area:side;display:flex;gap:2px;align-self:start;margin:-4px -6px 0 0}
.side button{width:34px;height:34px;display:grid;place-items:center;border-radius:50%;color:rgba(255,255,255,.75);transition:background .15s,color .15s,transform .15s}
.side button:hover{background:rgba(255,255,255,.14);color:#fff}
.side svg{width:20px;height:20px}
.like.on{color:hsl(350 95% 66%)}
.like.pop svg{animation:pop .35s ease-out}
@keyframes pop{0%{transform:scale(.6)}60%{transform:scale(1.3)}100%{transform:scale(1)}}
.lyr{grid-area:lyr;display:flex;flex-direction:column;justify-content:center;min-height:0;text-align:center;padding:0 2px}
.now{font-weight:800;line-height:1.16;font-size:clamp(15px,9.4cqh,28px);text-shadow:0 2px 14px rgba(0,0,0,.65),0 0 2px rgba(0,0,0,.9);
  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;color:#fff}
.now.in{animation:lin .5s cubic-bezier(.2,.9,.3,1) both}
@keyframes lin{0%{opacity:0;transform:translateY(12px) scale(.97);filter:blur(3px)}100%{opacity:1;transform:none;filter:none}}
.nx{margin-top:clamp(3px,1.6cqh,8px);font-size:clamp(11px,5.6cqh,16px);font-weight:600;color:rgba(255,255,255,.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 8px rgba(0,0,0,.6)}
.noly .now{opacity:.55;font-weight:600;font-size:clamp(12px,6cqh,16px)}
.bar{grid-area:bar;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;font-size:11px;font-variant-numeric:tabular-nums;color:rgba(255,255,255,.7)}
.trk{position:relative;height:18px;display:flex;align-items:center;cursor:pointer;touch-action:none}
.trk::before{content:"";position:absolute;left:0;right:0;height:5px;border-radius:5px;background:rgba(255,255,255,.2);transition:height .15s}
.fill{position:absolute;left:0;height:5px;border-radius:5px;width:0;background:linear-gradient(90deg,var(--a),var(--b));box-shadow:0 0 12px hsl(var(--h1) 95% 60%/.6);transition:height .15s}
.knob{position:absolute;left:0;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.5);transform:scale(0);transition:transform .15s}
.trk:hover::before,.trk:hover .fill{height:7px}.trk:hover .knob{transform:scale(1)}
.ctl{grid-area:ctl;display:flex;align-items:center;justify-content:center;gap:clamp(14px,6cqw,30px)}
.ctl button{display:grid;place-items:center;border-radius:50%;color:#fff;transition:transform .15s,background .15s}
.ctl .sk{width:38px;height:38px;color:rgba(255,255,255,.92)}.ctl .sk svg{width:26px;height:26px}
.ctl .sk:hover{background:rgba(255,255,255,.14)}
.ctl .pl{width:clamp(40px,17cqh,54px);height:clamp(40px,17cqh,54px);background:#fff;color:#111;box-shadow:0 6px 20px rgba(0,0,0,.45)}
.ctl .pl svg{width:58%;height:58%}.ctl .pl:hover{transform:scale(1.07)}.ctl button:active{transform:scale(.92)}
.idle{position:absolute;inset:0;display:none;place-items:center;text-align:center;padding:20px;color:rgba(255,255,255,.7);font-size:14px}
.pp.empty .wrap{display:none}.pp.empty .idle{display:grid}
/* a short window: no lyrics; a very short one: cover, title and buttons only */
@container (max-height:178px){.wrap{grid-template-areas:"art meta side" "bar bar bar" "ctl ctl ctl";grid-template-rows:auto auto auto}.lyr{display:none}.art{width:clamp(44px,30cqh,64px)}}
@container (max-height:118px){.wrap{grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"art meta ctl";grid-template-rows:1fr;align-items:center}.bar,.side{display:none}.ctl{gap:6px}.ctl .sk{width:30px;height:30px}.ctl .sk svg{width:22px;height:22px}.ctl .pl{width:38px;height:38px}}
/* a narrow window: stack, centre */
@container (max-width:250px){.wrap{grid-template-areas:"art art art" "meta meta meta" "lyr lyr lyr" "bar bar bar" "ctl ctl ctl";justify-items:center;text-align:center}.side{display:none}.art{width:clamp(48px,26cqh,80px)}.meta{width:100%}}
/* the look follows the song's genre */
.gn-hiphop .now,.gn-montagem .now,.gn-electronic .now{text-transform:uppercase}
.gn-montagem .now{font-style:italic;text-shadow:1px 0 #000,-1px 0 #000,0 1px #000,0 -1px #000,2px 2px 0 #000,-4px 0 0 var(--b),4px 0 0 var(--a),0 0 12px rgba(0,0,0,.8)}
.gn-hiphop .now{text-shadow:2px 2px 0 #000,-1px -1px 0 #000,5px 5px 0 hsl(var(--h1) 85% 38%)}
.gn-electronic .now{text-shadow:-1px 0 var(--a),1px 0 var(--b),0 0 8px hsl(var(--h3) 95% 60%/.5),0 1px 2px rgba(0,0,0,.6)}
.gn-classical .now,.gn-country .now{font-weight:700;font-style:italic}
.gn-hiphop .t,.gn-montagem .t{text-transform:uppercase;font-style:italic}
.gn-montagem .art{animation:beat .46s ease-in-out infinite}.pp.paused.gn-montagem .art{animation:none}
@keyframes beat{0%,100%{transform:scale(1)}8%{transform:scale(1.08) rotate(-1deg)}22%{transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.pp .art,.now.in{animation:none!important}}
`;

function buildPipUI(doc, onBack) {
  doc.head.innerHTML = '<meta charset="utf-8"><title>Now Playing</title>';
  const st = doc.createElement('style'); st.textContent = pipFontCss() + PIP_CSS; doc.head.appendChild(st);
  doc.body.innerHTML =
    '<div class="pp empty" id="pp"><div class="bg" id="pbg"></div><div class="tint"></div>' +
    '<div class="idle">Nothing is playing.<br>Start a song in Spotify.</div>' +
    '<div class="wrap">' +
      '<div class="art" id="part"></div>' +
      '<div class="meta"><div class="t" id="pt"></div><div class="a" id="pa"></div></div>' +
      '<div class="side"><button class="like" id="plike" aria-label="Like">' + pipSvg(PIP_ICO.heart) + '</button>' +
        '<button id="pback" aria-label="Back to the player">' + pipSvg(PIP_ICO.back) + '</button></div>' +
      '<div class="lyr"><div class="now" id="pnow"></div><div class="nx" id="pnx"></div></div>' +
      '<div class="bar"><span id="pcur">0:00</span><div class="trk" id="ptrk"><div class="fill" id="pfill"></div><div class="knob" id="pknob"></div></div><span id="pdur">0:00</span></div>' +
      '<div class="ctl"><button class="sk" id="pprev" aria-label="Previous">' + pipSvg(PIP_ICO.prev) + '</button>' +
        '<button class="pl" id="pplay" aria-label="Play or pause"></button>' +
        '<button class="sk" id="pnext" aria-label="Next">' + pipSvg(PIP_ICO.next) + '</button></div>' +
    '</div></div>';
  const q = (id) => doc.getElementById(id);
  const r = { doc, root: q('pp'), bg: q('pbg'), art: q('part'), t: q('pt'), a: q('pa'), now: q('pnow'), nx: q('pnx'), cur: q('pcur'), dur: q('pdur'),
    fill: q('pfill'), knob: q('pknob'), trk: q('ptrk'), like: q('plike'), play: q('pplay'), key: '', line: null, sec: -1, st: '' };
  q('pprev').addEventListener('click', () => el.prev.click());
  q('pnext').addEventListener('click', () => el.next.click());
  r.play.addEventListener('click', () => el.play.click());
  r.like.addEventListener('click', () => { el.like.click(); r.like.classList.remove('pop'); void r.like.offsetWidth; r.like.classList.add('pop'); });
  q('pback').addEventListener('click', onBack || (() => {}));
  const seekAt = (e) => {
    if (!S.track || !S.track.dur) return;
    const b = r.trk.getBoundingClientRect();
    seekTo(Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)) * S.track.dur);
    pipRender(r);
  };
  r.trk.addEventListener('pointerdown', (e) => { r.trk.setPointerCapture(e.pointerId); r.drag = true; seekAt(e); });
  r.trk.addEventListener('pointermove', (e) => { if (r.drag) seekAt(e); });
  r.trk.addEventListener('pointerup', () => { r.drag = false; });
  r.doc.addEventListener('keydown', (e) => {                       // Space, arrows and N/B also work in the small window
    if (e.key === ' ') { el.play.click(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') el.next.click();
    else if (e.key === 'ArrowLeft') el.prev.click();
  });
  pipRender(r);
  return r;
}

// refresh the window from the page's state (only touches the DOM when something changed)
function pipRender(r) {
  const t = S.track;
  const look = pipLook();
  const ps = r.root.style;
  if (r.look !== look.h1 + look.h2 + look.h3 + look.fam + look.font) {
    r.look = look.h1 + look.h2 + look.h3 + look.fam + look.font;
    ps.setProperty('--h1', look.h1); ps.setProperty('--h2', look.h2); ps.setProperty('--h3', look.h3);
    ps.fontFamily = ''; r.root.className = r.root.className.replace(/\bgn-\w+/g, '').trim() + (look.fam ? ' gn-' + look.fam : '');
    r.now.style.fontFamily = look.font || ''; r.t.style.fontFamily = look.font || '';
  }
  r.root.classList.toggle('empty', !t);
  r.root.classList.toggle('playing', !!S.playing);
  r.root.classList.toggle('paused', !S.playing);
  if (!t) return;
  const key = (t.id || '') + '|' + t.title;
  if (r.key !== key) {
    r.key = key; r.t.textContent = t.title; r.a.textContent = t.artist || '';
    r.art.style.backgroundImage = t.art ? 'url("' + t.art + '")' : '';
    r.bg.style.backgroundImage = t.art ? 'url("' + t.art + '")' : '';
    r.dur.textContent = fmt(t.dur); r.line = null; r.sec = -1;
  }
  const p = position(), d = t.dur || 0;
  const f = d ? Math.min(1, p / d) : 0;
  r.fill.style.width = (f * 100) + '%'; r.knob.style.left = (f * 100) + '%';
  const sec = Math.floor(p / 1000);
  if (sec !== r.sec) { r.sec = sec; r.cur.textContent = fmt(p); }
  const st = S.playing ? 'p' : 'z';
  if (r.st !== st) { r.st = st; r.play.innerHTML = pipSvg(S.playing ? PIP_ICO.pause : PIP_ICO.play); }
  const liked = !!S.liked;
  if (r.liked !== liked) { r.liked = liked; r.like.classList.toggle('on', liked); r.like.innerHTML = pipSvg(liked ? PIP_ICO.hearton : PIP_ICO.heart); }
  // lyrics: the playing line big, the next one dim
  const lines = S.lines && S.lines.length ? S.lines : null;
  let now = '', nx = '';
  if (lines && S.lineIdx >= 0 && lines[S.lineIdx]) { now = lines[S.lineIdx].s || ''; nx = (lines[S.lineIdx + 1] && lines[S.lineIdx + 1].s) || ''; }
  else if (lines && S.lineIdx < 0 && lines[0]) { now = '♪'; nx = lines[0].s || ''; }
  const noly = !lines;
  r.root.classList.toggle('noly', noly);
  if (noly) now = t.album || '';
  if (r.line !== now) {
    r.line = now; r.now.textContent = now; r.now.dir = 'auto';
    r.now.classList.remove('in'); void r.now.offsetWidth; if (!noly) r.now.classList.add('in');
  }
  if (r.nxs !== nx) { r.nxs = nx; r.nx.textContent = nx; r.nx.dir = 'auto'; }
}

async function openDocPip() {
  const w = await documentPictureInPicture.requestWindow({ width: 440, height: 256 });
  let ui;
  const close = () => { try { w.close(); } catch (e) { /* already closed */ } };
  ui = buildPipUI(w.document, () => { close(); window.focus(); });
  const timer = w.setInterval(() => {                              // runs in the small window: not slowed down when the main tab is in the background
    try { if (typeof tick === 'function') tick(); pipRender(ui); } catch (e) { /* ignore */ }
  }, 250);
  const poller = w.setInterval(() => { if (document.hidden && typeof poll === 'function') poll(); }, 4000);
  pip = { mode: 'doc', win: w };
  syncPipButton();
  w.addEventListener('pagehide', () => { w.clearInterval(timer); w.clearInterval(poller); pip = null; syncPipButton(); });
}

// ------------------------------------------------------------------ the canvas version (Safari, iPhone, Firefox, Android)
const pipImgs = new Map();
function pipImg(url) {
  if (!url) return null;
  let e = pipImgs.get(url);
  if (!e) {
    e = { im: new Image(), ok: false };
    e.im.crossOrigin = 'anonymous';                                 // Spotify's image servers allow this; otherwise the cover is left out
    e.im.onload = () => { e.ok = true; };
    e.im.src = url;
    pipImgs.set(url, e);
    if (pipImgs.size > 8) pipImgs.delete(pipImgs.keys().next().value);
  }
  return e.ok ? e.im : null;
}
function pipRound(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function pipWrap(ctx, text, maxW, maxLines) {
  const words = String(text).split(/\s+/), out = []; let cur = '';
  for (const w of words) {
    const tryL = cur ? cur + ' ' + w : w;
    if (ctx.measureText(tryL).width > maxW && cur) { out.push(cur); cur = w; } else cur = tryL;
  }
  if (cur) out.push(cur);
  if (out.length > maxLines) { out.length = maxLines; out[maxLines - 1] = out[maxLines - 1].replace(/\s*\S*$/, '') + '…'; }
  return out;
}
function pipFit(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text; while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}
function drawPipCanvas(cv) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, t = S.track, look = pipLook();
  const hsl = (h, s, l, a) => 'hsla(' + h + ',' + s + '%,' + l + '%,' + (a == null ? 1 : a) + ')';
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0b0b0e'; ctx.fillRect(0, 0, W, H);
  const im = t ? pipImg(t.art) : null;
  if (im) {                                                         // a blurred wash of the cover (shrink, then stretch: works without ctx.filter)
    const s1 = document.createElement('canvas'); s1.width = 16; s1.height = 9;
    s1.getContext('2d').drawImage(im, 0, 0, 16, 9);
    const s2 = document.createElement('canvas'); s2.width = 96; s2.height = 54;
    const c2 = s2.getContext('2d'); c2.imageSmoothingEnabled = true; c2.drawImage(s1, 0, 0, 96, 54);
    ctx.imageSmoothingEnabled = true; ctx.globalAlpha = .75; ctx.drawImage(s2, 0, 0, W, H); ctx.globalAlpha = 1;
  }
  let g = ctx.createRadialGradient(0, 0, 0, 0, 0, W * .8); g.addColorStop(0, hsl(look.h1, 95, 58, .4)); g.addColorStop(1, hsl(look.h1, 95, 58, 0));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(W, H, 0, W, H, W * .7); g.addColorStop(0, hsl(look.h2, 95, 58, .32)); g.addColorStop(1, hsl(look.h2, 95, 58, 0));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(0,0,0,.2)'); g.addColorStop(1, 'rgba(0,0,0,.72)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic'; const F = 'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif';
  if (!t) { ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '600 34px ' + F; ctx.textAlign = 'center'; ctx.fillText('Nothing is playing', W / 2, H / 2); return; }
  const pad = 44, art = 220;
  ctx.save();                                                       // cover with a glow
  ctx.shadowColor = hsl(look.h1, 95, 60, S.playing ? .65 : .25); ctx.shadowBlur = 34; pipRound(ctx, pad, pad, art, art, 26); ctx.fillStyle = '#2a2a2e'; ctx.fill();
  ctx.restore(); ctx.save(); pipRound(ctx, pad, pad, art, art, 26); ctx.clip();
  if (im) ctx.drawImage(im, pad, pad, art, art);
  ctx.restore();
  const x = pad + art + 40, mw = W - x - pad;
  ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 12;
  ctx.font = '800 44px ' + F; ctx.fillText(pipFit(ctx, t.title, mw), x, pad + 52);
  ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,.72)'; ctx.font = '500 28px ' + F; ctx.fillText(pipFit(ctx, t.artist || '', mw), x, pad + 96);
  const lines = S.lines && S.lines.length ? S.lines : null;
  let now = t.album || '';
  if (lines) now = S.lineIdx >= 0 && lines[S.lineIdx] ? (lines[S.lineIdx].s || '♪') : '♪';
  ctx.fillStyle = '#fff'; ctx.font = '800 40px ' + F; ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 14;
  if (!lines) { ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '600 28px ' + F; ctx.shadowBlur = 0; }
  const up = ['hiphop', 'montagem', 'electronic'].indexOf(look.fam) >= 0;
  const wl = pipWrap(ctx, up ? now.toUpperCase() : now, mw, 3);
  wl.forEach((ln, i) => ctx.fillText(ln, x, pad + 160 + i * 48));
  ctx.shadowBlur = 0;
  const by = H - 62, bw = W - pad * 2, p = position(), d = t.dur || 0, f = d ? Math.min(1, p / d) : 0;   // progress bar
  pipRound(ctx, pad, by, bw, 10, 5); ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fill();
  if (f > 0) { const gr = ctx.createLinearGradient(pad, 0, pad + bw, 0); gr.addColorStop(0, hsl(look.h1, 95, 62)); gr.addColorStop(1, hsl(look.h2, 95, 64));
    pipRound(ctx, pad, by, Math.max(10, bw * f), 10, 5); ctx.fillStyle = gr; ctx.fill(); }
  ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = '500 22px ' + F; ctx.textAlign = 'left'; ctx.fillText(fmt(p), pad, by + 40);
  ctx.textAlign = 'right'; ctx.fillText(fmt(d), W - pad, by + 40);
  ctx.textAlign = 'center'; ctx.fillStyle = '#fff';                 // a pause / play badge in the middle of the bar line
  ctx.fillText(S.playing ? '▶  playing' : '❚❚  paused', W / 2, by + 40);
}

async function openVideoPip() {
  const cv = document.createElement('canvas'); cv.width = 960; cv.height = 540;
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.srcObject = cv.captureStream(12);
  v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:.02;pointer-events:none;z-index:-1';
  document.body.appendChild(v);
  drawPipCanvas(cv);
  await v.play();
  const timer = setInterval(() => { try { drawPipCanvas(cv); } catch (e) { /* ignore */ } }, 250);
  const done = () => {
    clearInterval(timer); try { v.pause(); } catch (e) { /* ignore */ } v.remove(); pip = null; syncPipButton();
    if ('mediaSession' in navigator) ['play', 'pause', 'nexttrack', 'previoustrack', 'seekto'].forEach((a) => { try { navigator.mediaSession.setActionHandler(a, null); } catch (e) { /* ignore */ } });
  };
  v.addEventListener('leavepictureinpicture', done);
  v.addEventListener('webkitpresentationmodechanged', () => { if (v.webkitPresentationMode !== 'picture-in-picture') done(); });
  try {
    if (v.requestPictureInPicture) await v.requestPictureInPicture();
    else v.webkitSetPresentationMode('picture-in-picture');
  } catch (e) { done(); throw e; }
  pip = { mode: 'video', video: v };
  syncPipButton();
  if ('mediaSession' in navigator) {                                // the system's PiP buttons drive the real player
    const ms = navigator.mediaSession, set = (a, f) => { try { ms.setActionHandler(a, f); } catch (e) { /* unsupported */ } };
    const meta = () => { const t = S.track; if (t) ms.metadata = new MediaMetadata({ title: t.title, artist: t.artist || '', album: t.album || '', artwork: t.art ? [{ src: t.art, sizes: '640x640' }] : [] }); };
    meta(); setInterval(() => { if (pip) meta(); }, 3000);
    set('play', () => { if (!S.playing) el.play.click(); }); set('pause', () => { if (S.playing) el.play.click(); });
    set('nexttrack', () => el.next.click()); set('previoustrack', () => el.prev.click());
    set('seekto', (d) => { if (d && d.seekTime != null) seekTo(d.seekTime * 1000); });
  }
}

// ------------------------------------------------------------------ the button and the key
function syncPipButton() {
  const b = $('btnPip');
  if (b) { b.classList.toggle('on', !!pip); b.setAttribute('aria-pressed', String(!!pip)); }
}
async function togglePip() {
  if (pip) {
    if (pip.mode === 'doc') { try { pip.win.close(); } catch (e) { /* ignore */ } }
    else if (document.exitPictureInPicture && document.pictureInPictureElement) { try { await document.exitPictureInPicture(); } catch (e) { /* ignore */ } }
    else if (pip.video && pip.video.webkitSetPresentationMode) pip.video.webkitSetPresentationMode('inline');
    return;
  }
  if (S.screen !== 'player' || !S.track) { toast('Start a song first'); return; }
  try {
    if (PIP_DOC) await openDocPip(); else await openVideoPip();
  } catch (e) {
    if (PIP_DOC) { try { await openVideoPip(); return; } catch (e2) { /* fall through */ } }
    toast('This browser could not open picture-in-picture');
  }
}
if (!PIP_DOC && !PIP_VID) { const b = $('btnPip'); if (b) b.hidden = true; }
else { const b = $('btnPip'); if (b) b.addEventListener('click', togglePip); }
