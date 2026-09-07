import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { config, streamUrl } from '../shared/config.js';
import {
  extractBearer,
  revokeJti,
  signToken,
  verifyToken,
} from '../shared/jwt.js';
import {
  COMMANDS,
  CONTROL,
  VIDEO_COMMANDS,
  formatStatusReply,
  parseClientCommand,
} from '../shared/protocol.js';
import { canRunCommand, normalizeRole } from '../shared/roles.js';
import {
  decryptCommandMessage,
  ensureCommandKeys,
  getPublicKeyPayload,
  isEncryptedEnvelope,
} from './commandCrypto.js';
import { ControlClient } from './controlClient.js';
import { logCommand } from './logger.js';
import { findUser, verifyPassword } from './users.js';

const control = new ControlClient();
ensureCommandKeys();
const app = express();
app.use(express.json({ limit: '32kb' }));

app.post('/auth/login', async (req, res) => {
  const login = String(req.body?.login ?? '').trim();
  const password = String(req.body?.password ?? '');

  logCommand({ user: login || 'anonymous', message: 'LOGIN_ATTEMPT' });

  const user = findUser(login);
  if (!user || !(await verifyPassword(user, password))) {
    logCommand({ user: login || 'anonymous', message: 'LOGIN_FAILED' });
    res.status(401).json({ error: 'Invalid login or password' });
    return;
  }

  const role = normalizeRole(user.role);
  if (!role) {
    logCommand({ user: user.login, message: 'LOGIN_FAILED', extra: { reason: 'unknown_role' } });
    res.status(403).json({ error: 'Account has no valid role' });
    return;
  }

  const { token, jti } = signToken(user.login, role);
  logCommand({ user: user.login, message: 'LOGIN_OK', extra: { jti, role } });
  res.json({
    token,
    streamUrl: streamUrl(token),
    login: user.login,
    role,
    expiresIn: config.jwtExpiresIn,
  });
});

app.get('/protected', (req, res) => {
  try {
    const payload = verifyToken(extractBearer(req.headers.authorization));
    logCommand({ user: payload.login, message: 'PROTECTED_OK' });
    res.json({ ok: true, login: payload.login, role: payload.role ?? null });
  } catch (error) {
    logCommand({ user: 'anonymous', message: 'PROTECTED_DENIED', extra: { error: error.message } });
    res.status(401).json({ error: 'Unauthorized' });
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, controlConnected: control.connected });
});

app.get('/crypto/public-key', (_req, res) => {
  res.json(getPublicKeyPayload());
});

app.get('/docs', (_req, res) => {
  res.sendFile(path.join(config.paths.docs, 'index.html'));
});

app.use(express.static(config.paths.client));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  let url;
  try {
    url = new URL(request.url, `http://${request.headers.host}`);
  } catch {
    socket.destroy();
    return;
  }

  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }

  try {
    const payload = verifyToken(url.searchParams.get('token'));
    const role = normalizeRole(payload.role);
    if (!role) {
      throw Object.assign(new Error('Token missing role'), { code: 'NO_ROLE' });
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.jti = payload.jti;
      ws.login = payload.login;
      ws.role = role;
      wss.emit('connection', ws, request);
    });
  } catch (error) {
    const body = 'Unauthorized';
    socket.write(
      'HTTP/1.1 401 Unauthorized\r\n' +
        'Connection: close\r\n' +
        'Content-Type: text/plain\r\n' +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        '\r\n' +
        body,
    );
    socket.destroy();
    logCommand({ user: 'anonymous', message: 'WS_AUTH_DENIED', extra: { error: error.message } });
  }
});

wss.on('connection', (ws) => {
  logCommand({ user: ws.login, message: 'WS_CONNECTED' });
  sendJson(ws, { type: 'hello', reply: 'CONNECTED' });

  ws.on('message', async (data, isBinary) => {
    const raw = isBinary ? data.toString('utf8') : String(data);
    logCommand({
      user: ws.login,
      message: isEncryptedEnvelope(raw) ? 'ENCRYPTED_COMMAND' : raw,
      extra: isEncryptedEnvelope(raw) ? { bytes: raw.length } : undefined,
    });

    let plaintext;
    try {
      if (!isEncryptedEnvelope(raw)) {
        throw Object.assign(new Error('PLAINTEXT_NOT_ALLOWED'), { code: 'PLAINTEXT' });
      }
      plaintext = decryptCommandMessage(raw);
    } catch (error) {
      const reply = `ERROR ${error.message || 'DECRYPT_FAILED'}`;
      logCommand({ user: ws.login, message: 'DECRYPT_ERROR', extra: { error: error.message } });
      sendJson(ws, { type: 'error', reply });
      return;
    }

    logCommand({ user: ws.login, message: plaintext });

    const command = parseClientCommand(plaintext);
    if (!command) {
      sendJson(ws, { type: 'error', reply: 'ERROR EMPTY_COMMAND' });
      return;
    }

    try {
      const reply = await handleCommand(ws, command);
      sendJson(ws, { type: 'response', command, reply });
      if (command === COMMANDS.LOGOUT) {
        ws.close(1000, 'Logged out');
      }
    } catch (error) {
      const reply = `ERROR ${error.message || 'UNKNOWN'}`;
      logCommand({ user: ws.login, message: 'COMMAND_ERROR', extra: { command, error: error.message } });
      sendJson(ws, { type: 'error', command, reply });
    }
  });

  ws.on('close', () => {
    logCommand({ user: ws.login, message: 'WS_DISCONNECTED' });
  });
});

async function handleCommand(ws, command) {
  if (!canRunCommand(ws.role, command)) {
    logCommand({
      user: ws.login,
      message: 'FORBIDDEN',
      extra: { command, role: ws.role },
    });
    throw new Error('FORBIDDEN');
  }

  if (command === COMMANDS.LOGOUT) {
    logCommand({ user: ws.login, message: COMMANDS.LOGOUT, extra: { jti: ws.jti, role: ws.role } });
    revokeJti(ws.jti);
    try {
      await control.request(CONTROL.REVOKE, { jti: ws.jti, user: ws.login });
      logCommand({ user: ws.login, message: 'REVOKE_FORWARDED', extra: { jti: ws.jti } });
    } catch (error) {
      logCommand({
        user: ws.login,
        message: 'REVOKE_FORWARD_FAILED',
        extra: { error: error.message, jti: ws.jti },
      });
    }
    return 'OK';
  }

  if (!VIDEO_COMMANDS.has(command)) {
    throw new Error('UNKNOWN_COMMAND');
  }

  logCommand({ user: ws.login, message: `FORWARD_${command}`, extra: { role: ws.role } });
  const result = await control.request(command, { user: ws.login, role: ws.role });
  logCommand({ user: ws.login, message: `RESULT_${command}`, extra: result });

  if (command === COMMANDS.GET_STATUS) {
    return formatStatusReply(result);
  }
  return 'OK';
}

function sendJson(ws, object) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(object));
}

server.listen(config.serverB.httpPort, config.serverB.host, () => {
  console.log(`[server-b] listening on http://${config.serverB.host}:${config.serverB.httpPort}`);
});
