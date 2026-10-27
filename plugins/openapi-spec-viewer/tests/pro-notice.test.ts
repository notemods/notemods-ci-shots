import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import LocalApiPlugin from '../src/main';
import { bindPro, resetPro } from '../src/pro';
import { ReferenceView } from '../src/view';
import manifest from '../manifest.json';

// A free user sees "Write endpoint note (Pro)" and "Bookmark endpoint (Pro)" in the endpoint detail. A click shows
// the shared Pro notice with the "Sponsor on GitHub" button. No note is written and no bookmark is saved.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';
const NOTE = 'Write endpoint note (Pro)';
const MARK = 'Bookmark endpoint (Pro)';
const source = JSON.stringify({ openapi: '3.0.3', paths: { '/pets': { get: { tags: ['Pets'], summary: 'List pets', responses: { '200': { description: 'OK' } } } } } });

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'openapi-spec-viewer' },
	} as unknown as SponsorsManager;
}

async function setup(pro: boolean) {
	const app = App.createConfigured__({ files: { 'api.json': source } });
	const p = new LocalApiPlugin(app as never, manifest as never);
	bindPro(fakePro(pro));
	const save = vi.spyOn(p, 'saveData').mockResolvedValue();
	const create = vi.spyOn(app.vault, 'create');
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
	});
	const v = new ReferenceView(app.workspace.getLeaf('tab'), p); v.path = 'api.json'; await v.reload();
	return { p, v, save, create, shown };
}

function button(v: ReferenceView, label: string): HTMLButtonElement | undefined {
	return [...v.contentEl.querySelectorAll<HTMLButtonElement>('.lar-detail button')].find((b) => b.textContent === label);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Endpoint note and bookmark buttons for a free user and a Pro user', () => {
	afterEach(() => { resetPro(); vi.restoreAllMocks(); });

	it('a free user who selects Write endpoint note or Bookmark endpoint gets the Pro notice with a Sponsor button, and nothing is saved', async () => {
		const { p, v, save, create, shown } = await setup(false);
		expect(button(v, NOTE), 'The free endpoint detail shows Write endpoint note (Pro).').toBeDefined();
		expect(button(v, MARK), 'The free endpoint detail shows Bookmark endpoint (Pro).').toBeDefined();
		button(v, NOTE)!.click(); await flush();
		button(v, MARK)!.click(); await flush();
		expect(shown).toEqual([
			{ text: `Endpoint notes need Pro. ${PITCH}Sponsor on GitHub`, buttons: 1 },
			{ text: `Endpoint bookmarks need Pro. ${PITCH}Sponsor on GitHub`, buttons: 1 },
		]);
		expect(create).not.toHaveBeenCalled();
		expect(save).not.toHaveBeenCalled();
		expect(p.settings.bookmarks).toEqual([]);
		// The button shows the true state: the endpoint is not bookmarked.
		expect(button(v, MARK)).toBeDefined();
		// Saved filters and the bookmark list stay hidden for a free user.
		expect(v.contentEl.querySelector('input[aria-label="Filter name"]')).toBeNull();
	});

	it('a Pro user who selects Write endpoint note and Bookmark endpoint writes the note and saves the bookmark', async () => {
		const { p, v, save, create, shown } = await setup(true);
		button(v, NOTE)!.click();
		await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
		button(v, MARK)!.click();
		await vi.waitFor(() => expect(p.settings.bookmarks).toHaveLength(1));
		expect(save).toHaveBeenCalledTimes(1);
		expect(button(v, 'Remove bookmark (Pro)')).toBeDefined();
		expect(shown.some((n) => n.buttons > 0)).toBe(false);
	});
});
