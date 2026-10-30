import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

// Reviewer probes (R-NEW, s1030). Not part of the product. Each probe logs its state with the prefix "RVW".
const SENTINEL = 'clipboard before the review';
const ACTIVE = '.workspace-leaf.mod-active';

interface Snap {
	text: string;
	clipboard: string;
	notices: string[];
	info: string;
}

async function snap(info = ''): Promise<Snap> {
	return browser.executeObsidian(async ({ app }, i) => {
		const editor = app.workspace.activeEditor?.editor;
		let clipboard = '';
		try {
			clipboard = await navigator.clipboard.readText();
		} catch (e) {
			clipboard = `<read failed: ${String(e)}>`;
		}
		const w = window as unknown as { rvwNotices?: string[] };
		return { text: editor ? editor.getValue() : '<no editor>', clipboard, notices: [...(w.rvwNotices ?? [])], info: i };
	}, info);
}

function log(name: string, s: unknown): void {
	process.stdout.write(`RVW ${name} ${JSON.stringify(s)}\n`);
}

async function setOptions(cut: string, copy: string): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, c, p) => {
		const plugin = (app as unknown as { plugins: { plugins: Record<string, { settings: { cut: string; copy: string; notice: boolean }; saveSettings(): Promise<void>; applySettings(): void }> } }).plugins.plugins[id]!;
		plugin.settings.cut = c;
		plugin.settings.copy = p;
		plugin.settings.notice = true;
		await plugin.saveSettings();
		plugin.applySettings();
	}, pluginId, cut, copy);
}

async function focusWindow(): Promise<void> {
	await browser.execute(() => {
		try {
			const req = (window as unknown as { require: (m: string) => { app?: { focus(o?: unknown): void }; getCurrentWindow(): { focus(): void; show(): void } } }).require;
			const remote = req('@electron/remote');
			remote.app?.focus({ steal: true });
			remote.getCurrentWindow().show();
			remote.getCurrentWindow().focus();
		} catch {
			window.focus();
		}
	});
}

async function closeAll(): Promise<void> {
	await browser.executeObsidian(async ({ app }) => {
		for (const leaf of app.workspace.getLeavesOfType('markdown')) {
			await (leaf.view as unknown as { save(): Promise<void> }).save();
			leaf.detach();
		}
		for (const leaf of app.workspace.getLeavesOfType('canvas')) leaf.detach();
	});
}

async function openLive(path: string, text: string): Promise<void> {
	await closeAll();
	await obsidianPage.write(path, text);
	await browser.pause(300);
	await obsidianPage.openFile(path);
	await browser.executeObsidian(async ({ app }) => {
		const leaf = app.workspace.getMostRecentLeaf();
		if (!leaf) return;
		const st = leaf.getViewState();
		await leaf.setViewState({ ...st, state: { ...st.state, mode: 'source', source: false } });
	});
	await focusWindow();
	await browser.$(`${ACTIVE} .markdown-source-view .cm-content > .cm-line`).click();
	await browser.executeObsidian(({ app }, t) => {
		app.workspace.activeEditor?.editor?.setValue(t);
		(window as unknown as { rvwNotices: string[] }).rvwNotices = [];
	}, text);
	await browser.execute(async (t) => navigator.clipboard.writeText(t), SENTINEL);
	await browser.pause(200);
}

const cutKeys = async () => browser.keys([Key.Ctrl, 'x']);

describe('Reviewer probes', function () {
	before(async function () {
		await browser.execute(() => {
			const w = window as unknown as { rvwNotices?: string[] };
			w.rvwNotices = [];
			new MutationObserver((list) => {
				for (const m of list) for (const n of Array.from(m.addedNodes)) if (n instanceof HTMLElement && n.classList.contains('notice')) w.rvwNotices!.push(n.textContent ?? '');
			}).observe(document.body, { childList: true, subtree: true });
		});
		// A 60x40 PNG for the image probe.
		await browser.executeObsidian(async ({ app }) => {
			if (app.vault.getFileByPath('rvw.png')) return;
			const c = document.createElement('canvas');
			c.width = 60;
			c.height = 40;
			const g = c.getContext('2d')!;
			g.fillStyle = '#c33';
			g.fillRect(0, 0, 60, 40);
			const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
			await app.vault.createBinary('rvw.png', await blob.arrayBuffer());
		});
	});

	afterEach(async function () {
		await setOptions('block', 'allow');
	});

	for (const mode of ['block', 'allow']) {
		it(`R1 selected image, cut ${mode}`, async function () {
			await setOptions(mode, 'allow');
			const text = 'Top line.\n\n![[rvw.png]]\n\nBottom line.';
			await openLive('Rvw image.md', text);
			const img = browser.$(`${ACTIVE} .cm-content .image-embed img`);
			await img.waitForDisplayed({ timeout: 5000 });
			await img.click();
			await browser.pause(300);
			const sel = await browser.execute(() => ({ modSel: !!document.querySelector('.mod-image-selected'), isSel: !!document.querySelector('.image-embed.is-selected, .internal-embed.is-selected'), focus: document.activeElement ? `${document.activeElement.tagName}.${document.activeElement.className}`.slice(0, 60) : 'none' }));
			await cutKeys();
			await browser.pause(600);
			const s = await snap(JSON.stringify(sel));
			log(`R1-${mode}`, s);
			expect(sel.modSel).toBe(true);
			expect(s.text).not.toContain('![[rvw.png]]');
			expect(s.clipboard).toBe('![[rvw.png]]');
		});
	}

	for (const mode of ['block', 'allow']) {
		it(`R2 selected table cells, cut ${mode}`, async function () {
			await setOptions(mode, 'allow');
			const text = 'Intro.\n\n| Name | Role |\n|---|---|\n| Ana | Lead |\n| Bo | Dev |\n\nEnd.';
			await openLive('Rvw table.md', text);
			const a = browser.$(`//div[contains(@class,"mod-active")]//div[contains(@class,"cm-table-widget")]//td[contains(normalize-space(.),"Ana")]`);
			const b = browser.$(`//div[contains(@class,"mod-active")]//div[contains(@class,"cm-table-widget")]//td[contains(normalize-space(.),"Dev")]`);
			await a.waitForDisplayed({ timeout: 5000 });
			await a.click();
			await browser.pause(200);
			const ae = await a.getElement();
			const be = await b.getElement();
			await browser.action('pointer').move({ origin: ae }).down().pause(100).move({ origin: be, duration: 300 }).pause(100).up().perform();
			await browser.pause(300);
			const cells = await browser.execute(() => document.querySelectorAll('.cm-table-widget .is-selected').length);
			await cutKeys();
			await browser.pause(600);
			const s = await snap(`selected cells ${cells}`);
			log(`R2-${mode}`, s);
			expect(cells).toBeGreaterThan(1);
			expect(s.clipboard).toContain('Ana');
		});
	}

	it('R3 popout window: Ctrl+X with only a cursor', async function () {
		const mobile = await browser.executeObsidian(({ app }) => (app as unknown as { isMobile: boolean }).isMobile);
		if (mobile) return this.skip();
		await setOptions('block', 'allow');
		await closeAll();
		const text = 'Pop first line.\nPop second line.';
		await obsidianPage.write('Rvw pop.md', text);
		await browser.pause(300);
		const main = await browser.getWindowHandle();
		await browser.executeObsidian(async ({ app }) => {
			const f = app.vault.getFileByPath('Rvw pop.md')!;
			const leaf = app.workspace.openPopoutLeaf();
			await leaf.openFile(f);
			const st = leaf.getViewState();
			await leaf.setViewState({ ...st, state: { ...st.state, mode: 'source', source: false } });
		});
		await browser.pause(1500);
		const handles = await browser.getWindowHandles();
		const pop = handles.find((h) => h !== main);
		log('R3-handles', { main, handles });
		expect(pop).toBeDefined();
		await browser.switchWindow(pop!);
		try {
			const line = browser.$('.cm-content > .cm-line');
			await line.waitForDisplayed({ timeout: 5000 });
			await line.click();
			await browser.execute(async (t) => navigator.clipboard.writeText(t), SENTINEL);
			await browser.pause(200);
			await cutKeys();
			await browser.pause(600);
			const r = await browser.execute(async () => {
				let clip = '';
				try {
					clip = await navigator.clipboard.readText();
				} catch (e) {
					clip = String(e);
				}
				return { text: Array.from(document.querySelectorAll('.cm-content > .cm-line')).map((l) => l.textContent).join('\n'), clip };
			});
			log('R3-popout', r);
			expect(r.text).toContain('Pop first line.');
			expect(r.clip).toBe(SENTINEL);
		} finally {
			await browser.switchWindow(main);
			await browser.executeObsidian(({ app }) => {
				for (const leaf of app.workspace.getLeavesOfType('markdown')) leaf.detach();
			});
		}
	});

	it('R4 canvas text card in edit mode: Ctrl+X with only a cursor', async function () {
		await setOptions('block', 'allow');
		await closeAll();
		const data = { nodes: [{ id: 'n1', type: 'text', text: 'Card first line\nCard second line', x: 0, y: 0, width: 320, height: 140 }], edges: [] };
		await obsidianPage.write('Rvw board.canvas', JSON.stringify(data));
		await browser.pause(300);
		await obsidianPage.openFile('Rvw board.canvas');
		await focusWindow();
		const node = browser.$(`${ACTIVE} .canvas-node`);
		await node.waitForDisplayed({ timeout: 8000 });
		await node.doubleClick();
		await browser.pause(800);
		const line = browser.$(`${ACTIVE} .canvas-node .cm-content > .cm-line`);
		const editing = await line.isDisplayed().catch(() => false);
		if (editing) await line.click();
		await browser.execute(async (t) => navigator.clipboard.writeText(t), SENTINEL);
		await browser.pause(200);
		await cutKeys();
		await browser.pause(600);
		const r = await browser.execute(async () => {
			let clip = '';
			try {
				clip = await navigator.clipboard.readText();
			} catch (e) {
				clip = String(e);
			}
			const a = document.activeElement;
			return { text: Array.from(document.querySelectorAll('.canvas-node .cm-content > .cm-line')).map((l) => l.textContent).join('\n'), clip, focus: a ? `${a.tagName}.${a.className}`.slice(0, 60) : 'none' };
		});
		log('R4-canvas', { editing, ...r, notices: (await snap()).notices });
		expect(editing).toBe(true);
		expect(r.text).toContain('Card first line');
		expect(r.clip).toBe(SENTINEL);
	});
});
