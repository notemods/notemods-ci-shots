import { browser, expect } from '@wdio/globals';
import data from '../../tests/vectors/zettelkasten-archive-import.json';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import type Zkn3ArchiveImportPlugin from '../../src/main';
import type { SponsorsManager } from '../../src/license/index';
import { pluginId } from './load';

const vectors = data as unknown as { cases: { name: string; function: string; args: unknown[]; expected: unknown }[] };
const fixture = (name: string) => Array.from(readFileSync(`tests/fixtures/${name}`));
type Plugins = { plugins: { plugins: Record<string, Zkn3ArchiveImportPlugin> } };

async function closeModals(): Promise<void> {
	await browser.executeObsidian(({ app }) => { (app as unknown as Plugins).plugins.plugins['zettelkasten-archive-import']!.closeImportWindows(); });
}
async function setPro(on: boolean): Promise<void> {
	await browser.executeObsidian(async ({ app }, enabled) => {
		const p = (app as unknown as Plugins).plugins.plugins['zettelkasten-archive-import']!;
		const pro = p.pro as SponsorsManager;
		if (!enabled) { pro.signOut(); return; }
		// Synthetic token store and HTTP answer. No network request or Keychain key.
		let token: string | null = 'gho_' + '0'.repeat(36);
		pro.opts.tokens.get = () => token; pro.opts.tokens.set = (v) => { token = v; }; pro.opts.tokens.clear = () => { token = null; };
		pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader', totalSponsorshipAmountAsSponsorInCents: 1500 }, user: { viewerIsSponsoring: true, sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		await pro.refreshNow();
	}, on);
}

describe('Zettelkasten Archive Import in real Obsidian', function () {
	afterEach(async () => { await closeModals(); await setPro(false); });

	it('runs the ZIP golden vectors with the real ZIP and XML readers', async () => {
		for (const c of vectors.cases.filter((v) => v.function === 'inspectZipBase64')) {
			const result = await browser.executeObsidian(({ app }, base64) => {
				const p = (app as unknown as Plugins).plugins.plugins['zettelkasten-archive-import']!;
				try {
					const raw = atob(base64);
					const bytes = new Uint8Array(raw.length);
					for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
					const a = p.readArchive(bytes);
					return JSON.stringify({ live: a.notes.length, positions: a.notes.map((n) => n.position) });
				} catch (e) { return JSON.stringify({ error: e instanceof Error ? e.message : String(e) }); }
			}, c.args[0] as string);
			expect(JSON.parse(result)).toEqual(c.expected);
		}
	});

	it('runs the XML golden vectors with the browser XML parser', async () => {
		for (const c of vectors.cases.filter((v) => v.function === 'inspectXml')) {
			const bytes = Array.from(zipSync({
				'metaInformation.xml': strToU8(c.args[0] as string),
				'zknFile.xml': strToU8(c.args[1] as string),
				'keywordFile.xml': strToU8(c.args[2] as string),
			}));
			const result = await browser.executeObsidian(({ app }, raw) => {
				const p = (app as unknown as Plugins).plugins.plugins['zettelkasten-archive-import']!;
				try {
					const a = p.readArchive(new Uint8Array(raw));
					return JSON.stringify({ live: a.notes.length, positions: a.notes.map((n) => n.position), deleted: a.deleted, keywords: a.notes.map((n) => n.keywords), warnings: a.warnings });
				} catch (e) { return JSON.stringify({ error: e instanceof Error ? e.message : String(e) }); }
			}, bytes);
			expect(JSON.parse(result)).toEqual(c.expected);
		}
	});

	it('imports the official sample through the file picker and creates all 75 notes', async () => {
		await browser.executeObsidian(({ app }) => { (app as unknown as Plugins).plugins.plugins['zettelkasten-archive-import']!.settings.folder = 'E2E official sample'; });
		await browser.executeObsidianCommand(`${pluginId}:import-archive`);
		await browser.$('input.zkn3-picker:not(.zkn3-earlier)[type="file"]').setValue(resolve('tests/fixtures/zkn3-sample.zkn3'));
		await browser.waitUntil(async () => (await browser.$('.zkn3-status').getText()).includes('Preview ready'), { timeout: 20000 });
		expect(await browser.$('.zkn3-counts').getText()).toContain('75 live notes');
		expect(await browser.$('.zkn3-counts').getText()).toContain('75 new');
		await browser.$('button=Create notes').click();
		await browser.waitUntil(async () => (await browser.$('.zkn3-status').getText()).includes('75 notes created'), { timeout: 20000 });
		expect(await browser.$('.zkn3-status').getText()).toContain('0 errors');
		const output = await browser.executeObsidian(async ({ app }) => ({
			paths: app.vault.getMarkdownFiles().filter((f) => f.path.startsWith('E2E official sample/')).map((f) => f.path).sort(),
			text: await app.vault.read(app.vault.getFileByPath('E2E official sample/1.md')!),
		}));
		expect(output.paths).toEqual(Array.from({ length: 75 }, (_, i) => `E2E official sample/${i + 1}.md`).sort());
		expect(output.text).toContain('Zettelkasten /s');
	});

	it('imports the official mixed markup and local deleted-slot fixtures', async () => {
		for (const [name, folder] of [['zkn3-tricky.zkn3', 'E2E official tricky'], ['zkn3-deleted-slot.zkn3', 'E2E local edge']]) {
			const output = await browser.executeObsidian(async ({ app }, bytes, dest) => {
				const p = (app as unknown as Plugins).plugins.plugins['zettelkasten-archive-import']!;
				const a = p.readArchive(new Uint8Array(bytes));
				const plan = await p.prepare(a, dest);
				const result = await p.importPlan(plan);
				return { result, missing: plan.missing, paths: plan.notes.map((n) => n.path), text: await app.vault.read(app.vault.getFileByPath(`${dest}/1.md`)!) };
			}, fixture(name!), folder!);
			expect(output.result.errors).toEqual([]);
			if (name === 'zkn3-tricky.zkn3') {
				expect(output.result.created).toBe(1);
				expect(output.text).toContain('# Headline');
				expect(output.text).toContain('> Zitat, welches korrekt übernommen wird');
				expect(output.text).toContain('> Zitat , welches nicht korrekt übernommen wird');
			} else {
				expect(output.result.created).toBe(2);
				expect(output.paths).toEqual(['E2E local edge/1.md', 'E2E local edge/3.md']);
				expect(output.text).toContain('[[3|Other]]');
				expect(output.missing).toEqual(['Note 3: missing target 2.']);
			}
		}
	});

	it('selects a .zkn3 file in the UI and creates 1.md and 3.md with a resolved link', async () => {
		await browser.executeObsidian(({ app }) => { (app as unknown as Plugins).plugins.plugins['zettelkasten-archive-import']!.settings.folder = 'E2E cards'; });
		await browser.executeObsidianCommand(`${pluginId}:import-archive`);
		await browser.$('input.zkn3-picker:not(.zkn3-earlier)[type="file"]').setValue(resolve('tests/fixtures/deleted-slot.zkn3'));
		await browser.waitUntil(async () => (await browser.$('.zkn3-status').getText()).includes('Preview ready'), { timeout: 20000, timeoutMsg: 'Import preview did not finish' });
		expect(await browser.$('.zkn3-counts').getText()).toContain('2 live notes');
		expect(await browser.$('.zkn3-counts').getText()).toContain('1 deleted slot');
		await browser.$('button=Create notes').click();
		await browser.waitUntil(async () => (await browser.$('.zkn3-status').getText()).includes('2 notes created'), { timeout: 20000, timeoutMsg: 'Import did not finish' });
		await browser.waitUntil(async () => browser.executeObsidian(({ app }) =>
			app.metadataCache.getFirstLinkpathDest('3', 'E2E cards/1.md')?.path === 'E2E cards/3.md',
		), { timeout: 20000, timeoutMsg: 'The imported link did not resolve to note 3' });
		const output = await browser.executeObsidian(async ({ app }) => {
			const one = app.vault.getFileByPath('E2E cards/1.md')!;
			return {
				paths: app.vault.getMarkdownFiles().filter((f) => f.path.startsWith('E2E cards/')).map((f) => f.path).sort(),
				text: await app.vault.read(one),
				target: app.metadataCache.getFirstLinkpathDest('3', one.path)?.path ?? null,
			};
		});
		expect(output.paths).toEqual(['E2E cards/1.md', 'E2E cards/3.md']);
		expect(output.text).toContain('Read [[3|Other]] first.');
		expect(output.text).toContain('1. [[3|Other]]');
		expect(output.target).toBe('E2E cards/3.md');
	});

	it('skips a repeat import and keeps the existing notes', async () => {
		const result = await browser.executeObsidian(async ({ app }, bytes) => {
			const p = (app as unknown as Plugins).plugins.plugins['zettelkasten-archive-import']!;
			const a = p.readArchive(new Uint8Array(bytes));
			await p.importPlan(await p.prepare(a, 'E2E repeat'));
			const f = app.vault.getFileByPath('E2E repeat/1.md')!;
			await app.vault.append(f, '\nMy edit.');
			const second = await p.importPlan(await p.prepare(a, 'E2E repeat'));
			return { second, text: await app.vault.read(f) };
		}, fixture('deleted-slot.zkn3'));
		expect(result.second.created).toBe(0);
		expect(result.second.skipped).toBe(2);
		expect(result.text).toContain('My edit.');
	});

	it('rejects a version 9.0 archive in the UI before a vault write', async () => {
		const before = await browser.executeObsidian(({ app }) => app.vault.getFiles().length);
		await browser.executeObsidianCommand(`${pluginId}:import-archive`);
		await browser.$('input.zkn3-picker:not(.zkn3-earlier)[type="file"]').setValue(resolve('tests/fixtures/version-9.zkn3'));
		await browser.waitUntil(async () => (await browser.$('.zkn3-status').getText()).includes('version 9.0'), { timeout: 20000 });
		expect(await browser.$('button=Create notes').isEnabled()).toBe(false);
		expect(await browser.executeObsidian(({ app }) => app.vault.getFiles().length)).toBe(before);
	});

	it('Pro rules and the archive comparison work, and turn off after sign out', async () => {
		await setPro(true);
		const result = await browser.executeObsidian(async ({ app }, bytes) => {
			const p = (app as unknown as Plugins).plugins.plugins['zettelkasten-archive-import']!;
			const a = p.readArchive(new Uint8Array(bytes));
			await p.saveRules({ fileName: 'number-title', keywordProperty: 'zkn_keywords', keywordTags: true });
			await p.importPlan(await p.prepare(a, 'E2E pro'));
			const text = await app.vault.read(app.vault.getFileByPath('E2E pro/1 Start.md')!);
			const compare = p.compare(a, a);
			p.pro!.signOut();
			let blocked = '';
			try { p.compare(a, a); } catch (e) { blocked = e instanceof Error ? e.message : String(e); }
			const rules = p.activeRules();
			p.settings.rules = { fileName: 'number', keywordProperty: 'keywords', keywordTags: false };
			return { text, compare, blocked, rules };
		}, fixture('deleted-slot.zkn3'));
		expect(result.text).toContain('[[3 Other|Other]]');
		expect(result.text).toContain('zkn_keywords:');
		expect(result.compare).toEqual({ added: [], changed: [], removed: [], unchanged: [1, 3] });
		expect(result.blocked).toContain('needs Pro');
		expect(result.rules.fileName).toBe('number');
	});

	it('discards a Pro preview after sign out and rejects its old plan before any write', async () => {
		await setPro(true);
		const output = await browser.executeObsidian(async ({ app }, bytes) => {
			const p = (app as unknown as Plugins).plugins.plugins['zettelkasten-archive-import']!;
			p.settings.folder = 'E2E sign out';
			await p.saveRules({ fileName: 'number-title', keywordProperty: 'zkn_keywords', keywordTags: true });
			const archive = p.readArchive(new Uint8Array(bytes));
			const plan = await p.prepare(archive, 'E2E sign out');
			const modal = p.openImport(archive);
			await modal.refreshPreview();
			modal.showComparison(archive);
			p.pro!.signOut();
			const create = Array.from(modal.contentEl.querySelectorAll('button')).find((b) => b.textContent === 'Create notes');
			const cleared = modal.contentEl.querySelector('.zkn3-preview')?.textContent === '';
			const disabled = create?.disabled;
			let blocked = '';
			try { await p.importPlan(plan); } catch (e) { blocked = e instanceof Error ? e.message : String(e); }
			const wroteFolder = !!app.vault.getAbstractFileByPath('E2E sign out');
			await modal.refreshPreview();
			const freePaths = Array.from(modal.contentEl.querySelectorAll('tbody tr')).map((row) => row.querySelector('td:last-child')?.textContent);
			return { cleared, disabled, blocked, wroteFolder, freePaths };
		}, fixture('deleted-slot.zkn3'));
		expect(output.cleared).toBe(true);
		expect(output.disabled).toBe(true);
		expect(output.blocked).toContain('need Pro');
		expect(output.wroteFolder).toBe(false);
		expect(output.freePaths).toEqual(['E2E sign out/1.md', 'E2E sign out/3.md']);
	});
});
