const loginView = document.getElementById('login-view');
const mainView = document.getElementById('main-view');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const commandForm = document.getElementById('command-form');
const commandInput = document.getElementById('command-input');
const consoleLog = document.getElementById('console-log');
const statusBanner = document.getElementById('status-banner');
const videoEl = document.getElementById('video');
const overlay = document.getElementById('video-overlay');
const playerState = document.getElementById('player-state');
const userChip = document.getElementById('user-chip');
const roleChip = document.getElementById('role-chip');
const videoChip = document.getElementById('video-chip');
const linkChip = document.getElementById('link-chip');
const commandHint = document.getElementById('command-hint');

let token = null;
let streamUrl = null;
let loginName = null;
let userRole = null;
let commandWs = null;
let player = null;
let wantLive = true;
let playerGen = 0;
let commandPublicKey = null;

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.hidden = true;

  try {
    const response = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: document.getElementById('login').value,
        password: document.getElementById('password').value,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Login failed');

    token = body.token;
    streamUrl = body.streamUrl;
    loginName = body.login;
    userRole = body.role || null;
    await loadCommandPublicKey();
    showMain();
    connectCommandSocket();
    startPlayer();
  } catch (error) {
    loginError.hidden = false;
    loginError.textContent = error.message;
  }
});

commandForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const command = commandInput.value.trim();
  if (!command) return;
  appendLine('>', command);
  commandInput.value = '';

  if (!commandWs || commandWs.readyState !== WebSocket.OPEN) {
    appendLine('<', 'ERROR CONNECTION');
    showBanner('Command channel is not connected', 'bad');
    return;
  }

  try {
    const envelope = await encryptCommand(command);
    commandWs.send(JSON.stringify(envelope));
  } catch (error) {
    appendLine('<', `ERROR ENCRYPT ${error.message || 'FAILED'}`);
    showBanner('Could not encrypt command', 'bad');
  }
});

async function loadCommandPublicKey() {
  const response = await fetch('/crypto/public-key');
  if (!response.ok) throw new Error('Could not load command public key');
  const body = await response.json();
  commandPublicKey = await importRsaPublicKey(body.publicKey);
}

async function importRsaPublicKey(pem) {
  const binary = pemToArrayBuffer(pem);
  return crypto.subtle.importKey(
    'spki',
    binary,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
}

function pemToArrayBuffer(pem) {
  const b64 = String(pem)
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

async function encryptCommand(plaintext) {
  if (!commandPublicKey) await loadCommandPublicKey();
  const encoded = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    commandPublicKey,
    encoded,
  );
  return {
    v: 1,
    alg: 'RSA-OAEP-SHA256',
    ciphertext: bufferToBase64(cipher),
  };
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function showMain() {
  loginView.hidden = true;
  mainView.hidden = false;
  userChip.textContent = loginName;
  roleChip.textContent = userRole || '-';
  commandHint.textContent = userRole === 'viewer'
    ? 'GET_STATUS, LOGOUT (no START/STOP for viewer)'
    : 'START_VIDEO, STOP_VIDEO, GET_STATUS, LOGOUT';
  setChip(linkChip, 'command connecting', '');
  setChip(videoChip, 'video connecting', '');
}

function connectCommandSocket() {
  closeCommandSocket();
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  commandWs = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`);

  commandWs.addEventListener('open', () => {
    setChip(linkChip, 'command online', 'ok');
    hideBanner();
  });

  commandWs.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      appendLine('<', String(event.data));
      return;
    }

    if (message.type === 'hello') return;

    const reply = message.reply || message.message || JSON.stringify(message);
    appendLine('<', reply);

    if (message.type === 'error') {
      showBanner(reply, 'bad');
      return;
    }

    hideBanner();
    if (message.command === 'LOGOUT') {
      teardownToLogin();
      return;
    }
    if (message.command === 'START_VIDEO' && message.reply === 'OK') {
      wantLive = true;
      overlay.textContent = 'Restarting live edge';
      overlay.hidden = false;
      setChip(videoChip, 'video starting', '');
      window.setTimeout(() => {
        if (wantLive && token) startPlayer();
      }, 50);
    }
    if (message.command === 'STOP_VIDEO' && message.reply === 'OK') {
      wantLive = false;
      stopPlayer();
      overlay.textContent = 'VIDEO STOPPED';
      overlay.hidden = false;
      setChip(videoChip, 'video stopped', 'warn');
    }
    if (message.command === 'GET_STATUS') {
      wantLive = message.reply === 'VIDEO_RUNNING';
      setChip(videoChip, wantLive ? 'video running' : 'video stopped', wantLive ? 'ok' : 'warn');
    }
  });

  commandWs.addEventListener('close', () => {
    setChip(linkChip, 'command offline', 'bad');
    if (token) showBanner('Command connection closed', 'bad');
  });

  commandWs.addEventListener('error', () => {
    setChip(linkChip, 'command error', 'bad');
    showBanner('Command connection error', 'bad');
  });
}

function mseCanPlayH264() {
  // mpegts.isSupported() wants aac too - we only have video
  const types = [
    'video/mp4; codecs="avc1.42E01E"',
    'video/mp4; codecs="avc1.42001E"',
    'video/mp4; codecs="avc1.42E01E,mp4a.40.2"',
  ];
  const source = window.ManagedMediaSource || window.MediaSource;
  if (!source || typeof source.isTypeSupported !== 'function') return false;
  return types.some((type) => source.isTypeSupported(type));
}

function startPlayer() {
  const gen = ++playerGen;
  stopPlayerKeepingGeneration();

  if (!window.mpegts) {
    overlay.hidden = false;
    overlay.textContent = 'Video player failed to load- refresh the page';
    playerState.textContent = 'unsupported';
    showBanner('mpegts.js did not load. Hard-refresh http://127.0.0.1:3000 in Chrome, Edge, or Firefox.', 'bad');
    return;
  }

  if (!mseCanPlayH264() && !mpegts.isSupported()) {
    overlay.hidden = false;
    overlay.textContent = 'Open this page in Chrome, Edge, or Firefox';
    playerState.textContent = 'unsupported';
    showBanner('This browser cannot play MSE/H.264 (Cursor preview often cannot). Use a desktop browser.', 'bad');
    return;
  }

  overlay.hidden = false;
  overlay.textContent = 'Connecting to Server A';
  playerState.textContent = 'connecting';

  const liveUrl = `${streamUrl}${streamUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;

  player = mpegts.createPlayer(
    {
      type: 'mpegts',
      isLive: true,
      hasAudio: false,
      hasVideo: true,
      url: liveUrl,
    },
    {
      enableWorker: false,
      enableStashBuffer: false,
      autoCleanupSourceBuffer: true,
      lazyLoad: false,
      liveBufferLatencyChasing: true,
      liveBufferLatencyMaxLatency: 0.5,
      liveBufferLatencyMinRemain: 0.15,
    },
  );

  player.attachMediaElement(videoEl);
  player.load();
  player.play().catch(() => {
    // autoplay can fail until the first frame arrives
  });

  player.on(mpegts.Events.ERROR, (_type, detail) => {
    if (gen !== playerGen) return;
    overlay.hidden = false;
    overlay.textContent = 'Video connection error';
    playerState.textContent = 'error';
    setChip(videoChip, 'video error', 'bad');
    showBanner(`Video error: ${detail || 'unknown'}`, 'bad');
    if (wantLive && token) {
      setTimeout(() => {
        if (wantLive && token && gen === playerGen) startPlayer();
      }, 1500);
    }
  });

  videoEl.addEventListener('playing', onPlaying);
}

function onPlaying() {
  overlay.hidden = true;
  playerState.textContent = 'live';
  setChip(videoChip, 'video live', 'ok');
}

function resetVideoElement() {
  try {
    videoEl.pause();
    videoEl.removeAttribute('src');
    videoEl.srcObject = null;
    videoEl.load();
  } catch {
    // ignore
  }
}

function stopPlayerKeepingGeneration() {
  videoEl.removeEventListener('playing', onPlaying);
  if (player) {
    try {
      player.pause();
      player.unload();
      player.detachMediaElement();
      player.destroy();
    } catch {
      // player may already be torn down
    }
    player = null;
  }
  resetVideoElement();
}

function stopPlayer() {
  playerGen += 1;
  stopPlayerKeepingGeneration();
  playerState.textContent = 'stopped';
}

function teardownToLogin() {
  token = null;
  streamUrl = null;
  loginName = null;
  userRole = null;
  commandPublicKey = null;
  wantLive = true;
  closeCommandSocket();
  stopPlayer();
  consoleLog.textContent = '';
  hideBanner();
  mainView.hidden = true;
  loginView.hidden = false;
  document.getElementById('password').value = '';
}

function closeCommandSocket() {
  if (!commandWs) return;
  commandWs.onopen = null;
  commandWs.onmessage = null;
  commandWs.onclose = null;
  commandWs.onerror = null;
  if (commandWs.readyState === WebSocket.OPEN || commandWs.readyState === WebSocket.CONNECTING) {
    commandWs.close();
  }
  commandWs = null;
}

function appendLine(prefix, text) {
  consoleLog.textContent += `${prefix} ${text}\n`;
  consoleLog.scrollTop = consoleLog.scrollHeight;
}

function showBanner(text, kind) {
  statusBanner.hidden = false;
  statusBanner.textContent = text;
  statusBanner.className = `banner ${kind || ''}`;
}

function hideBanner() {
  statusBanner.hidden = true;
}

function setChip(el, text, kind) {
  el.textContent = text;
  el.className = `chip ${kind || ''}`;
}
