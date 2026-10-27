// Download the pinned Tasks release for the real-app test. This code is not in main.js.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const dir = 'node_modules/.task-field-labels-fixtures/tasks';
const files = {
 'main.js': 'f901cc5537518787cd07db251d8b0db43491a127440d1b415f9cae950fbb587b',
 'manifest.json': '1920ee9d69357bdc4685becf9738da59a43132a57edf2ef4cf06ec62f2445eff',
 'styles.css': '1e2cbfff193a8086c07219b140fb52782348a7cf037ea101d8a5e5e92f7093b9',
};
mkdirSync(dir, { recursive: true });
for (const [name, hash] of Object.entries(files)) {
 const file = `${dir}/${name}`;
 const digest = (b) => createHash('sha256').update(b).digest('hex');
 if (existsSync(file) && digest(readFileSync(file)) === hash) continue;
 const response = await fetch(`https://github.com/obsidian-tasks-group/obsidian-tasks/releases/download/8.5.0/${name}`, { signal: AbortSignal.timeout(60000) });
 if (!response.ok) throw new Error(`Tasks ${name}: HTTP ${response.status}`);
 const bytes = Buffer.from(await response.arrayBuffer());
 if (digest(bytes) !== hash) throw new Error(`Tasks ${name}: SHA-256 mismatch`);
 writeFileSync(file, bytes);
}
console.log('Tasks 8.5.0 fixture hashes match.');
