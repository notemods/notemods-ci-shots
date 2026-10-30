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


describe('Reviewer probes b', function () {
	before(async function () {
		await browser.execute(() => {
			const w = window as unknown as { rvwNotices?: string[] };
			w.rvwNotices = [];
			new MutationObserver((list) => {
				for (const m of list) for (const n of Array.from(m.addedNodes)) if (n instanceof HTMLElement && n.classList.contains('notice')) w.rvwNotices!.push(n.textContent ?? '');
			}).observe(document.body, { childList: true, subtree: true });
		});
	});

	it('R5 the cut command from the command palette (real keys), then Ctrl+V', async function () {
		await setOptions('block', 'allow');
		const text = 'Alpha line one.\nBravo line two.\nCharlie line three.';
		await openLive('Rvw palette.md', text);
		await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.setCursor({ line: 1, ch: 3 }));
		await browser.pause(200);
		await browser.keys([Key.Ctrl, 'p']);
		const input = browser.$('.prompt-input');
		await input.waitForDisplayed({ timeout: 5000 });
		await browser.keys('Cut selection or line'.split(''));
		await browser.pause(400);
		const top = await browser.execute(() => document.querySelector('.suggestion-item.is-selected')?.textContent ?? '');
		await browser.keys([Key.Enter]);
		await browser.pause(800);
		const cut = await snap(`palette top: ${top}`);
		log('R5-cut', cut);
		await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.setCursor({ line: 1, ch: 2 }));
		await browser.pause(200);
		await browser.keys([Key.Ctrl, 'v']);
		await browser.pause(600);
		const pasted = await snap();
		log('R5-paste', pasted);
		expect(cut.text).toBe('Alpha line one.\nCharlie line three.');
		expect(cut.clipboard).toBe('Bravo line two.');
		expect(pasted.text).toBe(text);
	});
});
