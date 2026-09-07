import net from 'node:net';
import { attachFramer, sendFrame } from '../shared/framing.js';
import { revokeJti } from '../shared/jwt.js';
import { CONTROL } from '../shared/protocol.js';
import { config } from '../shared/config.js';

export function startControlServer(hub) {
  const srv = net.createServer((sock) => {
    sock.setKeepAlive(true, 5000);
    console.log('[server-a] control client connected');

    attachFramer(sock, (msg) => onCtrl(hub, sock, msg));

    sock.on('error', (err) => {
      console.warn(`[server-a] control socket error: ${err.message}`);
    });
    sock.on('close', () => {
      console.log('[server-a] control client disconnected');
    });
  });

  srv.listen(config.serverA.controlPort, config.serverA.host, () => {
    console.log(`[server-a] control TCP listening on ${config.serverA.host}:${config.serverA.controlPort}`);
  });

  return srv;
}

function onCtrl(hub, sock, msg) {
  const type = msg?.type;
  const requestId = msg?.requestId;

  if (type === CONTROL.PING) {
    sendFrame(sock, { type: CONTROL.PONG });
    return;
  }

  if (type === CONTROL.START_VIDEO) {
    sendFrame(sock, { type: CONTROL.ACK, requestId, ok: true, ...hub.startVideo() });
    return;
  }

  if (type === CONTROL.STOP_VIDEO) {
    sendFrame(sock, { type: CONTROL.ACK, requestId, ok: true, ...hub.stopVideo() });
    return;
  }

  if (type === CONTROL.GET_STATUS) {
    sendFrame(sock, { type: CONTROL.STATUS, requestId, ok: true, ...hub.getStatus() });
    return;
  }

  if (type === CONTROL.REVOKE) {
    revokeJti(msg.jti);
    hub.revoke(msg.jti);
    sendFrame(sock, { type: CONTROL.ACK, requestId, ok: true });
    return;
  }

  sendFrame(sock, {
    type: CONTROL.ACK,
    requestId,
    ok: false,
    error: `UNKNOWN_TYPE ${type ?? ''}`,
  });
}
