#!/usr/bin/env node
// Bumps the version everywhere, commits, tags and pushes. GitHub Actions does the rest.
//
//   npm run release -- patch "Was ist neu"
//   npm run release -- minor
//   npm run release -- 1.4.0 "Notizen" --no-push
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const push = !args.includes('--no-push');
const [bump = 'patch', notes = ''] = args.filter((a) => !a.startsWith('--'));

const sh = (cmd) => execSync(cmd, { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

if (sh('git status --porcelain')) fail('Es gibt uncommittete Änderungen. Erst committen, dann releasen.');
if (push && !sh('git remote')) fail('Kein Git-Remote. Erst das GitHub-Repo verbinden (siehe README).');

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const [ma, mi, pa] = pkg.version.split('.').map(Number);
const next =
  bump === 'major' ? `${ma + 1}.0.0`
  : bump === 'minor' ? `${ma}.${mi + 1}.0`
  : bump === 'patch' ? `${ma}.${mi}.${pa + 1}`
  : /^\d+\.\d+\.\d+$/.test(bump) ? bump
  : fail(`Unbekannte Version "${bump}" (patch, minor, major oder x.y.z).`);
const tag = `v${next}`;
if (sh(`git tag -l ${tag}`)) fail(`Tag ${tag} gibt es schon.`);

const edit = (file, fn) => writeFileSync(file, fn(readFileSync(file, 'utf8')));
const json = (file, fn) => edit(file, (s) => JSON.stringify(fn(JSON.parse(s)), null, 2) + '\n');

json('package.json', (j) => ({ ...j, version: next }));
json('package-lock.json', (j) => {
  j.version = next;
  if (j.packages?.['']) j.packages[''].version = next;
  return j;
});
json('src-tauri/tauri.conf.json', (j) => ({ ...j, version: next }));
edit('src-tauri/Cargo.toml', (s) => s.replace(/^version = ".*?"/m, `version = "${next}"`));
edit('src-tauri/Cargo.lock', (s) =>
  s.replace(/(name = "achievement-hunter"\r?\nversion = )".*?"/, `$1"${next}"`),
);

console.log(`→ Tests …`);
execSync('npm test', { stdio: 'inherit' });

const files = 'package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock';
sh(`git add ${files}`);
sh(`git commit -m "Release ${tag}"`);
writeFileSync('.git/RELEASE_NOTES', notes || `Achievement Hunter ${tag}`);
sh(`git tag -a ${tag} -F .git/RELEASE_NOTES`);

if (push) {
  sh('git push origin HEAD');
  sh(`git push origin ${tag}`);
  console.log(`✓ ${tag} gepusht. GitHub baut und veröffentlicht jetzt (Tab "Actions").`);
} else {
  console.log(`✓ ${tag} lokal erstellt. Veröffentlichen: git push origin HEAD && git push origin ${tag}`);
}
