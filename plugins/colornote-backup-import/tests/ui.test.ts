import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { ImportModal, CompareModal } from '../src/ui';
import Plugin from '../src/main';
import { resetPro } from '../src/pro';
import manifest from '../manifest.json';
import { fixture } from './fixture';
afterEach(resetPro);
function setup() { const app = App.createConfigured__({ files: {} }); const p = new Plugin(app as never, manifest as never); return { p, app }; }
describe('modal privacy and validation', () => {
	it('clears a retained password input on close', () => {
		const { p } = setup(); const modal = new ImportModal(p); modal.onOpen();
		const password = modal.contentEl.querySelector<HTMLInputElement>('input[type=password]')!; password.value = 'secret'; password.dispatchEvent(new Event('input'));
		modal.onClose(); expect(password.value).toBe(''); expect(modal.contentEl.textContent).toBe(''); expect(JSON.stringify(p.settings)).not.toContain('secret');
	});
	it('clears both comparison passwords on close', () => {
		const { p } = setup(); const modal = new CompareModal(p); modal.onOpen(); const inputs = [...modal.contentEl.querySelectorAll<HTMLInputElement>('input[type=password]')];
		for (const input of inputs) input.value = 'secret'; modal.onClose(); expect(inputs.map((i) => i.value)).toEqual(['', '']);
	});
	it('does not write when Import notes is clicked without a decoded preview', async () => {
		const { p } = setup(); const modal = new ImportModal(p); modal.onOpen(); const run = vi.spyOn(p, 'importBackup');
		[...modal.contentEl.querySelectorAll('button')].find((b) => b.textContent === 'Import notes')!.click(); await Promise.resolve(); expect(run).not.toHaveBeenCalled(); expect(modal.contentEl.textContent).toContain('Decode and review the backup first.'); modal.onClose();
	});
	it('discards a decoded result if the modal closes during the file read', async () => {
		const { p } = setup(); const modal = new ImportModal(p); modal.onOpen();
		const input = modal.contentEl.querySelector<HTMLInputElement>('input[type=file]')!;
		let resolve!: (value: ArrayBuffer) => void;
		const file = new File(['dummy'], 'sample.backup'); vi.spyOn(file, 'arrayBuffer').mockImplementation(() => new Promise((r) => { resolve = r; }));
		Object.defineProperty(input, 'files', { value: [file] }); input.dispatchEvent(new Event('change'));
		[...modal.contentEl.querySelectorAll('button')].find((b) => b.textContent === 'Decode and review')!.click(); modal.onClose(); resolve(fixture().buffer as ArrayBuffer); await Promise.resolve(); await Promise.resolve(); expect(modal.contentEl.textContent).toBe('');
	});
});
