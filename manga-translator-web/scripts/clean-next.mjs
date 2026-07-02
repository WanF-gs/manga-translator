import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const targets = ['.next', join('node_modules', '.cache')];

for (const dir of targets) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    console.log(`[clean-next] removed ${dir}`);
  }
}

console.log('[clean-next] done');
