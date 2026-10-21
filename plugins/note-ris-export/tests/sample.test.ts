import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import NoteRisExportPlugin from '../src/main';
import manifest from '../manifest.json';

// The qa.json screenshots use these notes. This test keeps their captions true.
const root = join(__dirname, '..', 'docs', 'sample-notes');
const files: Record<string, string> = {};
for (const dir of readdirSync(root)) for (const f of readdirSync(join(root, dir))) files[`${dir}/${f}`] = readFileSync(join(root, dir, f), 'utf8');

async function plugin(): Promise<{ app: App; p: NoteRisExportPlugin }> {
	const app = App.createConfigured__({ files });
	const p = new NoteRisExportPlugin(app as never, manifest as never);
	await p.loadSettings();
	return { app, p };
}

describe('sample notes', () => {
	it('Refs has three clean notes and exports three records', async () => {
		const { app, p } = await plugin();
		const pre = p.preview('Refs');
		expect(pre.message).toBe('3 reference notes in Refs.');
		expect(pre.problems).toEqual([]);
		expect(await p.exportRis('Refs')).toBe('References.ris');
		const text = await app.vault.read(app.vault.getFileByPath('References.ris')!);
		expect(text.match(/^TY {2}- /gm)).toHaveLength(3);
		expect(text.match(/^ER {2}- $/gm)).toHaveLength(3);
		expect(text).toContain('TI  - Étude α\r\nAU  - García\r\nAU  - 李\r\n');
		expect(text).toContain('AB  - We test a small graph of notes. The second line of the abstract stays in the same AB value.\r\n');
	});

	it('Drafts lists three notes with errors', async () => {
		const { p } = await plugin();
		expect(p.preview('Drafts').problems).toEqual([
			{ path: 'Drafts/No title.md', errors: ['missing title (property "title")'] },
			{ path: 'Drafts/Web page.md', errors: ['unsupported type "WEB"; use JOUR, BOOK or CONF'] },
			{ path: 'Drafts/Year soon.md', errors: ['unsupported authors "Lee"; write a list (property "authors")', 'year "soon" is not a 4-digit year (property "year")'] },
		]);
	});

	it('Imported needs the paper_title map', async () => {
		const { p } = await plugin();
		expect(p.preview('Imported').problems).toHaveLength(1);
		p.settings.map = { ...p.settings.map, title: 'paper_title' };
		expect(p.preview('Imported').problems).toEqual([]);
	});
});
