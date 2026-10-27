import { browser, expect } from '@wdio/globals';
import type ChapterBatchExportPlugin from '../../src/main';

/** The callback runs in the app. It awaits vault reads and writes rather than a paint delay. */
async function runCase(kind: 'ui' | 'missing' | 'existing' | 'stale' | 'pro' | 'expired') {
	return browser.executeObsidian(async ({ app }, kind) => {
		const id = 'chapter-batch-export';
		const plugin = (app as unknown as { plugins: { plugins: Record<string, ChapterBatchExportPlugin> } }).plugins.plugins[id]!;
		const index = 'Chapter Batch Export/Manuscript.md';
		const folder = 'E2E ' + kind;
		const options = { folder, range: '', heading: '# {title}', filename: '{number} {title}' };
		plugin.pro!.signOut();
		const old = app.vault.getAbstractFileByPath(folder); if (old) await app.vault.delete(old, true);
		if (kind === 'pro' || kind === 'expired') {
			const pro = plugin.pro! as unknown as { opts: { http: (req: { body?: string }) => Promise<unknown> }; refreshNow(): Promise<unknown> };
			pro.opts.http = async (req) => {
				if (/Manuscript|Introduction|Chapter Batch Export/.test(req.body ?? '')) throw new Error('Vault data entered the Sponsors query.');
				return { status: 200, json: { data: { viewer: { login: 'test-sponsor' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } };
			};
			app.secretStorage.setSecret(id + '-github-token', 'gho_' + '0'.repeat(36)); await pro.refreshNow();
			options.range = '2'; options.heading = '## {number} {title}'; options.filename = 'chapter-{number}';
		}
		const file = app.vault.getFileByPath(kind === 'missing' ? 'Chapter Batch Export/Missing manuscript.md' : index)!;
		await app.workspace.getLeaf(false).openFile(file);
		const modal = plugin.openExport(file);
		try {
			if (kind === 'pro') {
				await plugin.savePreset('Review', options); modal.close();
				const loaded = plugin.openExport(file);
				try {
					const select = loaded.contentEl.querySelector<HTMLSelectElement>('select')!;
					select.value = 'Review'; select.dispatchEvent(new Event('change')); await loaded.refresh();
					const preview = loaded.preview!; await plugin.exportPreview(preview);
					return { failure: '', created: true, names: preview.plan.chapters.map((c) => c.filename), content: await app.vault.read(app.vault.getFileByPath(folder + '/chapter-02.md')!), source: '', index: '', disabled: false, rows: preview.plan.chapters.length, status: 'saved', preset: plugin.settings.presets.some((p) => p.name === 'Review') };
				} finally { loaded.close(); }
			}
			modal.options = options; await modal.refresh();
			const preview = modal.preview!;
			if (kind === 'ui') {
				return { failure: '', created: false, names: preview.plan.chapters.map((c) => c.filename), content: modal.contentEl.textContent ?? '', source: '', index: '', disabled: modal.contentEl.querySelector<HTMLButtonElement>('.cbe-export')!.disabled, rows: modal.contentEl.querySelectorAll('tbody tr').length, status: 'ready', preset: false };
			}
			if (kind === 'existing') { await app.vault.createFolder(folder); await app.vault.create(folder + '/Keep.md', 'Keep this text.'); }
			if (kind === 'expired') plugin.pro!.signOut();
			const sourceFile = app.vault.getFileByPath('Chapter Batch Export/Scenes/Introduction.md')!;
			const source = await app.vault.read(sourceFile);
			let error = '';
			try {
				if (kind === 'stale') await app.vault.modify(sourceFile, source + '\nChanged after preview.');
				try { await plugin.exportPreview(preview); } catch (e) { error = String(e); }
			} finally { if (kind === 'stale') await app.vault.modify(sourceFile, source); }
			return { failure: error, created: !!app.vault.getAbstractFileByPath(folder), names: preview.plan.missing, content: kind === 'existing' ? await app.vault.read(app.vault.getFileByPath(folder + '/Keep.md')!) : '', source, index: '', disabled: modal.contentEl.querySelector<HTMLButtonElement>('.cbe-export')!.disabled, rows: preview.plan.chapters.length, status: 'checked', preset: false };
		} finally { if (kind !== 'ui') modal.close(); }
	}, kind);
}

describe('Chapter export in a real vault', function () {
	afterEach(async () => {
		await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, ChapterBatchExportPlugin> } }).plugins.plugins['chapter-batch-export']!;
			plugin.pro!.signOut();
			document.querySelectorAll<HTMLButtonElement>('.modal-close-button').forEach((button) => button.click());
			for (const name of ['ui', 'missing', 'existing', 'stale', 'pro', 'expired']) {
				const folder = app.vault.getAbstractFileByPath('E2E ' + name); if (folder) await app.vault.delete(folder, true);
			}
		});
	});
	it('previews and saves the full manuscript with the free UI', async () => {
		const preview = await runCase('ui'); expect(preview.rows).toBe(3); expect(preview.disabled).toBe(false);
		expect(preview.names).toEqual(['01 Introduction.md', '02 Method.md', '03 Findings.md']); expect(preview.content).toContain('Research question.md');
		await browser.executeObsidian(() => document.querySelector<HTMLButtonElement>('.chapter-batch-export-modal .cbe-export')!.click());
		await browser.waitUntil(async () => ['saved', 'error'].includes(await browser.$('.chapter-batch-export-modal .cbe-message').getAttribute('data-status') ?? ''), { timeout: 20000, timeoutMsg: 'The export did not reach its saved state.' });
		expect(await browser.$('.chapter-batch-export-modal .cbe-message').getText()).toContain('Saved 3 chapters');
		const result = await browser.executeObsidian(async ({ app }) => ({
			chapter: await app.vault.read(app.vault.getFileByPath('E2E ui/01 Introduction.md')!),
			index: await app.vault.read(app.vault.getFileByPath('E2E ui/_index.md')!),
			source: await app.vault.read(app.vault.getFileByPath('Chapter Batch Export/Scenes/Introduction.md')!),
			files: ['01 Introduction.md', '02 Method.md', '03 Findings.md'].map((name) => !!app.vault.getFileByPath('E2E ui/' + name)),
		}));
		expect(result.files).toEqual([true, true, true]); expect(result.chapter).not.toContain('type: chapter'); expect(result.source).toContain('type: chapter');
		expect(result.chapter.indexOf('The river')).toBeLessThan(result.chapter.indexOf('## Research question'));
		expect(result.chapter.indexOf('## Research question')).toBeLessThan(result.chapter.indexOf('## Study scope'));
		expect(result.chapter).toContain('\n---\n'); expect(result.index).toContain('[[E2E ui/02 Method.md]]'); expect(result.index).toContain('[[Chapter Batch Export/Scenes/Field work.md]]');
	});
	it('shows missing paths and blocks the save action', async () => {
		const result = await runCase('missing'); expect(result.names).toContain('Chapter Batch Export/Scenes/Missing interview.md'); expect(result.disabled).toBe(true); expect(result.failure).toContain('missing scene'); expect(result.created).toBe(false);
	});
	it('refuses an existing destination and keeps its note', async () => {
		const result = await runCase('existing'); expect(result.failure).toContain('folder exists'); expect(result.content).toBe('Keep this text.');
	});
	it('requires a new preview after a source edit', async () => {
		const result = await runCase('stale'); expect(result.failure).toContain('Make a new preview'); expect(result.created).toBe(false);
	});
	it('loads a named preset and exports a Pro chapter range with custom formats', async () => {
		const result = await runCase('pro'); expect(result.preset).toBe(true); expect(result.names).toEqual(['chapter-02.md']); expect(result.content).toContain('## 02 Method'); expect(result.content).toContain('## Field work');
	});
	it('blocks the write if Pro is lost after preview', async () => {
		const result = await runCase('expired'); expect(result.failure).toContain('Make a new preview'); expect(result.created).toBe(false);
	});
});
