import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import type PocketMarkwhenPlugin from '../src/main';
import { TimelinePanel } from '../src/panel';
import { bindPro, resetPro } from '../src/pro';

// A free user opens the Pro section of the timeline and sees "Combine files (Pro)" and "Export Markdown list (Pro)".
// A click shows the shared Pro notice with the "Sponsor on GitHub" button. No file is read or written and no setting
// is saved. A Pro user's export writes the list.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';
const COMBINE = 'Combine files (Pro)';
const EXPORT = 'Export Markdown list (Pro)';

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'pocket-markwhen' },
	} as unknown as SponsorsManager;
}

const panels: TimelinePanel[] = [];
function setup(pro: boolean) {
	bindPro(fakePro(pro));
	const source = '2026-03-01: A\n2026-03-02: Rome #italy';
	const app = App.createConfigured__({ files: { 'trip.mw': source, 'extra.mw': '2026-03-03: Venice' } });
	const plugin = { app, settings: { savedFilters: [] }, saveSettings: vi.fn(async () => {}) } as unknown as PocketMarkwhenPlugin;
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
	});
	const read = vi.spyOn(app.vault, 'read'); const create = vi.spyOn(app.vault, 'create');
	const el = document.body.createDiv();
	const p = new TimelinePanel(el, plugin, [{ source, path: 'trip.mw' }]); panels.push(p); p.load();
	return { p, el, plugin, shown, read, create };
}

function button(el: HTMLElement, label: string): HTMLButtonElement | undefined {
	return [...el.querySelectorAll<HTMLButtonElement>('.pocket-markwhen-pro button')].find((b) => b.textContent === label);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Pro section of the timeline for a free user and a Pro user', () => {
	afterEach(() => { for (const p of panels.splice(0)) p.unload(); resetPro(); vi.restoreAllMocks(); document.body.empty(); });

	it('a free user who selects Combine files or Export Markdown list gets the Pro notice with a Sponsor button, and nothing runs', async () => {
		const { el, plugin, shown, read, create } = setup(false);
		expect(button(el, COMBINE), 'The free Pro section shows Combine files (Pro).').toBeDefined();
		expect(button(el, EXPORT), 'The free Pro section shows Export Markdown list (Pro).').toBeDefined();
		button(el, COMBINE)!.click(); await flush();
		button(el, EXPORT)!.click(); await flush();
		expect(shown).toEqual([
			{ text: `Combined files need Pro. ${PITCH}Sponsor on GitHub`, buttons: 1 },
			{ text: `The Markdown list export needs Pro. ${PITCH}Sponsor on GitHub`, buttons: 1 },
		]);
		expect(read).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
		expect(plugin.saveSettings).not.toHaveBeenCalled();
		expect(el.querySelectorAll('.pocket-markwhen-event')).toHaveLength(2);
		// The free section has no file list, no filter name input and no saved filter list.
		expect(el.querySelector('.pocket-markwhen-pro select, .pocket-markwhen-pro input')).toBeNull();
	});

	it('a Pro user who selects Export Markdown list writes the list', async () => {
		const { el, shown, create } = setup(true);
		button(el, EXPORT)!.click();
		await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
		expect(String(create.mock.calls[0]![1])).toContain('Rome');
		expect(shown.some((n) => n.buttons > 0)).toBe(false);
	});
});
