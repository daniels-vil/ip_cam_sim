import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { config } from '../shared/config.js';

const accounts = [
  { login: 'admin', password: 'admin123', role: 'operator' },
  { login: 'operator', password: 'operator123', role: 'operator' },
  { login: 'viewer', password: 'viewer123', role: 'viewer' },
];

const users = [];
for (const account of accounts) {
  users.push({
    login: account.login,
    passwordHash: await bcrypt.hash(account.password, 10),
    role: account.role,
  });
}

fs.writeFileSync(config.paths.users, `${JSON.stringify(users, null, 2)}\n`);
console.log(`Wrote ${users.length} users to ${config.paths.users}`);
