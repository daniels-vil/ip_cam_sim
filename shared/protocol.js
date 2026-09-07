export const COMMANDS = {
  START_VIDEO: 'START_VIDEO',
  STOP_VIDEO: 'STOP_VIDEO',
  GET_STATUS: 'GET_STATUS',
  LOGOUT: 'LOGOUT',
};

// same strings, used on the A->B and B->A TCP side
export const CONTROL = {
  START_VIDEO: 'START_VIDEO',
  STOP_VIDEO: 'STOP_VIDEO',
  GET_STATUS: 'GET_STATUS',
  REVOKE: 'REVOKE',
  ACK: 'ACK',
  STATUS: 'STATUS',
  PING: 'PING',
  PONG: 'PONG',
};

export const VIDEO_COMMANDS = new Set([
  COMMANDS.START_VIDEO,
  COMMANDS.STOP_VIDEO,
  COMMANDS.GET_STATUS,
]);

export function parseClientCommand(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  // allow {"command":"..."} just in case
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object') {
      const value = obj.command ?? obj.message ?? obj.type;
      if (value) return String(value).trim().toUpperCase();
    }
  } catch (_) {
    // not json= fine
  }

  return text.split(/\s+/)[0].toUpperCase();
}

export function formatStatusReply(status) {
  if (status && status.videoRunning) return 'VIDEO_RUNNING';
  return 'VIDEO_STOPPED';
}
