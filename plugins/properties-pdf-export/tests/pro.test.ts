import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { SponsorsManager, emptySponsorsState } from '../src/license/index';
import { SPONSORS, bindPro } from '../src/pro';
import PropertiesPdfExportPlugin from '../src/main';
import manifest from '../manifest.json';

afterEach(() => bindPro(null));
function cachedPro() {
	const now = Date.now();
	let token: string | null = 'gho_' + 'a'.repeat(36);
	const http = vi.fn(async () => { throw new Error('No network expected'); });
	const pro = new SponsorsManager({
		config: SPONSORS, http, now: () => now,
		tokens: { get: () => token, set: v => { token = v; }, clear: () => { token = null; } },
		store: { load: () => ({ ...emptySponsorsState(), status: 'pro', login: 'test-sponsor', tierName: 'Test', usd: 15, oneTime: true, lastValidAt: now, lastAnswerAt: now, lastAttemptAt: now }), save: () => {} },
	});
	pro.init();
	return { pro, http };
}
function renderWithRules() {
	const plugin = new PropertiesPdfExportPlugin(App.createConfigured__({files:{'Reports/a.md':'# A'}}) as never, manifest as never);
	plugin.settings.folderLayouts = 'Reports = compact';
	const el = document.createElement('div');
	const ctx = {docId:'one', sourcePath:'Reports/a.md', frontmatter:{author:'Ada'}, getSectionInfo:()=>({lineStart:0,lineEnd:3,text:''}), addChild:()=>{}};
	return {plugin, el, ctx};
}
describe('shared Sponsors integration', () => {
	it('uses cached Pro for folder layouts without a network call', async () => {
		const {pro,http}=cachedPro(); bindPro(pro);
		const {plugin,el,ctx}=renderWithRules(); await plugin.process(el,ctx);
		expect(el.querySelector('.ppe-compact')?.textContent).toContain('Ada');
		expect(http).not.toHaveBeenCalled();
	});
	it('keeps the free header and global layout after sign out', async () => {
		const {pro}=cachedPro(); bindPro(pro);
		const {plugin,el,ctx}=renderWithRules(); await plugin.process(el,ctx);
		pro.signOut(); await plugin.process(el,ctx);
		expect(el.querySelectorAll('.ppe-header')).toHaveLength(1);
		expect(el.querySelector('.ppe-table')?.textContent).toContain('Ada');
	});
	it('does not refresh a recent successful cache', async () => {
		const {pro,http}=cachedPro(); await pro.refresh();
		expect(pro.isPro()).toBe(true); expect(http).not.toHaveBeenCalled();
	});
});
