import { Notice, Plugin, type Editor } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { bindPro, isPro, resetPro, SPONSORS, proTitle } from './pro';
import { ConverterSettingTab } from './settings';
import { BatchModal, ConversionModal, SchemaModal } from './ui';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class DataFormatConverterPlugin extends Plugin {
	pro: SponsorsManager | null = null;
	readonly modals = new Set<ConversionModal | SchemaModal | BatchModal>();
	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		const tab = new ConverterSettingTab(this.app, this);
		this.register(pro.onChange(() => tab.update()));
		this.addSettingTab(tab);
		this.addCommand({ id: 'convert-selection', name: 'Convert selected data', editorCallback: (editor: Editor) => this.openConversion(editor) });
		this.addCommand({ id: 'validate-schema', name: proTitle('Validate selected JSON against a local schema'), editorCallback: (editor: Editor) => { if (this.requirePro()) new SchemaModal(this, editor).open(); } });
		this.addCommand({ id: 'batch-convert', name: proTitle('Convert chosen code blocks into new files'), editorCallback: (editor: Editor) => { if (this.requirePro()) new BatchModal(this, editor).open(); } });
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	openConversion(editor: Editor): void {
		if (!editor.getSelection().trim()) { new Notice('Select data first. Choose its source format in the preview.'); return; }
		new ConversionModal(this, editor).open();
	}
	requirePro(): boolean {
		if (isPro()) return true;
		new Notice('Pro is required for this feature. Sponsor on GitHub, then sign in from the plugin settings.');
		return false;
	}
	onunload(): void {
		for (const modal of this.modals) modal.close();
		resetPro();
	}
}
