import http from 'node:http';
import { WebSocketServer } from 'ws';
import { config } from '../shared/config.js';
import { verifyToken } from '../shared/jwt.js';
import { startControlServer } from './controlServer.js';
import { VideoHub } from './videoHub.js';

const hub = new VideoHub();
hub.start();
startControlServer(hub);

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...hub.getStatus() }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  let url;
  try {
    url = new URL(request.url, `http://${request.headers.host}`);
  } catch {
    socket.destroy();
    return;
  }

  if (url.pathname !== '/stream') {
    socket.destroy();
    return;
  }

  try {
    const payload = verifyToken(url.searchParams.get('token'));
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.jti = payload.jti;
      ws.login = payload.login;
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
    console.warn(`[server-a] rejected video socket: ${error.message}`);
  }
});

wss.on('connection', (ws) => {
  console.log('[server-a] client on video ws:', ws.login);
  hub.addClient(ws);
  ws.on('error', () => {});
});

server.listen(config.serverA.httpPort, config.serverA.host, () => {
  console.log(`[server-a] video HTTP/WS listening on ${config.serverA.host}:${config.serverA.httpPort}`);
});
