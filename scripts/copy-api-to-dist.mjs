import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const apiSrc = path.join(rootDir, 'api');
const distDir = path.join(rootDir, 'dist');
const apiDest = path.join(distDir, 'api');

if (!existsSync(apiSrc)) {
  console.error('copy-api-to-dist: api directory not found');
  process.exit(1);
}

if (!existsSync(distDir)) {
  console.error('copy-api-to-dist: dist directory not found; run vite build first');
  process.exit(1);
}

// Start clean to avoid stale deleted backend files in dist.
rmSync(apiDest, { recursive: true, force: true });
mkdirSync(apiDest, { recursive: true });

cpSync(apiSrc, apiDest, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(apiSrc, src).replaceAll('\\', '/');
    if (!rel) return true;

    // Keep server-specific secrets and runtime uploads out of git-based deploy artifacts.
    if (rel === 'config.php') return false;
    if (rel.startsWith('uploads/')) return false;

    return true;
  },
});

console.log('copy-api-to-dist: copied api -> dist/api (excluding config.php and uploads/)');
