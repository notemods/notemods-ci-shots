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

describe('Reviewer probe c', function () {
	before(async function () {
		await browser.execute(() => {
			const w = window as unknown as { rvwNotices?: string[] };
			w.rvwNotices = [];
			new MutationObserver((list) => {
				for (const m of list) for (const n of Array.from(m.addedNodes)) if (n instanceof HTMLElement && n.classList.contains('notice')) w.rvwNotices!.push(n.textContent ?? '');
			}).observe(document.body, { childList: true, subtree: true });
		});
	});
	for (const mode of ['block', 'off']) {
		it(`R4c canvas text card in edit mode, plugin ${mode}`, async function () {
			await setOptions('block', 'allow');
			if (mode === 'off') {
				await browser.executeObsidian(async ({ app }, id) => {
					await (app as unknown as { plugins: { disablePlugin(id: string): Promise<void> } }).plugins.disablePlugin(id);
				}, pluginId);
			}
			try {
				await closeAll();
				const data = { nodes: [{ id: 'n1', type: 'text', text: 'Card first line\nCard second line', x: 0, y: 0, width: 320, height: 140 }], edges: [] };
				await obsidianPage.write(`Rvw board ${mode}.canvas`, JSON.stringify(data));
				await browser.pause(300);
				await obsidianPage.openFile(`Rvw board ${mode}.canvas`);
				await focusWindow();
				const node = browser.$(`${ACTIVE} .canvas-node`);
				await node.waitForDisplayed({ timeout: 8000 });
				await node.doubleClick();
				await browser.pause(1000);
				const read = async (tag: string) =>
					browser.execute(async (t) => {
						const f = document.querySelector('.workspace-leaf.mod-active .canvas-node iframe') as HTMLIFrameElement | null;
						const d = f?.contentDocument;
						const view = d?.querySelector('.cm-content');
						const sel = d?.getSelection();
						let clip = '';
						try {
							clip = await navigator.clipboard.readText();
						} catch (e) {
							clip = String(e);
						}
						const a = document.activeElement;
						return { tag: t, iframe: !!f, lines: view ? Array.from(view.querySelectorAll('.cm-line')).map((l) => l.textContent) : null, collapsed: sel ? sel.isCollapsed : null, innerFocus: d?.activeElement ? `${d.activeElement.tagName}.${d.activeElement.className}`.slice(0, 40) : 'none', focus: a ? `${a.tagName}.${a.className}`.slice(0, 40) : 'none', clip };
					}, tag);
				await browser.execute(async (t) => navigator.clipboard.writeText(t), SENTINEL);
				await browser.pause(200);
				await browser.execute(() => {
					(window as unknown as { rvwNotices: string[] }).rvwNotices = [];
				});
				const before = await read('before');
				await cutKeys();
				await browser.pause(800);
				const after = await read('after');
				const notices = (await snap()).notices;
				const saved = await browser.executeObsidian(async ({ app }, p) => {
					const f = app.vault.getFileByPath(p);
					return f ? app.vault.read(f) : '';
				}, `Rvw board ${mode}.canvas`);
				log(`R4c-${mode}`, { before, after, notices, saved });
				expect(before.iframe).toBe(true);
				if (mode === 'block') {
					expect(after.lines).toEqual(before.lines);
					expect(after.clip).toBe(SENTINEL);
					expect(notices.length).toBe(1);
				} else {
					expect(after.clip).toBe('Card second line');
				}
			} finally {
				if (mode === 'off') {
					await browser.executeObsidian(async ({ app }, id) => {
						await (app as unknown as { plugins: { enablePlugin(id: string): Promise<boolean> } }).plugins.enablePlugin(id);
					}, pluginId);
				}
			}
		});
	}
});

describe('Reviewer probe d', function () {
	before(async function () {
		await browser.execute(() => {
			const w = window as unknown as { rvwNotices?: string[] };
			w.rvwNotices = [];
			new MutationObserver((list) => {
				for (const m of list) for (const n of Array.from(m.addedNodes)) if (n instanceof HTMLElement && n.classList.contains('notice')) w.rvwNotices!.push(n.textContent ?? '');
			}).observe(document.body, { childList: true, subtree: true });
		});
	});

	const cases: Array<[string, boolean, string]> = [
		['source-embed', true, 'Intro line.\n![[Some note]]\nEnd line.'],
		['live-embed', false, 'Intro line.\n![[Some note]]\nEnd line.'],
		['source-mdimage', true, 'Intro line.\n![alt text](pic.png) and words\nEnd line.'],
		['source-plain', true, 'Intro line.\nPlain middle line.\nEnd line.'],
	];
	for (const [name, source, text] of cases) {
		it(`R6 fail open check ${name}: cursor at the start of line 2, Ctrl+X`, async function () {
			await setOptions('block', 'allow');
			await openLive(`Rvw ${name}.md`, text);
			if (source) {
				await browser.executeObsidian(async ({ app }) => {
					const leaf = app.workspace.getMostRecentLeaf();
					if (!leaf) return;
					const st = leaf.getViewState();
					await leaf.setViewState({ ...st, state: { ...st.state, mode: 'source', source: true } });
				});
				await browser.$(`${ACTIVE} .markdown-source-view .cm-content > .cm-line`).click();
				await browser.execute(async (t) => navigator.clipboard.writeText(t), SENTINEL);
			}
			await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.setCursor({ line: 1, ch: 0 }));
			await browser.pause(300);
			await browser.execute(() => {
				(window as unknown as { rvwNotices: string[] }).rvwNotices = [];
			});
			await cutKeys();
			await browser.pause(700);
			const s = await snap(name);
			log(`R6-${name}`, s);
			expect(s.text).toBe(text);
			expect(s.clipboard).toBe(SENTINEL);
			expect(s.notices.length).toBe(1);
		});
	}
});

describe('Reviewer probe h', function () {
	before(async function () {
		await browser.execute(() => {
			const w = window as unknown as { rvwNotices?: string[] };
			w.rvwNotices = [];
			new MutationObserver((list) => {
				for (const m of list) for (const n of Array.from(m.addedNodes)) if (n instanceof HTMLElement && n.classList.contains('notice')) w.rvwNotices!.push(n.textContent ?? '');
			}).observe(document.body, { childList: true, subtree: true });
		});
		await browser.executeObsidian(async ({ app }) => {
			if (app.vault.getFileByPath('rvwbig.png')) return;
			const c = document.createElement('canvas');
			c.width = 300;
			c.height = 200;
			const g = c.getContext('2d')!;
			g.fillStyle = '#36c';
			g.fillRect(0, 0, 300, 200);
			const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
			await app.vault.createBinary('rvwbig.png', await blob.arrayBuffer());
		});
	});

	it('R7 two cursors, one at the start of an embed line, one in a plain line', async function () {
		await setOptions('block', 'allow');
		const text = 'Intro line.\n![[Some note]]\nPlain line here.\nEnd line.';
		await openLive('Rvw multi.md', text);
		await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.setSelections([{ anchor: { line: 1, ch: 0 } }, { anchor: { line: 2, ch: 3 } }]));
		await browser.pause(300);
		await cutKeys();
		await browser.pause(700);
		const s = await snap('multi');
		log('R7-multi', s);
		expect(s.text).toBe(text);
		expect(s.clipboard).toBe(SENTINEL);
	});

	for (const mode of ['block', 'allow']) {
		it(`R8 click-selected image in Live Preview, cut ${mode}`, async function () {
			await setOptions(mode, 'allow');
			const text = 'Top line.\n\n![[rvwbig.png]]\n\nBottom line.';
			await openLive(`Rvw img ${mode}.md`, text);
			const img = browser.$(`${ACTIVE} .cm-content .image-embed img`);
			await img.waitForDisplayed({ timeout: 5000 });
			await img.click({ x: -60, y: -40 });
			await browser.pause(400);
			const sel = await browser.execute(() => ({ modSel: !!document.querySelector('.mod-image-selected'), focus: document.activeElement ? `${document.activeElement.tagName}.${document.activeElement.className}`.slice(0, 60) : 'none' }));
			await browser.execute(() => {
				(window as unknown as { rvwNotices: string[] }).rvwNotices = [];
			});
			await cutKeys();
			await browser.pause(700);
			const s = await snap(JSON.stringify(sel));
			log(`R8-${mode}`, s);
			expect(sel.modSel).toBe(true);
		});
	}
});
