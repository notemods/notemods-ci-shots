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
				expect(after.lines).toEqual(before.lines);
				expect(after.clip).toBe(SENTINEL);
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
