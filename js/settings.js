/* Now Playing - Auto-hiding buttons and the settings panel.
 * Classic script: shares one global scope with the other files in js/ (loaded in order, see index.html). */
'use strict';

// ------------------------------------------------------------------ auto-hide the buttons
let hideT = 0, lastAct = 0, swallow = false;
const anySheet = () => !el.devSheet.hidden || !$('searchSheet').hidden || !el.setSheet.hidden || !sheet.hidden || !$('helpSheet').hidden;
function armHide() {
  clearTimeout(hideT);
  if (!cfg.autohide || S.screen !== 'player') return;
  hideT = setTimeout(() => {
    if (anySheet() || B.on) { armHide(); return; }               // never hide while a panel is open or while scrolling lyrics
    document.body.classList.add('chrome-off');
  }, 5000);
}
function chromeShow() { document.body.classList.remove('chrome-off'); armHide(); }
let lastPX = -1, lastPY = -1;
function onActivity(e) {
  if (e.type === 'pointermove' && e.pointerType === 'mouse') {          // ignore tiny mouse jitter; only a real move counts
    const moved = lastPX < 0 || Math.abs(e.clientX - lastPX) + Math.abs(e.clientY - lastPY) >= 8;
    if (!moved) return;
    lastPX = e.clientX; lastPY = e.clientY;
  }
  const off = document.body.classList.contains('chrome-off');
  if (off && e.type === 'pointerdown') { swallow = true; setTimeout(() => { swallow = false; }, 450); }   // that tap only reveals
  const now = Date.now();
  if (!off && e.type !== 'pointerdown' && now - lastAct < 400) return;                                // throttle mouse moves
  lastAct = now;
  chromeShow();
}
['pointerdown', 'pointermove', 'wheel', 'keydown'].forEach((ev) => window.addEventListener(ev, onActivity, { capture: true, passive: true }));
document.addEventListener('click', (e) => { if (swallow) { e.stopPropagation(); e.preventDefault(); } }, true);

// ------------------------------------------------------------------ settings panel
function saveCfg() { store.set('cfg', JSON.stringify(cfg)); }
function applyCfg() {
  document.documentElement.style.setProperty('--lscale', cfg.lscale);
  document.body.classList.toggle('noclock', !cfg.clock);
  if (['scroll', 'karaoke', 'focus', 'duo', 'words'].indexOf(cfg.lstyle) < 0) cfg.lstyle = 'scroll';
  ['scroll', 'karaoke', 'focus', 'duo', 'words'].forEach((k) => document.body.classList.toggle('ls-' + k, cfg.lstyle === k));
  clearWords(); prepareWords(S.lineIdx);
  refreshAutoSize();
  if (typeof applyGenre === 'function') applyGenre();
  if (!cfg.awake && wake) { try { wake.release(); } catch (e) { /* ignore */ } wake = null; }
  if (cfg.awake) lockScreen();
  setTimeout(() => centerLine(S.lineIdx, true), 80);           // line heights changed: re-centre the lyrics
}
function syncSettingsUI() {
  $('cfgGenre').checked = cfg.genre;
  updateGenreInfo(); updateLyrInfo();
  $('cfgAutosize').checked = cfg.autosize; $('cfgClock').checked = cfg.clock; $('cfgAwake').checked = cfg.awake; $('cfgHide').checked = cfg.autohide;
  setAwakeStatus();
  document.querySelectorAll('#cfgStyle button').forEach((b) => b.classList.toggle('on', b.dataset.v === cfg.lstyle));
  document.querySelectorAll('#cfgSize button').forEach((b) => b.classList.toggle('on', parseFloat(b.dataset.v) === cfg.lscale));
  $('rowLikes').hidden = DEMO || (hasLib() && hasPl());
  $('cfgName').value = getName();
}
el.btnSet.addEventListener('click', () => { syncSettingsUI(); el.setSheet.hidden = false; });
$('setClose').addEventListener('click', () => { el.setSheet.hidden = true; });
$('cfgClock').addEventListener('change', (e) => { cfg.clock = e.target.checked; saveCfg(); applyCfg(); });
$('cfgAwake').addEventListener('change', (e) => { cfg.awake = e.target.checked; saveCfg(); applyCfg(); lockScreen(); });
$('cfgName').addEventListener('change', (e) => { store.set('name', e.target.value.trim().slice(0, 24)); renderIdleGreet(); renderAmbient(); });
$('cfgKeys').addEventListener('click', () => { el.setSheet.hidden = true; $('helpSheet').hidden = false; });
$('cfgLyrNext').addEventListener('click', nextLyricVersion);
$('cfgGenre').addEventListener('change', (e) => {
  cfg.genre = e.target.checked; saveCfg(); applyGenre(); syncSettingsUI();
  if (cfg.genre && S.track && !S.gfam) loadGenre(S.track);
});
$('cfgAutosize').addEventListener('change', (e) => { cfg.autosize = e.target.checked; saveCfg(); applyCfg(); });
$('cfgHide').addEventListener('change', (e) => { cfg.autohide = e.target.checked; saveCfg(); chromeShow(); });
$('cfgStyle').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  cfg.lstyle = b.dataset.v; saveCfg(); applyCfg(); syncSettingsUI();
});
$('cfgSize').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  cfg.lscale = parseFloat(b.dataset.v); saveCfg(); applyCfg(); syncSettingsUI();
});
$('cfgReconnect').addEventListener('click', () => startLogin(store.get('cid') || ''));
$('cfgDisconnect').addEventListener('click', () => { el.setSheet.hidden = true; if (DEMO) return; logout(); });
// tap outside a card closes it; Escape too
[el.devSheet, $('searchSheet'), el.setSheet, $('helpSheet')].forEach((sh) => sh.addEventListener('click', (e) => { if (e.target === sh) sh.hidden = true; }));
$('helpClose').addEventListener('click', () => { $('helpSheet').hidden = true; });
applyCfg();
renderModes();
