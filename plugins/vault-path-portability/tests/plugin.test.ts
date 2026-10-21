import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import VaultPathPortabilityPlugin, { RenameReviewModal } from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

describe('vault integration', () => {
	let app: ReturnType<typeof App.createConfigured__>;
	let plugin: VaultPathPortabilityPlugin;
	beforeEach(() => { app = App.createConfigured__({ files: { 'CON.md': '[[Other]]', 'Other.md': 'hello' } }); plugin = new VaultPathPortabilityPlugin(app as never, manifest as never); });
	it('normalizes saved settings', () => { expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS); expect(normalizeSettings({ autoScan: 'true' })).toEqual(DEFAULT_SETTINGS); expect(normalizeSettings({ autoScan: true })).toEqual({ autoScan: true }); });
	it('scans without any writes', () => { const rename = vi.spyOn(app.fileManager, 'renameFile'); const create = vi.spyOn(app.vault, 'create'); expect(plugin.scan()).toContainEqual({ rule: 'reserved-name', paths: ['CON.md'] }); expect(rename).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled(); });
	it('reviewing a suggestion never renames a file', () => {
		const rename = vi.spyOn(app.fileManager, 'renameFile');
		const modal = new RenameReviewModal(plugin, 'CON.md', '_CON.md');
		modal.open();
		expect(modal.contentEl.textContent).toContain('CON.md');
		expect(modal.contentEl.textContent).toContain('_CON.md');
		expect(modal.contentEl.textContent).toContain('Applying a suggestion needs pro');
		expect(rename).not.toHaveBeenCalled();
		modal.close();
	});
	it('requires an explicit click to apply a reviewed Pro suggestion', async () => {
		plugin.pro = { isPro: () => true } as never;
		const rename = vi.spyOn(app.fileManager, 'renameFile').mockResolvedValue();
		const modal = new RenameReviewModal(plugin, 'CON.md', '_CON.md');
		modal.open();
		expect(rename).not.toHaveBeenCalled();
		modal.contentEl.querySelector<HTMLButtonElement>('.mod-cta')!.click();
		await vi.waitFor(() => expect(rename).toHaveBeenCalledOnce());
		expect(rename).toHaveBeenCalledOnce();
		expect(rename.mock.calls[0]?.[1]).toBe('_CON.md');
		modal.close();
	});
	it('refuses a free rename', async () => { const rename = vi.spyOn(app.fileManager, 'renameFile'); await plugin.rename('CON.md', '_CON.md'); expect(rename).not.toHaveBeenCalled(); });
	it('refuses a free export', async () => { const create = vi.spyOn(app.vault, 'create'); await plugin.exportReport(); expect(create).not.toHaveBeenCalled(); });
	it('uses file manager only after explicit rename action', async () => { plugin.pro = { isPro: () => true } as never; const rename = vi.spyOn(app.fileManager, 'renameFile').mockResolvedValue(); await plugin.rename('CON.md', '_CON.md'); expect(rename).toHaveBeenCalledOnce(); expect(rename.mock.calls[0]?.[1]).toBe('_CON.md'); });
	it('refuses a stale target', async () => { plugin.pro = { isPro: () => true } as never; await app.vault.create('_CON.md', 'occupied'); const rename = vi.spyOn(app.fileManager, 'renameFile'); await plugin.rename('CON.md', '_CON.md'); expect(rename).not.toHaveBeenCalled(); });
	it('refuses a missing source', async () => { plugin.pro = { isPro: () => true } as never; const rename = vi.spyOn(app.fileManager, 'renameFile'); await plugin.rename('gone.md', 'new.md'); expect(rename).not.toHaveBeenCalled(); });
	it('handles a rename rejection', async () => { plugin.pro = { isPro: () => true } as never; vi.spyOn(app.fileManager, 'renameFile').mockRejectedValue(new Error('read only')); await expect(plugin.rename('CON.md', '_CON.md')).resolves.toBeUndefined(); });
	it('exports without overwriting an existing report', async () => {
		plugin.pro = { isPro: () => true } as never;
		await app.vault.create('Vault path report.md', 'keep this');
		await plugin.exportReport();
		const old = app.vault.getFileByPath('Vault path report.md')!;
		const report = app.vault.getFileByPath('Vault path report 2.md')!;
		expect(await app.vault.read(old)).toBe('keep this');
		expect(await app.vault.read(report)).toContain('Windows reserved names');
	});
	it('combines events into one read-only scan', async () => {
		vi.useFakeTimers();
		try {
			plugin.pro = { isPro: () => true } as never;
			plugin.settings.autoScan = true;
			const scan = vi.spyOn(plugin, 'scan');
			const rename = vi.spyOn(app.fileManager, 'renameFile');
			const queue = plugin as unknown as { queueScan(): void };
			queue.queueScan(); queue.queueScan(); queue.queueScan();
			await vi.advanceTimersByTimeAsync(301);
			expect(scan).toHaveBeenCalledOnce();
			expect(rename).not.toHaveBeenCalled();
		} finally { plugin.onunload(); vi.useRealTimers(); }
	});
	it('cancels a pending scan on unload', async () => {
		vi.useFakeTimers();
		try {
			plugin.pro = { isPro: () => true } as never;
			plugin.settings.autoScan = true;
			const scan = vi.spyOn(plugin, 'scan');
			(plugin as unknown as { queueScan(): void }).queueScan();
			plugin.onunload();
			await vi.advanceTimersByTimeAsync(1000);
			expect(scan).not.toHaveBeenCalled();
		} finally { vi.useRealTimers(); }
	});
	it('does not schedule events for free users', async () => {
		vi.useFakeTimers();
		try {
			plugin.settings.autoScan = true;
			const scan = vi.spyOn(plugin, 'scan');
			(plugin as unknown as { queueScan(): void }).queueScan();
			await vi.advanceTimersByTimeAsync(1000);
			expect(scan).not.toHaveBeenCalled();
		} finally { vi.useRealTimers(); }
	});

	it('avoids report names that collide only by case', async () => {
		plugin.pro = { isPro: () => true } as never;
		await app.vault.create('vault path report.md', 'keep lowercase');
		await plugin.exportReport();
		expect(app.vault.getFileByPath('Vault path report.md')).toBeNull();
		expect(app.vault.getFileByPath('Vault path report 2.md')).not.toBeNull();
	});

 it('does not detect NFC twins absent from the normalized index', () => {
  vi.spyOn(app.vault, 'getAllLoadedFiles').mockReturnValue([{ path: 'Café.md' }] as never);
  expect(plugin.scan()).toEqual([]);
 });
 it('refuses an unindexed target present on disk', async () => {
  plugin.pro = { isPro: () => true } as never;
  const exists = vi.spyOn(app.vault.adapter, 'exists').mockResolvedValue(true);
  const rename = vi.spyOn(app.fileManager, 'renameFile');
  await plugin.rename('CON.md', '_CON.md');
  expect(exists).toHaveBeenCalledWith('_CON.md'); expect(rename).not.toHaveBeenCalled();
 });
 it('refuses a rename when disk lookup fails', async () => {
  plugin.pro = { isPro: () => true } as never;
  vi.spyOn(app.vault.adapter, 'exists').mockRejectedValue(new Error('unavailable'));
  const rename = vi.spyOn(app.fileManager, 'renameFile');
  await plugin.rename('CON.md', '_CON.md'); expect(rename).not.toHaveBeenCalled();
 });
 it('shows a disabled Pro rename action for free users', () => {
  const modal = new RenameReviewModal(plugin, 'CON.md', '_CON.md'); modal.open();
  expect(modal.contentEl.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true); modal.close();
 });

 it('uses the desktop root when checking indexed path lengths', () => {
  const path = 'a/'.repeat(100) + 'b.md';
  vi.spyOn(app.vault, 'getAllLoadedFiles').mockReturnValue([{ path }] as never);
  vi.spyOn(plugin, 'basePath').mockReturnValue('C:/' + 'v'.repeat(60));
  expect(plugin.scan()).toEqual([{ rule: 'long-path', paths: [path] }]);
 });

});
