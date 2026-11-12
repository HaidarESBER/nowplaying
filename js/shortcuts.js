/* Now Playing - Keyboard shortcuts (desktop).
 * Classic script: shares one global scope with the other files in js/ (loaded in order, see index.html). */
'use strict';

// ------------------------------------------------------------------ keyboard shortcuts (desktop)
const SHORTCUTS = [
  [['Space'], 'Play / pause'], [['←', '→'], 'Back / forward 5 s'], [['Shift', '← →'], 'Previous / next song'],
  [['N', 'B'], 'Next / previous song'], [['↑', '↓'], 'Volume up / down'], [['M'], 'Mute'],
  [['S'], 'Shuffle'], [['R'], 'Repeat'], [['L'], 'Like'], [['T'], 'Show / hide lyrics'], [['Y'], 'Next lyric style'], [['G'], 'Preview a genre look'], [['X'], 'Replay the line with another animation'], [['V'], 'Try another version of the lyrics'],
  [['F'], 'Full screen'], [['/'], 'Search'], [['P'], 'Playlists'], [['D'], 'Devices'], [[','], 'Settings'], [['?'], 'This list'], [['Esc'], 'Close a panel'],
];
(() => {
  const list = $('helpList');
  SHORTCUTS.forEach(([keys, desc]) => {
    const k = document.createElement('div'); k.className = 'keys';
    keys.forEach((x) => { const e = document.createElement('kbd'); e.textContent = x; k.appendChild(e); });
    const d = document.createElement('div'); d.textContent = desc;
    list.append(k, d);
  });
})();

const LYRIC_STYLES = ['scroll', 'karaoke', 'focus', 'duo', 'words'];
const LYRIC_NAMES = { scroll: 'Scroll', karaoke: 'Karaoke', focus: 'One line', duo: 'Two lines', words: 'Word by word' };
function cycleLyricStyle() {
  cfg.lstyle = LYRIC_STYLES[(LYRIC_STYLES.indexOf(cfg.lstyle) + 1) % LYRIC_STYLES.length];
  saveCfg(); applyCfg(); syncSettingsUI();
  toast('Lyrics: ' + LYRIC_NAMES[cfg.lstyle]);
}
let preMute = 0;
function stepVol(d) {
  if (volumeBlocked()) return;
  const v = Math.max(0, Math.min(100, curVol() + d));
  showVol(v); sendVol(v); holdUI();
}
function toggleMute() {
  if (volumeBlocked()) return;
  const c = curVol();
  const v = c > 0 ? 0 : (preMute || 30);
  if (c > 0) preMute = c;
  showVol(v); sendVol(v); holdUI();
  toast(v === 0 ? 'Muted' : 'Volume ' + v);
}
function closePanels() {
  el.devSheet.hidden = true; $('searchSheet').hidden = true; el.setSheet.hidden = true; $('helpSheet').hidden = true; sheet.hidden = true;
}
const anyPanel = () => !el.devSheet.hidden || !$('searchSheet').hidden || !el.setSheet.hidden || !$('helpSheet').hidden || !sheet.hidden;

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  const typing = t && ((t.tagName === 'INPUT' && !['checkbox', 'range', 'button'].includes(t.type)) || t.tagName === 'TEXTAREA' || t.isContentEditable);
  if (typing) { if (e.key === 'Escape') t.blur(); return; }
  const k = e.key;
  if (k === 'Escape') { closePanels(); return; }
  if (k === '?') { $('helpSheet').hidden = !$('helpSheet').hidden; e.preventDefault(); return; }
  if (S.screen !== 'player' || anyPanel()) return;
  let handled = true;
  switch (k) {
    case ' ': case 'k': case 'K': el.play.click(); break;
    case 'ArrowLeft': if (e.shiftKey) el.prev.click(); else if (S.track) seekTo(position() - 5000); break;
    case 'ArrowRight': if (e.shiftKey) el.next.click(); else if (S.track) seekTo(position() + 5000); break;
    case 'ArrowUp': stepVol(5); break;
    case 'ArrowDown': stepVol(-5); break;
    case 'n': case 'N': el.next.click(); break;
    case 'b': case 'B': el.prev.click(); break;
    case 'm': case 'M': toggleMute(); break;
    case 's': case 'S': el.shuf.click(); break;
    case 'r': case 'R': el.rep.click(); break;
    case 'l': case 'L': el.like.click(); break;
    case 't': case 'T': if (!el.btnLyrics.hidden) el.btnLyrics.click(); break;
    case 'y': case 'Y': cycleLyricStyle(); break;
    case 'g': case 'G': cycleGenreLook(); break;
    case 'x': case 'X': cycleFx(); break;
    case 'v': case 'V': nextLyricVersion(); break;
    case 'f': case 'F': toggleFullscreen(); break;
    case 'p': case 'P': openLibrary('pl'); break;
    case '/': openSearch(); break;
    case 'd': case 'D': openLibrary('dev'); break;
    case ',': el.btnSet.click(); break;
    default: handled = false;
  }
  if (handled) e.preventDefault();
});
// Space on a focused button would press it a second time: stop that, and don't leave buttons focused after a click
document.addEventListener('keyup', (e) => { if (e.key === ' ' && e.target && e.target.tagName === 'BUTTON') e.preventDefault(); });
document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b && b.blur) b.blur(); });
