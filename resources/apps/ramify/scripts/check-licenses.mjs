#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'app');
const notice = readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
const npmArguments = ['ls', '--omit=dev', '--all', '--json', '--long'];
const command = process.env.npm_execpath ? process.execPath : 'npm';
const arguments_ = process.env.npm_execpath ? [process.env.npm_execpath, ...npmArguments] : npmArguments;
const result = spawnSync(command, arguments_, {
  cwd: app,
  encoding: 'utf8',
});

if (result.status !== 0) throw new Error(result.error?.message || result.stderr || 'npm ls failed');
const tree = JSON.parse(result.stdout);
const packages = new Map();

function visit(dependencies = {}) {
  for (const [name, dependency] of Object.entries(dependencies)) {
    const identity = `${name}@${dependency.version}`;
    packages.set(identity, dependency.license || 'UNKNOWN');
    visit(dependency.dependencies);
  }
}

visit(tree.dependencies);
const errors = [];
for (const [identity, license] of packages) {
  if (!notice.includes(`\`${identity}\``)) errors.push(`${identity} is missing from THIRD_PARTY_NOTICES.md`);
  if (license !== 'MIT') errors.push(`${identity} uses unreviewed license: ${license}`);
}

if (errors.length) throw new Error(errors.join('\n'));
console.log(`Verified ${packages.size} bundled runtime packages and licenses.`);
