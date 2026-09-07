import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { config } from '../shared/config.js';

let cache = null;
let mtimeMs = 0;

export function loadUsers() {
  const stats = fs.statSync(config.paths.users);
  if (!cache || stats.mtimeMs !== mtimeMs) {
    cache = JSON.parse(fs.readFileSync(config.paths.users, 'utf8'));
    mtimeMs = stats.mtimeMs;
  }
  return cache;
}

export function findUser(login) {
  return loadUsers().find((user) => user.login === login) ?? null;
}

export async function verifyPassword(user, password) {
  if (!user?.passwordHash) return false;
  return bcrypt.compare(password, user.passwordHash);
}
