import { browser, expect } from '@wdio/globals';
import type { TFile } from 'obsidian';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

interface P {
	state: { session: { path: string; text: string; invalid: boolean } | null; named: unknown[] };
	settings: { baselineName: string; author: string; includeSummary: boolean };
	lastMessage: string;
	pro: { signOut(): void; opts: { http: unknown }; refreshNow(): Promise<unknown> };
	startSession(f: TFile, text: string): Promise<void>;
	stopSession(f: TFile, text: string): Promise<TFile | null>;
	discardSession(): Promise<void>;
	saveNamed(f: TFile, text: string): Promise<void>;
	reviewNamed(f: TFile, text: string): Promise<TFile | null>;
	reviewFolder(f: TFile, text: string): Promise<TFile[]>;
	saveSettings(): Promise<void>;
}
async function exists(path: string): Promise<boolean> {
	return browser.executeObsidian(({ app }, path) => app.vault.getAbstractFileByPath(path) !== null, path);
}
async function reset(): Promise<void> {
	await browser.executeObsidian(async ({ app }, id) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
		document.querySelectorAll<HTMLElement>('.modal-close-button').forEach((b) => b.click());
		p.pro.signOut(); await p.discardSession(); p.state.named = [];
		p.settings = { baselineName: 'First draft', author: '', includeSummary: false };
		p.lastMessage = ''; await p.saveSettings();
	}, pluginId);
}
async function open(path: string, text: string): Promise<void> {
	await obsidianPage.write(path, text);
	await obsidianPage.openFile(path);
	await browser.waitUntil(async () => browser.executeObsidian(({ app }, path, text) => {
		return app.workspace.activeEditor?.file?.path === path && app.workspace.activeEditor?.editor?.getValue() === text;
	}, path, text), { timeout: 10000, timeoutMsg: 'The requested draft did not reach the active editor.' });
}
async function command(id: string): Promise<void> {
	// Await the registered editor callback itself. The app command dispatcher returns before an async command completes.
	await browser.executeObsidian(async ({ app }, command) => {
		const editor = app.workspace.activeEditor;
		if (!editor?.editor || !editor.file) throw new Error('No active draft editor.');
		const cmds = (app as unknown as { commands: { commands: Record<string, { editorCallback(editor: unknown, ctx: unknown): Promise<void> }> } }).commands.commands;
		await cmds[command]!.editorCallback(editor.editor, editor);
	}, `${pluginId}:${id}`);
}
async function session(): Promise<{ path: string; text: string; invalid: boolean } | null> {
	return browser.executeObsidian(({ app }, id) => (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!.state.session, pluginId);
}
async function message(): Promise<string> {
	return browser.executeObsidian(({ app }, id) => (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!.lastMessage, pluginId);
}
async function edit(text: string): Promise<void> {
	await browser.executeObsidian(async ({ app, obsidian }, text) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
		if (!view) throw new Error('No Markdown editor.');
		view.editor.setValue(text); await view.save();
	}, text);
}
async function setPro(): Promise<void> {
	await browser.executeObsidian(async ({ app }, id) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
		p.pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
		await p.pro.refreshNow();
	}, pluginId);
}

describe('Revision session commands in the real app', () => {
	beforeEach(async () => { await reset(); });
	it('makes an addition review through the registered commands and keeps the source', async () => {
		await open('Addition.md', 'We go.'); await command('start-session');
		expect((await session())?.text).toBe('We go.');
		await edit('We now go.'); await command('stop-session');
		expect(await obsidianPage.read('Addition review.md')).toBe('We {++now ++}go.');
		expect(await obsidianPage.read('Addition.md')).toBe('We now go.');
		expect(await session()).toBeNull();
		expect(await browser.$('.revision-session-marks-modal').getText()).toContain('Accept check passed');
		expect(await browser.$('.revision-session-marks-modal').getText()).toContain('Reject check passed');
	});
	it('keeps a baseline after a full app restart', async () => {
		await open('Restart.md', 'We go.'); await command('start-session');
		await browser.reloadObsidian();
		await browser.waitUntil(async () => (await session())?.path === 'Restart.md', { timeout: 15000 });
		await obsidianPage.openFile('Restart.md');
		await browser.waitUntil(async () => browser.executeObsidian(({ app }) => app.workspace.activeEditor?.file?.path === 'Restart.md' && app.workspace.activeEditor?.editor?.getValue() === 'We go.'), { timeout: 10000 });
		await edit('We stay.'); await command('stop-session');
		expect(await obsidianPage.read('Restart review.md')).toBe('We {~~go~>stay~~}.');
		expect(await obsidianPage.read('Restart.md')).toBe('We stay.');
	});
	it('preserves whole Greek words and a whitespace substitution', async () => {
		await open('Greek.md', 'αβ. A B.'); await command('start-session');
		await edit('αγ. A  B.'); await command('stop-session');
		expect(await obsidianPage.read('Greek review.md')).toBe('{~~αβ~>αγ~~}. A{~~ ~>  ~~}B.');
	});
	it('makes no output on equal text and keeps the session', async () => {
		await open('Equal.md', 'We go.'); await command('start-session'); await command('stop-session');
		expect(await message()).toBe('No changes.');
		expect((await session())?.text).toBe('We go.');
		expect(await exists('Equal review.md')).toBe(false);
	});
	it('rejects unsupported final input and retains the baseline', async () => {
		await open('Unsupported.md', 'We go.'); await command('start-session');
		await edit('We [[go]].'); await command('stop-session');
		expect(await message()).toContain('Unsupported final input');
		expect((await session())?.text).toBe('We go.');
		expect(await exists('Unsupported review.md')).toBe(false);
	});
	it('rejects another note without a silent path change', async () => {
		await open('Original.md', 'We go.'); await command('start-session');
		await open('Other.md', 'We stay.'); await command('stop-session');
		expect(await message()).toContain('Baseline file does not match');
		expect((await session())?.path).toBe('Original.md');
		expect(await exists('Other review.md')).toBe(false);
	});
	it('invalidates a rename even if the path is restored', async () => {
		await open('Rename.md', 'We go.'); await command('start-session');
		await browser.executeObsidian(async ({ app }) => {
			const f = app.vault.getFileByPath('Rename.md')!;
			await app.vault.rename(f, 'Moved.md'); await app.vault.rename(f, 'Rename.md');
		});
		await browser.waitUntil(async () => (await session())?.invalid === true, { timeout: 10000 });
		await open('Rename.md', 'We stay.'); await command('stop-session');
		expect(await message()).toContain('Baseline file does not match');
		expect(await exists('Rename review.md')).toBe(false);
	});
	it('invalidates deletion and replacement at the same path', async () => {
		await open('Deleted.md', 'We go.'); await command('start-session');
		await browser.executeObsidian(async ({ app }) => { await app.vault.delete(app.vault.getFileByPath('Deleted.md')!); });
		await browser.waitUntil(async () => (await session())?.invalid === true, { timeout: 10000 });
		await open('Deleted.md', 'We stay.'); await command('stop-session');
		expect(await message()).toContain('Baseline file does not match');
	});
	it('rejects the input size limit without output', async () => {
		await open('Large.md', 'We go.'); await command('start-session');
		await edit('a'.repeat(102401)); await command('stop-session');
		expect(await message()).toContain('100 KB input limit');
		expect((await session())?.text).toBe('We go.');
		expect(await exists('Large review.md')).toBe(false);
	});
	it('rejects the edit count limit without output', async () => {
		await open('Limit.md', 'a '.repeat(600)); await command('start-session');
		await edit('b '.repeat(600)); await command('stop-session');
		expect(await message()).toContain('Diff work limit');
		expect(await session()).not.toBeNull();
		expect(await exists('Limit review.md')).toBe(false);
	});
	it('gates Pro commands without a sponsor check', async () => {
		await open('Free.md', 'We go.'); await command('save-named-baseline');
		expect(await message()).toContain('needs Pro');
	});
	it('creates named folder reviews with author comments through a fake sponsor response', async () => {
		await setPro();
		await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
			if (!app.vault.getAbstractFileByPath('Drafts')) await app.vault.createFolder('Drafts');
			const a = await app.vault.create('Drafts/One.md', 'We go.');
			const b = await app.vault.create('Drafts/Two.md', 'We walk.');
			await p.saveNamed(a, 'We go.'); await p.saveNamed(b, 'We walk.');
			await app.vault.modify(a, 'We stay.'); await app.vault.modify(b, 'We run.');
			p.settings.author = 'Sam'; p.settings.includeSummary = true; await p.saveSettings();
		}, pluginId);
		await obsidianPage.openFile('Drafts/One.md');
		await browser.waitUntil(async () => browser.executeObsidian(({ app }) => app.workspace.activeEditor?.file?.path === 'Drafts/One.md' && app.workspace.activeEditor?.editor?.getValue() === 'We stay.'), { timeout: 10000 });
		await command('review-folder');
		expect(await obsidianPage.read('Drafts/One review.md')).toBe('{>>Author: Sam; Changes: 0 additions, 0 deletions, 1 substitutions<<}We {~~go~>stay~~}.');
		expect(await obsidianPage.read('Drafts/Two review.md')).toContain('{~~walk~>run~~}');
		expect(await obsidianPage.read('Drafts/One.md')).toBe('We stay.');
	});
});
