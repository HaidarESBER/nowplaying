/* Now Playing - Demo mode (?demo) and start-up.
 * Classic script: shares one global scope with the other files in js/ (loaded in order, see index.html). */
'use strict';

// ------------------------------------------------------------------ demo mode (?demo): fake data, no Spotify needed
const DEMO_TRACKS = [
  { id: 'd1', title: 'Golden Hour Drive', artist: 'The Demo Band', album: 'Preview Sessions', hue: 22, dur: 214000, genres: ['dance pop', 'pop'],
    lines: ['(intro)', 'Headlights paint the evening gold', 'Windows down and nothing to hold', 'Every mile a little slower now', 'We forgot to ask where, forgot to ask how',
      'Sing it loud, the radio knows', 'Every word that the summer owes', 'Hold the moment, let it ring', 'This is the part where the chorus sings', '', 'Oh, we are golden, we are free', 'Nothing left to prove to me', 'Turn it up, the night is long', 'And the road is carrying the song'] },
  { id: 'd2', title: 'ليل المدينة', artist: 'فرقة العرض', album: 'نسخة تجريبية', hue: 205, dur: 187000, genres: ['arabic', 'tarab'],
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
