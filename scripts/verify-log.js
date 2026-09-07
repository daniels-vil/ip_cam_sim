import { verifyLogFile } from '../server-b/logger.js';
import { config } from '../shared/config.js';

const result = verifyLogFile();
if (!result.ok) {
  console.error(`FAIL ${config.paths.commandsLog}: ${result.error}`);
  process.exit(1);
}

const extra = result.unsigned ? ` (${result.unsigned} old unsigned lines)` : '';
console.log(`OK ${result.lines} lines${extra}`);
