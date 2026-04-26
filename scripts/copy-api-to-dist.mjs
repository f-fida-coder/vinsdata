import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const apiSrc = path.join(rootDir, 'api');
const distDir = path.join(rootDir, 'dist');
const apiDest = path.join(distDir, 'api');
const htaccessSrc = path.join(rootDir, '.htaccess');
const htaccessDest = path.join(distDir, '.htaccess');

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

    // Skip uploads/ runtime dir entirely (including the dir itself) so a
    // full-folder upload to the server can't wipe real uploaded files.
    // config.local.php IS deployed (it's committed to the repo per the
    // .gitignore note explaining why).
    if (rel === 'uploads' || rel.startsWith('uploads/')) return false;

    return true;
  },
});

console.log('copy-api-to-dist: copied api -> dist/api (excluding uploads/)');

if (existsSync(htaccessSrc)) {
  copyFileSync(htaccessSrc, htaccessDest);
  console.log('copy-api-to-dist: copied .htaccess -> dist/.htaccess');
}
