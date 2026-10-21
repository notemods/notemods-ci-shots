import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import SceneNotesToFountainPlugin from '../src/main';
import { ExportModal } from '../src/modal';
import { resetPro } from '../src/pro';
import manifest from '../manifest.json';

afterEach(() => resetPro());

async function setup() {
	const app = App.createConfigured__({ files: { 'S/A.md': 'One.\n', 'S/B.md': 'Two.\n', 'S/C.md': 'Three.\n' } });
	const plugin = new SceneNotesToFountainPlugin(app as never, manifest as never);
	await plugin.loadSettings();
	const modal = new ExportModal(plugin, 'S');
	modal.open();
	return { plugin, modal };
}

describe('export window', () => {
	it('discards a preview if the selection changes during the read', async () => {
		const { plugin, modal } = await setup();
		const plan = await plugin.makePlan(modal.selectedPaths());
		let finish!: (value: typeof plan) => void;
		vi.spyOn(plugin, 'makePlan').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
		const reading = modal.preview();
		modal.toggle('S/B.md', false);
		finish(plan);
		await reading;
		expect(modal.current).toBeNull();
		expect(await modal.save()).toBeNull();
		expect(plugin.app.vault.getFiles().filter((f) => f.extension === 'fountain')).toEqual([]);
	});

	it('keeps the newest preview when reads finish in reverse order', async () => {
		const { plugin, modal } = await setup();
		const older = await plugin.makePlan(modal.selectedPaths());
		let finish!: (value: typeof older) => void;
		vi.spyOn(plugin, 'makePlan').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
		const reading = modal.preview();
		modal.moveNote(2, -1);
		await modal.preview();
		finish(older);
		await reading;
		expect(modal.current?.plan.scenes.map((s) => s.path)).toEqual(['S/A.md', 'S/C.md', 'S/B.md']);
	});

	it('does not restore a preview after the window closes', async () => {
		const { plugin, modal } = await setup();
		const plan = await plugin.makePlan(modal.selectedPaths());
		let finish!: (value: typeof plan) => void;
		vi.spyOn(plugin, 'makePlan').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
		const reading = modal.preview();
		modal.close();
		finish(plan);
		await reading;
		expect(modal.current).toBeNull();
		expect(modal.contentEl.childElementCount).toBe(0);
	});

	it('moves C above B, and preview and save keep A, C, B', async () => {
		const { plugin, modal } = await setup();
		expect(modal.selectedPaths()).toEqual(['S/A.md', 'S/B.md', 'S/C.md']);
		modal.moveNote(2, -1);
		expect(modal.selectedPaths()).toEqual(['S/A.md', 'S/C.md', 'S/B.md']);
		await modal.preview();
		expect(modal.current?.plan.text).toBe('.A\n\n= One.\n\n.C\n\n= Three.\n\n.B\n\n= Two.\n');
		expect(modal.contentEl.querySelector('.snf-text')?.textContent).toBe(modal.current?.plan.text);
		expect(await modal.save()).toBe('S/Outline.fountain');
		expect(await plugin.app.vault.read(plugin.app.vault.getFileByPath('S/Outline.fountain')!)).toBe('.A\n\n= One.\n\n.C\n\n= Three.\n\n.B\n\n= Two.\n');
	});

	it('a changed order or selection disables the old plan', async () => {
		const { modal } = await setup();
		await modal.preview();
		expect(modal.current).not.toBeNull();
		modal.toggle('S/B.md', false);
		expect(modal.current).toBeNull();
		expect(await modal.save()).toBeNull();
		await modal.preview();
		expect(modal.current?.plan.text).toBe('.A\n\n= One.\n\n.C\n\n= Three.\n');
	});

	it('cancel after preview creates no file', async () => {
		const { plugin, modal } = await setup();
		await modal.preview();
		modal.close();
		expect(plugin.app.vault.getFiles().filter((f) => f.extension === 'fountain')).toEqual([]);
	});
	it('a failed write keeps the window open with a message and no unhandled error', async () => {
		const { plugin, modal } = await setup();
		await modal.preview();
		vi.spyOn(plugin.app.vault, 'create').mockRejectedValueOnce(new Error('File already exists.'));
		expect(await modal.save()).toBeNull();
		expect(modal.status).toBe('Cannot save the file: File already exists.');
		expect(modal.contentEl.querySelector('.snf-status')?.textContent).toBe(modal.status);
	});

	it('a second Save during a write makes no second file', async () => {
		const { plugin, modal } = await setup();
		await modal.preview();
		const [a, b] = await Promise.all([modal.save(), modal.save()]);
		expect([a, b]).toEqual(['S/Outline.fountain', null]);
		expect(plugin.app.vault.getFiles().filter((f) => f.extension === 'fountain').map((f) => f.path)).toEqual(['S/Outline.fountain']);
	});
	it('opens on the folder of the active note', async () => {
		const { plugin } = await setup();
		vi.spyOn(plugin.app.workspace, 'getActiveFile').mockReturnValue(plugin.app.vault.getFileByPath('S/B.md'));
		const m = plugin.openExport();
		expect(m.folder).toBe('S');
		expect(m.selectedPaths()).toEqual(['S/A.md', 'S/B.md', 'S/C.md']);
		m.close();
	});

	it('an edit of a selected note makes a new preview', async () => {
		const { plugin } = await setup();
		const modal = new ExportModal(plugin, 'S');
		// The mock closes each window after 0 ms. Keep this one open, as in the app.
		vi.spyOn(modal, 'close').mockImplementation(() => undefined);
		modal.open();
		await modal.preview();
		await plugin.app.vault.modify(plugin.app.vault.getFileByPath('S/B.md')!, 'Two changed.\n');
		await vi.waitFor(() => expect(modal.current?.plan.text).toBe('.A\n\n= One.\n\n.B\n\n= Two changed.\n\n.C\n\n= Three.\n'));
	});

	it('Save after a change that the window did not see saves nothing and shows the new preview', async () => {
		const { plugin, modal } = await setup();
		await modal.preview();
		const old = modal.current;
		modal.onClose();
		await plugin.app.vault.modify(plugin.app.vault.getFileByPath('S/A.md')!, 'One changed.\n');
		modal.current = old;
		expect(await modal.save()).toBeNull();
		expect(modal.current?.plan.text).toBe('.A\n\n= One changed.\n\n.B\n\n= Two.\n\n.C\n\n= Three.\n');
		expect(modal.status).toBe('A selected note changed after the preview. Check the new preview, then save again.');
		expect(plugin.app.vault.getFiles().filter((f) => f.extension === 'fountain')).toEqual([]);
	});
});
