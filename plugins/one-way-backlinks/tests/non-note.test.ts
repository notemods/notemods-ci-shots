import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { OneWayBacklinksView } from '../src/view';
import { DEFAULT_SETTINGS } from '../src/settings';
import { bindPro, resetPro } from '../src/pro';

// The review blocker of 1 Nov: the pane followed any active file, and Link back wrote "- [[note]]" into an image, a PDF
// or a canvas. These tests use a view without a leaf: only the fields that refreshLists, drawLists and linkBack read.
function setup(active: string) {
	const app = App.createConfigured__({ files: { 'Note.md': '![[Pic.png]] [[Board.canvas]]', 'Pic.png': 'PNGDATA', 'Board.canvas': '{"nodes":[]}' } });
	const resolved = { 'Note.md': { 'Pic.png': 1, 'Board.canvas': 1 } };
	Object.defineProperty(app.metadataCache, 'resolvedLinks', { value: resolved, configurable: true });
	const file = app.vault.getFileByPath(active);
	vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue(file);
	vi.spyOn(app.workspace, 'getLeavesOfType').mockReturnValue([]);
	const process = vi.spyOn(app.vault, 'process');
	const view = Object.create(OneWayBacklinksView.prototype) as OneWayBacklinksView & Record<string, unknown>;
	Object.assign(view, {
		app,
		plugin: { settings: { ...DEFAULT_SETTINGS } },
		listMode: 'one-way',
		notePath: null,
		lists: { oneWay: [], paired: [] },
		drawnKey: '',
		linkedBack: new Set<string>(),
		scheduleUpdate: { cancel: () => undefined },
		computes: 0,
		draws: 0,
		lastComputeMs: 0,
		contentEl: activeDocument.createElement('div'),
	});
	return { view, process };
}

describe('a current file that is not a Markdown note', () => {
	afterEach(() => {
		resetPro();
		vi.restoreAllMocks();
	});

	for (const active of ['Pic.png', 'Board.canvas']) {
		it(`${active}: the pane shows no rows and no Link back button`, () => {
			const { view } = setup(active);
			view.refreshLists();
			expect(view.contentEl.querySelectorAll('.owb-row').length).toBe(0);
			expect(view.contentEl.querySelectorAll('.owb-link-back').length).toBe(0);
			expect(view.contentEl.querySelector('.owb-empty')?.textContent).toContain('Markdown notes');
		});

		it(`${active}: Link back with Pro does not write to the file`, async () => {
			bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
			const { view, process } = setup(active);
			await view.linkBack(active, 'Note.md');
			expect(process).not.toHaveBeenCalled();
		});
	}

	it('a Markdown note still gets its rows', () => {
		const { view } = setup('Note.md');
		Object.defineProperty(view.app.metadataCache, 'resolvedLinks', { value: { 'Note.md': {}, 'Other.md': { 'Note.md': 1 } }, configurable: true });
		view.refreshLists();
		expect(view.contentEl.querySelectorAll('.owb-row').length).toBe(1);
	});
});
