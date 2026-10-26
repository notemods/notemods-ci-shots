import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

interface AdocView {
	data: string;
	previewEl: HTMLElement;
	setMode(mode: string): void;
	setViewData(data: string, clear: boolean): void;
	render(): Promise<void>;
}

async function diagramCount(): Promise<number> {
	return browser.execute(() => document.querySelectorAll('.workspace-leaf.mod-active .adoc-mermaid svg[aria-roledescription]').length);
}

describe('free Mermaid preview', () => {
	afterEach(async function () {
		if (this.currentTest?.state === 'failed') {
			const html = await browser.execute(() => document.querySelector('.workspace-leaf.mod-active .adoc-preview')?.innerHTML.slice(0, 3500) ?? 'no preview');
			console.log('Mermaid preview on failure', html);
		}
	});
	it('renders diagram and source block forms without Pro', async () => {
		await browser.executeObsidian(({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: { signOut(): void } }> } }).plugins.plugins[id]!;
			p.pro.signOut();
		}, pluginId);
		await obsidianPage.openFile('AsciiDoc Files/Diagrams.adoc');
		await browser.waitUntil(async () => browser.execute(() => {
			const diagrams = Array.from(document.querySelectorAll('.workspace-leaf.mod-active .adoc-mermaid'));
			return diagrams.length === 2 && diagrams.every((el) => el.querySelector('svg, button, .adoc-error'));
		}), { timeout: 15000 });
		// Only this test vault: accept the app's prompt if it is shown.
		await browser.execute(() => document.querySelectorAll<HTMLButtonElement>('.workspace-leaf.mod-active .adoc-mermaid button').forEach((button) => {
			if (button.textContent === 'Allow') button.click();
		}));
		await browser.waitUntil(async () => (await diagramCount()) === 2, { timeout: 15000, timeoutMsg: 'two Mermaid diagrams did not render' });
		const text = await browser.execute(() => document.querySelector('.workspace-leaf.mod-active .adoc-preview')?.textContent ?? '');
		expect(text).toContain('Edit source');
		expect(text).toContain('Approve the release');
	});

	it('updates a diagram after an edit in split mode and saves the source', async () => {
		await browser.executeObsidianCommand(`${pluginId}:toggle-split`);
		await browser.executeObsidian(({ app }) => {
			const view = app.workspace.getMostRecentLeaf()!.view as unknown as AdocView & {
				editor: { state: { doc: { toString(): string } }; dispatch(t: unknown): void };
			};
			const source = view.editor.state.doc.toString();
			const from = source.indexOf('Edit source');
			view.editor.dispatch({ changes: { from, to: from + 'Edit source'.length, insert: 'Review source' } });
		});
		await browser.waitUntil(async () => browser.execute(() => document.querySelector('.workspace-leaf.mod-active .adoc-mermaid')?.textContent?.includes('Review source') ?? false), { timeout: 10000 });
		await browser.waitUntil(async () => browser.executeObsidian(async ({ app }) => {
			const file = app.vault.getFileByPath('AsciiDoc Files/Diagrams.adoc')!;
			return (await app.vault.read(file)).includes('Review source');
		}), { timeout: 10000 });
		expect(await diagramCount()).toBe(2);
	});

	it('keeps an invalid diagram source and the rest of the page', async () => {
		await browser.executeObsidian(async ({ app }) => {
			const view = app.workspace.getMostRecentLeaf()!.view as unknown as AdocView;
			view.setViewData('= Invalid diagram\n\n[mermaid]\n----\nthis is not a diagram\n----\n\n== Still readable\n\nText after the diagram.', true);
			await view.render();
		});
		const result = await browser.execute(() => {
			const root = document.querySelector('.workspace-leaf.mod-active .adoc-preview')!;
			return { source: root.querySelector('code.language-mermaid')?.textContent, note: root.querySelector('.adoc-error')?.textContent, text: root.textContent };
		});
		expect(result.source).toContain('this is not a diagram');
		expect(result.note).toContain('could not render');
		expect(result.text).toContain('Text after the diagram.');
	});

	it('treats embedded code fences and HTML as diagram source', async () => {
		await browser.executeObsidian(async ({ app }) => {
			const view = app.workspace.getMostRecentLeaf()!.view as unknown as AdocView;
			view.setViewData('= Hostile diagram\n\n[source,mermaid]\n----\nflowchart LR\nA --> B\n```\n<script>window.adocMermaidXss = 1</script>\n----', true);
			await view.render();
		});
		const result = await browser.execute(() => {
			const root = document.querySelector('.workspace-leaf.mod-active .adoc-preview')!;
			return { scripts: root.querySelectorAll('script').length, xss: (window as unknown as { adocMermaidXss?: number }).adocMermaidXss ?? null };
		});
		expect(result).toEqual({ scripts: 0, xss: null });
	});
});
