import { COMMANDS } from './protocol.js';

export const ROLES = {
  VIEWER: 'viewer',
  OPERATOR: 'operator',
};

// logout is always ok; everything else depends on role
const ALLOWED = {
  [ROLES.VIEWER]: new Set([COMMANDS.GET_STATUS, COMMANDS.LOGOUT]),
  [ROLES.OPERATOR]: new Set([
    COMMANDS.GET_STATUS,
    COMMANDS.START_VIDEO,
    COMMANDS.STOP_VIDEO,
    COMMANDS.LOGOUT,
  ]),
};

export function normalizeRole(role) {
  const value = String(role ?? '').trim().toLowerCase();
  return value === ROLES.OPERATOR || value === ROLES.VIEWER ? value : null;
}

export function canRunCommand(role, command) {
  if (command === COMMANDS.LOGOUT) return true;
  const allowed = ALLOWED[normalizeRole(role)];
  return Boolean(allowed?.has(command));
}
