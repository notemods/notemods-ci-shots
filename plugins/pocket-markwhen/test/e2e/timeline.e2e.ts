import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import type PocketMarkwhenPlugin from '../../src/main';
import type { PocketMarkwhenView } from '../../src/view';
import type { TimelinePanel } from '../../src/panel';
const sample = '---\ntitle: Trip\n---\n2026-03-01: Fly out\n2026-03-02 / 2026-03-05: Rome #italy\n\n# Later\n2026-04: Return\n2027: Year event';
async function open(source = sample): Promise<void> {
	await browser.executeObsidian(async ({ app }, text) => {
		await app.workspace.getMostRecentLeaf()!.setViewState({ type: 'empty', active: true });
		const file = app.vault.getFileByPath('trip.mw');
		if (file) await app.vault.modify(file, text); else await app.vault.create('trip.mw', text);
		const p = (app as unknown as { plugins: { plugins: Record<string, PocketMarkwhenPlugin> } }).plugins.plugins['pocket-markwhen']!;
		p.pro!.signOut(); await p.openTimeline(app.vault.getFileByPath('trip.mw')!);
	}, source);
	await browser.waitUntil(async () => await browser.executeObsidian(({ app }, expected) => { const view = app.workspace.getMostRecentLeaf()!.view as PocketMarkwhenView; return view.getViewType() === 'pocket-markwhen-timeline' && view.getViewData() === expected; }, source), { timeout: 10000 });
	await browser.executeObsidian(({ app }) => (app.workspace.getMostRecentLeaf()!.view as PocketMarkwhenView).showTab(false));
}
async function texts(): Promise<string[]> {
	return browser.executeObsidian(({ app }) => { const el = app.workspace.getMostRecentLeaf()!.view.containerEl; const root = el.querySelector('.markdown-preview-view') ?? el; return Array.from(root.querySelectorAll('.pocket-markwhen-text')).map((e) => e.textContent ?? ''); });
}
describe('Pocket Markwhen timelines', () => {
	it('shows the title, range, tags and heading group', async () => {
		await open(); expect(await texts()).toEqual(['Fly out', 'Rome', 'Return', 'Year event']);
		const r = await browser.executeObsidian(({ app }) => {
			const el = app.workspace.getMostRecentLeaf()!.view.containerEl;
			return { title: el.querySelector('.pocket-markwhen-title')?.textContent, dates: Array.from(el.querySelectorAll('time')).map((e) => e.textContent), tag: el.querySelector('.pocket-markwhen-tag')?.textContent, group: el.querySelector('.pocket-markwhen-group summary')?.textContent };
		});
		expect(r).toEqual({ title: 'Trip', dates: ['2026-03-01', '2026-03-02 to 2026-03-05', '2026-04-01 to 2026-04-30', '2027-01-01 to 2027-12-31'], tag: 'italy', group: 'Later' });
	});
	it('edits source, redraws and saves through requestSave', async () => {
		await open();
		await browser.executeObsidian(({ app }) => {
			const view = app.workspace.getMostRecentLeaf()!.view as PocketMarkwhenView; view.showTab(true);
			const input = view.containerEl.querySelector<HTMLTextAreaElement>('textarea')!;
			input.value += '\n2026-05-01: New'; input.dispatchEvent(new Event('input', { bubbles: true })); view.showTab(false);
		});
		expect(await texts()).toContain('New');
		await browser.waitUntil(async () => await browser.executeObsidian(async ({ app }) => (await app.vault.read(app.vault.getFileByPath('trip.mw')!)) === '---\ntitle: Trip\n---\n2026-03-01: Fly out\n2026-03-02 / 2026-03-05: Rome #italy\n\n# Later\n2026-04: Return\n2027: Year event\n2026-05-01: New'), { timeout: 15000, interval: 100 });
	});
	it('filters dates by overlap', async () => {
		await open(); await browser.executeObsidian(({ app }) => {
			const root = app.workspace.getMostRecentLeaf()!.view.containerEl;
			const from = root.querySelector<HTMLInputElement>('input[aria-label="From"]')!; const to = root.querySelector<HTMLInputElement>('input[aria-label="To"]')!;
			from.value = '2026-03-02'; to.value = '2026-03-31'; from.dispatchEvent(new Event('change'));
		});
		expect(await texts()).toEqual(['Rome']);
	});
	it('Today opens a group and focuses the next event', async () => {
		await open(); const r = await browser.executeObsidian(({ app }) => {
			const view = app.workspace.getMostRecentLeaf()!.view as unknown as { panel: TimelinePanel; containerEl: HTMLElement };
			const group = view.containerEl.querySelector<HTMLDetailsElement>('.pocket-markwhen-group')!; group.open = false;
			return { ok: view.panel.goToday('2026-10-12'), open: group.open, text: view.containerEl.querySelector('.pocket-markwhen-today .pocket-markwhen-text')?.textContent, focused: document.activeElement?.classList.contains('pocket-markwhen-today') };
		});
		expect(r).toEqual({ ok: true, open: true, text: 'Year event', focused: true });
	});
	it('renders an mw code block', async () => {
		await obsidianPage.write('Embedded.md', '# Plan\n\n```mw\n2026-03-01: Fly out\n2026-03-02 / 2026-03-05: Rome #italy\n```');
		await obsidianPage.openFile('Embedded.md'); await browser.executeObsidian(async ({ app }) => { await app.workspace.getMostRecentLeaf()!.setViewState({ type: 'markdown', state: { file: 'Embedded.md', mode: 'preview' }, active: true }); });
		await browser.waitUntil(async () => (await texts()).length === 2, { timeout: 10000 }); expect(await texts()).toEqual(['Fly out', 'Rome']);
	});
	it('shows empty and undated text without errors', async () => {
		await open('hello\nworld'); expect(await browser.executeObsidian(({ app }) => app.workspace.getMostRecentLeaf()!.view.containerEl.querySelector('.pocket-markwhen-status')?.textContent)).toBe('No dated events');
		await open(''); expect(await texts()).toEqual([]);
	});
	it('blocks the three Pro actions when signed out', async () => {
		await open(); const r = await browser.executeObsidian(async ({ app }) => {
			const panel = (app.workspace.getMostRecentLeaf()!.view as unknown as { panel: TimelinePanel }).panel;
			return [await panel.combine(['extra.mw']), await panel.saveFilter('Trip'), await panel.exportMarkdown()];
		}); expect(r).toEqual([false, false, null]);
	});
	it('combines, saves and exports with a local Sponsors answer', async () => {
		await obsidianPage.write('extra.mw', '2026-03-04: Venice #italy'); await open();
		const r = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, PocketMarkwhenPlugin> } }).plugins.plugins['pocket-markwhen']!;
			p.pro!.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret('pocket-markwhen-github-token', 'gho_' + '0'.repeat(36));
			try {
				await p.pro!.refreshNow(); const view = app.workspace.getMostRecentLeaf()!.view as unknown as { panel: TimelinePanel; containerEl: HTMLElement };
				const combined = await view.panel.combine(['extra.mw']); view.panel.applyFilter({ from: '2026-03-02', to: '2026-03-31', tag: 'italy' });
				const saved = await view.panel.saveFilter('Italy');
				view.panel.applyFilter({ from: '', to: '', tag: '' });
				const savedMenu = view.containerEl.querySelector<HTMLSelectElement>('select[aria-label="Saved filter"]')!; savedMenu.value = 'Italy'; savedMenu.dispatchEvent(new Event('change'));
				const path = await view.panel.exportMarkdown(); const text = await app.vault.read(app.vault.getFileByPath(path!)!);
				const visible = Array.from(view.containerEl.querySelectorAll('.pocket-markwhen-text')).map((e) => e.textContent);
				p.pro!.signOut(); return { combined, saved, visible, text, filter: p.settings.savedFilters.find((f) => f.name === 'Italy'), after: Array.from(view.containerEl.querySelectorAll('.pocket-markwhen-text')).map((e) => e.textContent) };
			} finally { p.pro!.signOut(); }
		});
		expect(r.combined).toBe(true); expect(r.saved).toBe(true); expect(r.visible).toEqual(['Rome', 'Venice']); expect(r.after).toEqual(['Rome']);
		expect(r.filter).toEqual({ name: 'Italy', from: '2026-03-02', to: '2026-03-31', tag: 'italy' });
		expect(r.text).toContain('- 2026-03-02 to 2026-03-05: Rome #italy (trip.mw)'); expect(r.text).toContain('- 2026-03-04: Venice #italy (extra.mw)');
	});
	it('shows the source on the current desktop or mobile capability', async () => {
		const mobile = await browser.executeObsidian(({ obsidian }) => obsidian.Platform.isMobile);
		await open(); expect(await texts()).toContain('Rome');
		const r = await browser.executeObsidian(({ app }) => {
			const view = app.workspace.getMostRecentLeaf()!.view as PocketMarkwhenView; view.showTab(true);
			const editor = view.containerEl.querySelector<HTMLTextAreaElement>('textarea')!;
			return { visible: !editor.hidden, source: editor.value, mobile: view.contentEl.classList.contains('pocket-markwhen-mobile'), overflow: view.contentEl.scrollWidth > view.contentEl.clientWidth };
		}); expect(r.visible).toBe(true); expect(r.source).toContain('Rome'); expect(r.mobile).toBe(mobile); expect(r.overflow).toBe(false);
	});
	it('handles an existing mw registration and keeps manual open', async () => {
		await open();
		try {
			const state = await browser.executeObsidian(async ({ app }) => {
				const plugins = (app as unknown as { plugins: { disablePlugin(id: string): Promise<void>; enablePlugin(id: string): Promise<boolean> } }).plugins;
				const registry = (app as unknown as { viewRegistry: { registerExtensions(extensions: string[], type: string): void } }).viewRegistry;
				await plugins.disablePlugin('pocket-markwhen'); registry.registerExtensions(['mw'], 'markdown');
				const enabled = await plugins.enablePlugin('pocket-markwhen');
				const notices = Array.from(document.querySelectorAll('.notice')).filter((e) => e.textContent?.includes('Another view has registered')).length;
				await app.workspace.getMostRecentLeaf()!.setViewState({ type: 'markdown', state: { file: 'trip.mw', mode: 'source' }, active: true });
				return { enabled, notices };
			});
			expect(state).toEqual({ enabled: true, notices: 1 });
			await browser.waitUntil(async () => await browser.executeObsidian(({ app }) => app.workspace.getMostRecentLeaf()!.view.getViewType() === 'markdown' && app.workspace.getActiveFile()?.path === 'trip.mw'), { timeout: 10000 });
			await browser.executeObsidianCommand('pocket-markwhen:open-timeline');
			await browser.waitUntil(async () => await browser.executeObsidian(({ app }) => app.workspace.getMostRecentLeaf()!.view.getViewType() === 'pocket-markwhen-timeline') && (await texts()).includes('Rome'), { timeout: 10000 });
			await obsidianPage.openFile('Embedded.md'); await browser.executeObsidian(async ({ app }) => { await app.workspace.getMostRecentLeaf()!.setViewState({ type: 'markdown', state: { file: 'Embedded.md', mode: 'preview' }, active: true }); });
			await browser.waitUntil(async () => (await texts()).length === 2, { timeout: 10000 });
		} finally {
			await browser.executeObsidian(({ app }) => {
				const registry = (app as unknown as { viewRegistry: { registerExtensions(extensions: string[], type: string): void; unregisterExtensions(extensions: string[]): void } }).viewRegistry;
				registry.unregisterExtensions(['mw']); registry.registerExtensions(['mw'], 'pocket-markwhen-timeline');
			});
		}
	});
});
