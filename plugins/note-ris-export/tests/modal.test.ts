import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import NoteRisExportPlugin from '../src/main';
import { ExportModal } from '../src/modal';
import { resetPro } from '../src/pro';
import manifest from '../manifest.json';

afterEach(() => resetPro());

async function open(files: Record<string, string>, folder: string): Promise<{ app: App; plugin: NoteRisExportPlugin; modal: ExportModal }> {
	const app = App.createConfigured__({ files });
	const plugin = new NoteRisExportPlugin(app as never, manifest as never);
	await plugin.loadSettings();
	plugin.settings.folder = folder;
	const modal = new ExportModal(plugin);
	modal.open();
	return { app, plugin, modal };
}

describe('export window', () => {
	it('lists each error and keeps Export off', async () => {
		const { modal } = await open({ 'Refs/a.md': '---\ntype: WEB\ntitle: T\n---\n', 'Refs/b.md': '---\ntype: JOUR\ntitle: T\nauthors: Lee\n---\n' }, 'Refs');
		const items = [...modal.contentEl.querySelectorAll('.nre-problems li')].map((li) => li.textContent);
		expect(items).toEqual(['Refs/a.md: unsupported type "WEB"; use JOUR, BOOK or CONF', 'Refs/b.md: unsupported authors "Lee"; write a list (property "authors")']);
		expect(modal.contentEl.querySelector<HTMLButtonElement>('[data-action="export"]')!.disabled).toBe(true);
		modal.close();
	});

	it('turns Export on for clean data and saves the file', async () => {
		const { app, modal } = await open({ 'Refs/a.md': '---\ntype: BOOK\ntitle: T\n---\n' }, 'Refs');
		expect(modal.contentEl.querySelector('.nre-ready')!.textContent).toBe('Ready: 1 record with no errors.');
		expect(modal.contentEl.querySelector<HTMLButtonElement>('[data-action="export"]')!.disabled).toBe(false);
		expect(await modal.runExport()).toBe('References.ris');
		expect(app.vault.getAbstractFileByPath('References.ris')).not.toBeNull();
		expect(modal.contentEl.querySelector('.nre-saved')!.textContent).toBe('Saved References.ris');
		modal.close();
	});

	it('shows the empty folder state', async () => {
		const { modal } = await open({ 'Refs/a.md': '---\ntype: BOOK\ntitle: T\n---\n' }, 'Refs/2027');
		expect(modal.contentEl.querySelector('.nre-state')!.textContent).toBe('Folder Refs/2027 does not exist.');
		modal.close();
	});
	it('runs the preview when the cache is resolved and stops after close', async () => {
		const app = App.createConfigured__({ files: { 'Refs/a.md': '---\ntype: BOOK\ntitle: T\n---\n' } });
		const plugin = new NoteRisExportPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		plugin.settings.folder = 'Refs';
		const cache = vi.spyOn(app.metadataCache, 'getFileCache').mockReturnValue(null);
		const modal = new ExportModal(plugin);
		modal.open();
		expect(modal.last?.state).toBe('not-ready');
		expect(modal.contentEl.querySelector<HTMLButtonElement>('[data-action="export"]')!.disabled).toBe(true);
		cache.mockRestore();
		app.metadataCache.trigger('resolved');
		expect(modal.last?.state).toBe('ok');
		expect(modal.contentEl.querySelector('.nre-ready')!.textContent).toBe('Ready: 1 record with no errors.');
		modal.close();
		const preview = vi.spyOn(plugin, 'preview');
		app.metadataCache.trigger('resolved');
		expect(preview).not.toHaveBeenCalled();
	});

});
