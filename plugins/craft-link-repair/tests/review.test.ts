import { describe, it, expect } from 'vitest';
import { convertMarkdown } from '../src/repair';

const url = 'craftdocs://open?documentId=page';
const map = new Map([['page', 'Export/Page.repaired']]);

describe('review defects', () => {
	it('repairs a link between two divider lines', () => {
		const text = `Intro\n\n---\n\n[Page](${url})\n\n---\n\nEnd`;
		const out = convertMarkdown(text, 'Export/Note.md', 'Export/Note.repaired.md', map);
		expect(out.text).toBe('Intro\n\n---\n\n[[Export/Page.repaired|Page]]\n\n---\n\nEnd');
		expect(out.changes).toHaveLength(1);
	});
	it('still keeps frontmatter at the start intact', () => {
		const text = `---\nlink: "[Page](${url})"\n---\n[Page](${url})`;
		expect(convertMarkdown(text, 'Export/Note.md', 'Export/Note.repaired.md', map).text).toBe(`---\nlink: "[Page](${url})"\n---\n[[Export/Page.repaired|Page]]`);
	});
	it('rebases the destination, not a label equal to the path', () => {
		const out = convertMarkdown('![a.png](a.png)', 'Export/Sub/Note.md', 'Copies/Sub/Note.md', map);
		expect(out.text).toBe('![a.png](../../Export/Sub/a.png)');
	});
	it('keeps a dollar sign in a rebased path', () => {
		const out = convertMarkdown('![x](a$&b.png)', 'Export/Note.md', 'Copies/Note.md', map);
		expect(out.text).toBe('![x](../Export/a$&b.png)');
	});
});

import { vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import CraftLinkRepairPlugin from '../src/main';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

describe('automatic folder path', () => {
	it('schedules a pass when the saved folder has a trailing slash', async () => {
		const app = App.createConfigured__({ files: { 'Export/Page.textbundle/text.md': 'x', 'Export/Page.textbundle/info.json': '{"identifier":"p"}' } });
		const plugin = new CraftLinkRepairPlugin(app as never, manifest as never);
		await plugin.onload();
		bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
		plugin.settings.automatic = true; plugin.settings.folder = 'Export/';
		const spy = vi.spyOn(window, 'setTimeout');
		plugin.scheduleAutomatic('Export/Page.textbundle/text.md');
		expect(spy).toHaveBeenCalled();
		plugin.onunload(); resetPro(); spy.mockRestore();
	});
});

describe('report names', () => {
	it('gives a second pass a numbered report and keeps the first report', async () => {
		const app = App.createConfigured__({ files: { 'Export/Page.textbundle/text.md': 'x', 'Export/Page.textbundle/info.json': '{"identifier":"p"}' } });
		const plugin = new CraftLinkRepairPlugin(app as never, manifest as never);
		await plugin.onload();
		const first = await plugin.writePlan(await plugin.prepare('Export'));
		const before = await app.vault.read(app.vault.getFileByPath(first.report)!);
		const second = await plugin.writePlan(await plugin.prepare('Export'));
		expect(first.report).toBe('Export/Craft repair report.md');
		expect(second.report).toBe('Export/Craft repair report 2.md');
		expect(await app.vault.read(app.vault.getFileByPath(first.report)!)).toBe(before);
		plugin.onunload();
	});
});
