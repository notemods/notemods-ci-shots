// Test dependency only. The released plugin does not download or install Templater.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const files = {
 'main.js': '0acd45cfdb3a7337e2bef511699bc1f819dc64645ad3480df33579d42d2dcbaa',
 'manifest.json': '91c9fa8510082fffa0b3d022aac4986e3b392295b1126e847ead7ed7289169b8',
 'styles.css': '67a6dd2d1d6dedca1287c334ca884ec4196433f71ca47388a0bd3eac14cf8b5f',
};
await mkdir('.test-deps/templater', { recursive: true });
for (const [name, expected] of Object.entries(files)) {
 const path = `.test-deps/templater/${name}`;
 let data = await readFile(path).catch(() => null);
 const hash = (data) => createHash('sha256').update(data).digest('hex');
 if (!data || hash(data) !== expected) {
  const response = await fetch(`https://github.com/SilentVoid13/Templater/releases/download/2.26.0/${name}`, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Templater download failed with ${response.status}`);
  data = Buffer.from(await response.arrayBuffer());
  if (hash(data) !== expected) throw new Error(`Templater ${name} checksum mismatch`);
  await writeFile(path, data);
 }
}
