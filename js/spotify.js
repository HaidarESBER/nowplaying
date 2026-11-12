/* Now Playing - Spotify: login (PKCE), token handling, API calls, polling the player state.
 * Classic script: shares one global scope with the other files in js/ (loaded in order, see index.html). */
'use strict';

// ------------------------------------------------------------------ Spotify auth (PKCE)
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
const rand = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, (b) => CHARS[b % CHARS.length]).join(''); };
async function challengeOf(v) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  return btoa(String.fromCharCode(...new Uint8Array(h))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function startLogin(clientId) {
  store.set('cid', clientId);
  const verifier = rand(96);
  const state = rand(16);
  store.set('verifier', verifier);
  store.set('state', state);
  const q = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: REDIRECT,
    code_challenge_method: 'S256', code_challenge: await challengeOf(verifier),
    scope: SCOPES, state,
  });
  location.href = 'https://accounts.spotify.com/authorize?' + q;
}

async function tokenRequest(params) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: store.get('cid') || '', ...params }),
  });
  if (!r.ok) throw new Error('token ' + r.status);
  const j = await r.json();
  S.token = {
    access: j.access_token,
    refresh: j.refresh_token || (S.token && S.token.refresh),
    exp: Date.now() + (j.expires_in - 60) * 1000,
    scope: j.scope || (S.token && S.token.scope) || '',
  };
  store.set('tok', JSON.stringify(S.token));
}

async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return null;
  history.replaceState(null, '', REDIRECT);                       // clean the URL
  if (q.has('error')) return 'Spotify said: ' + q.get('error');
  if (q.get('state') !== store.get('state')) return 'Login state mismatch — please try again.';
  try {
    await tokenRequest({
      grant_type: 'authorization_code', code: q.get('code'),
      redirect_uri: REDIRECT, code_verifier: store.get('verifier') || '',
    });
    return null;
  } catch (e) {
    return 'Could not finish login (' + e.message + '). Check the Redirect URI in your Spotify app.';
  }
}

async function ensureToken(force) {
  if (!S.token) throw new Error('no token');
  if (!force && Date.now() < S.token.exp) return;
  if (!S.token.refresh) throw new Error('no refresh token');
  await tokenRequest({ grant_type: 'refresh_token', refresh_token: S.token.refresh });
}

async function api(method, path, body, retried) {
  await ensureToken();
  const headers = { Authorization: 'Bearer ' + S.token.access };
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch('https://api.spotify.com/v1' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 && !retried) { await ensureToken(true); return api(method, path, body, true); }
  return r;
}

function logout() {
  ['tok', 'verifier', 'state'].forEach(store.del);
  S.token = null;
  clearTimeout(S.pollT);
  showSetup('');
}

// ------------------------------------------------------------------ polling
async function poll() {
  clearTimeout(S.pollT);
  if (document.hidden || !S.token) return;
  let next = 4000;
  try {
    const r = await api('GET', '/me/player?additional_types=episode');
    if (r.status === 204) { setPlayer(null); next = 7000; }
    else if (r.status === 200) { const j = await r.json(); setPlayer(j); next = j.is_playing ? 3500 : 8000; }
    else if (r.status === 429) { next = (parseInt(r.headers.get('Retry-After'), 10) || 5) * 1000 + 500; }
    else if (r.status === 401 || r.status === 403) { toast('Spotify access was refused — reconnect'); next = 15000; }
    else { next = 8000; }
  } catch (e) {
    if (String(e.message).startsWith('token') || e.message === 'no token' || e.message === 'no refresh token') { logout(); return; }
    next = 8000;                                                      // offline etc.
  }
  S.pollT = setTimeout(poll, next);
}

function setPlayer(j) {
  if (!j || !j.item) { if (S.screen !== 'idle') show('idle'); S.trackId = null; return; }
  const it = j.item;
  const images = (it.album && it.album.images) || (it.images) || [];
  const track = {
    id: it.id || it.uri,
    title: it.name || '—',
    artist: it.artists ? it.artists.map((a) => a.name).join(', ') : ((it.show && it.show.publisher) || ''),
    album: (it.album && it.album.name) || (it.show && it.show.name) || '',
    art: (images[0] && images[0].url) || '',
    dur: it.duration_ms || 0,
    type: it.type || 'track',
    artistId: (it.artists && it.artists[0] && it.artists[0].id) || '',
  };
  S.playing = !!j.is_playing;
  if (Date.now() > S.hold) {
    S.shuffle = !!j.shuffle_state; S.repeat = j.repeat_state || 'off';
    if (j.device) S.device = j.device;
    renderModes();
  }
  S.anchor = { p: j.progress_ms || 0, t: Date.now() };
  if (S.screen !== 'player') show('player');
  if (track.id !== S.trackId) newTrack(track);
  renderPlayState();
}
