import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { ImportModal } from '../src/modal';
import ZohoZnoteImportPlugin from '../src/main';
import { fixture } from './helpers';
import manifest from '../manifest.json';

describe('file selection state', () => {
	it('keeps the later selection when an earlier read completes last', async () => {
		const app = App.createConfigured__({ files: {} }); const plugin = new ZohoZnoteImportPlugin(app as never, manifest as never);
		const modal = new ImportModal(plugin, false); modal.onOpen();
		Object.assign(modal, { selection: document.createRange() });
		let finish!: (value: ArrayBuffer) => void;
		const pending = new Promise<ArrayBuffer>(resolve => { finish = resolve; });
		const first = modal.selectFile({ name: 'first.zip', size: 1, arrayBuffer: () => pending } as File);
		const bytes = fixture([{ title: 'Later' }]);
		await modal.selectFile({ name: 'later.zip', size: bytes.length, arrayBuffer: async () => new Uint8Array(bytes).buffer } as File);
		finish(new Uint8Array(fixture([{ title: 'Earlier' }])).buffer); await first;
		expect(modal.contentEl.querySelector('.zoho-import-status')?.textContent).toContain('later.zip'); modal.onClose();
	});
	it('an import placeholder in source text stays as source text', async () => {
		const { readExport, planImport } = await import('../src/importer');
		const plan = planImport(readExport(fixture([{ html: '<p>ZNPLACEHOLDER0END</p><checkbox checked="true">Task</checkbox>' }])), 'Import');
		expect(plan.notes[0]!.content).toContain('ZNPLACEHOLDER0END'); expect(plan.notes[0]!.content).toContain('- [x] Task');
	});
	it('decoded HTML text in a checkbox cannot become a remote image tag', async () => {
		const { readExport, planImport } = await import('../src/importer');
		const plan = planImport(readExport(fixture([{ html: '<checkbox checked="false">&lt;img src="https://example.invalid/x.png"&gt;</checkbox>' }])), 'Import');
		expect(plan.notes[0]!.content).not.toContain('<img'); expect(plan.notes[0]!.content).not.toContain('\uE000');
	});
});
