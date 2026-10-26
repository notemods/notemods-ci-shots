// Entry for tests/browser.test.ts: the parser and the DOCX writer, bundled for the browser.
import { toDocxBytes } from '../../src/docx';
import { parseNote } from '../../src/parse';

(globalThis as Record<string, unknown>).run = async () => {
	const g = globalThis as Record<string, unknown>;
	const globals = Object.fromEntries(['Buffer', 'require', 'process', 'fs', 'electron'].map((k) => [k, typeof g[k]]));
	const p = parseNote('Word %% first %% and αβ %% Check < & > %%.', { author: 'Lee' });
	const bytes = new Uint8Array(await toDocxBytes({ title: 'B', creator: 'Lee', notes: [p.blocks], comments: p.comments }));
	return { globals, bytes };
};
