// node ci/make-vault.mjs <plugin-dir> <vault-dir>
// Makes the shots vault: docs/sample-notes/ goes to <vault>/<manifest name>/ (the same layout as tools/dev.mjs),
// app.json keeps Settings in the main window so the screenshot can see it.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

const [pluginDir, vault] = process.argv.slice(2).map((p) => path.resolve(p));
if (!pluginDir || !vault) throw new Error('usage: node make-vault.mjs <plugin-dir> <vault-dir>');
const manifest = JSON.parse(readFileSync(path.join(pluginDir, 'manifest.json'), 'utf8'));
mkdirSync(path.join(vault, '.obsidian'), { recursive: true });
writeFileSync(path.join(vault, '.obsidian', 'app.json'), `${JSON.stringify({ promptDelete: false, settingsPopoutWindow: false }, null, 2)}\n`);
const notes = path.join(pluginDir, 'docs', 'sample-notes');
if (existsSync(notes)) cpSync(notes, path.join(vault, manifest.name), { recursive: true });
else writeFileSync(path.join(vault, 'Welcome.md'), '# Welcome\n');
console.log(`vault ${vault}: notes from ${existsSync(notes) ? notes : '(none)'} in ${manifest.name}/`);
