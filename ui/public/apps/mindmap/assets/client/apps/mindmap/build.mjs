import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const source = join(root, 'src');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
    entryPoints: [join(source, 'index.tsx')],
    outfile: join(dist, 'client.js'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    external: ['/sdk/*'],
    define: { 'process.env.NODE_ENV': '"production"' },
    minify: true,
    sourcemap: false,
});

const css = join(dist, 'client.css');
if (existsSync(css) && /@import\s*["']?\/sdk\//.test(readFileSync(css, 'utf8'))) {
    throw new Error('Built CSS contains an unsupported /sdk/ import.');
}

cpSync(join(source, 'index.html'), join(dist, 'index.html'));
console.log('Built Mindmap UI.');
