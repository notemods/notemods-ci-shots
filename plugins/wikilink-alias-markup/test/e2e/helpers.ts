import { browser } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

// Shared notes and helpers of the end-to-end tests.
export const TARGET = ['# Target', '', 'Target body text for the page preview.', ''].join('\n');
export const NOTE = [
	'# Alias test', // 0
	'',
	'Post 1: [[Target|`obsidian`]] here.', // 2
	'',
	'Mixed: [[Target|**bold** and *italic* and ~~gone~~ and ==marked==]] end.', // 4
	'',
	'Plain: [[Target]] and [[snake_case_note]] end.', // 6
	'',
	'Core: `code` and **strong** here.', // 8
	'',
	'```', // 10
	'[[Target|`raw`]]',
	'```',
	'',
	'| Col | Link |', // 14
	'| --- | ---- |',
	'| a | [[Target\\|`cell`]] |', // 16
	'',
	'> [!note] Outer', // 18
	'> > [!tip] Inner',
	'> > Deep: [[Target|*deep* `code`]]', // 20
	'',
	'Math: [[Target|$NH_3$ gas]] end.', // 22
	'',
	'Last line.', // 24
].join('\n');
export const LAST = 24;
export const ACTIVE = '.workspace-leaf.mod-active';
export const POST1_RAW = 'Post 1: [[Target|`obsidian`]] here.';

/** Text of each line of the active editor. */
export async function lines(): Promise<string[]> {
	return browser.execute((sel: string) => Array.from(document.querySelectorAll(`${sel} .markdown-source-view .cm-content > .cm-line`)).map((l) => l.textContent ?? ''), ACTIVE);
}

/** Waits until the editor line that starts with `start` is exactly `text`. */
export async function waitForLine(start: string, text: string, timeout = 10000): Promise<void> {
	let last: string[] = [];
	await browser
		.waitUntil(
			async () => {
				last = await lines();
				return last.some((l) => l.startsWith(start) && l === text);
			},
			{ timeout, interval: 100 },
		)
		.catch(() => {
			throw new Error(`the line "${start}..." is not "${text}": ${JSON.stringify(last)}`);
		});
}

/** The plugin elements in the editor line that starts with `start`: class, text and the classes of the link around it. */
export async function marksIn(start: string): Promise<Array<{ cls: string; text: string; inLink: boolean; font: string; weight: string; style: string; deco: string }>> {
	return browser.execute(
		(sel: string, st: string) => {
			const line = Array.from(document.querySelectorAll(`${sel} .markdown-source-view .cm-content > .cm-line`)).find((l) => (l.textContent ?? '').startsWith(st));
			if (!line) return [];
			return Array.from(line.querySelectorAll<HTMLElement>('[class*="wam-"]')).map((el) => {
				const cs = getComputedStyle(el);
				return {
					cls: (Array.from(el.classList).find((c) => c.startsWith('wam-')) ?? '').slice(4),
					text: el.textContent ?? '',
					inLink: !!el.closest('.cm-hmd-internal-link') || el.classList.contains('cm-hmd-internal-link'),
					font: cs.fontFamily,
					weight: cs.fontWeight,
					style: cs.fontStyle,
					deco: cs.textDecorationLine,
				};
			});
		},
		ACTIVE,
		start,
	);
}

/** Tree token names around each `[[` of the editor, for a failure message. */
export async function treeDump(): Promise<string> {
	return browser.executeObsidian(({ app }) => {
		const cm = (app.workspace.activeEditor?.editor as unknown as { cm?: { state: { doc: { toString(): string } }; dom: HTMLElement } } | undefined)?.cm;
		if (!cm) return 'no editor';
		const spans = Array.from(cm.dom.querySelectorAll('.cm-line span')).slice(0, 60);
		return spans.map((s) => `${s.className}:${(s.textContent ?? '').slice(0, 12)}`).join(' | ');
	});
}

export async function writeNote(path: string, text: string): Promise<void> {
	await obsidianPage.write(path, text);
	await browser.waitUntil(
		async () =>
			browser.executeObsidian(
				async ({ app }, p, t) => {
					const file = app.vault.getFileByPath(p);
					return !!file && (await app.vault.cachedRead(file)) === t && !!app.metadataCache.getFileCache(file);
				},
				path,
				text,
			),
		{ timeout: 10000, interval: 50, timeoutMsg: `${path} was not indexed` },
	);
}

/** Brings the app window to the front: Live Preview shows a raw link only in a focused window. */
export async function focusWindow(): Promise<void> {
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
	await browser.waitUntil(async () => browser.execute(() => document.hasFocus()), { timeout: 5000, interval: 50, timeoutMsg: 'the app window has no focus' });
}

/**
 * A real click gives the editor the focus; then the cursor goes to line:ch. The click is at the right end of the first
 * line on the screen, away from any link text. A long note draws only the lines on the screen, so the last line of the
 * note can be missing from the page.
 */
export async function setCursor(line: number, ch: number): Promise<void> {
	await focusWindow();
	const first = browser.$(`${ACTIVE} .markdown-source-view .cm-content > .cm-line`);
	const width = (await first.getSize('width')) as number;
	await first.click({ x: Math.max(0, Math.floor(width / 2) - 4) });
	await browser.executeObsidian(
		({ app }, l, c) => {
			const editor = app.workspace.activeEditor?.editor;
			editor?.focus();
			editor?.setCursor({ line: l, ch: c });
		},
		line,
		ch,
	);
}

export async function setMode(mode: 'source' | 'preview'): Promise<void> {
	await browser.executeObsidian(async ({ app }, m) => {
		const leaf = app.workspace.getMostRecentLeaf();
		if (!leaf) return;
		const s = leaf.getViewState();
		await leaf.setViewState({ ...s, state: { ...s.state, mode: m, source: false } });
	}, mode);
}

/** Opens the test note in Live Preview with the cursor on the last line. */
export async function openNote(): Promise<void> {
	await obsidianPage.openFile('Alias.md');
	await setMode('source');
	await setCursor(LAST, 0);
	await waitForLine('Post 1:', 'Post 1: obsidian here.').catch(async (e: Error) => {
		throw new Error(`${e.message}\ntokens: ${await treeDump()}`);
	});
}

export async function activePath(): Promise<string | undefined> {
	return browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path);
}

export async function isMobile(): Promise<boolean> {
	return browser.executeObsidian(({ obsidian }) => obsidian.Platform.isMobile);
}

export async function takeErrors(): Promise<string[]> {
	return browser.execute(() => (window as unknown as { __wamErrors?: string[] }).__wamErrors?.splice(0) ?? []);
}

export async function collectErrors(): Promise<void> {
	await browser.execute(() => {
		const w = window as unknown as { __wamErrors?: string[] };
		if (w.__wamErrors) return;
		const errors: string[] = [];
		w.__wamErrors = errors;
		const original = console.error;
		console.error = (...args: unknown[]) => {
			errors.push(args.map(String).join(' '));
			original(...args);
		};
		window.addEventListener('error', (e) => errors.push(String(e.message)));
		window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
	});
}

/** Hovers el with the Mod key held, as a user does in Live Preview, and waits for the page preview of Target. */
export async function hoverShowsPreview(selector: string): Promise<boolean> {
	await browser.execute(() => document.querySelectorAll('.hover-popover').forEach((p) => p.remove()));
	for (let attempt = 0; attempt < 6; attempt++) {
		await browser.executeObsidian(({ obsidian }, sel) => {
			const el = document.querySelector<HTMLElement>(sel);
			if (!el) throw new Error(`no element ${sel}`);
			const r = el.getBoundingClientRect();
			const mac = obsidian.Platform.isMacOS;
			const init = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, ctrlKey: !mac, metaKey: mac };
			el.dispatchEvent(new MouseEvent('mouseover', init));
			el.dispatchEvent(new MouseEvent('mousemove', init));
		}, selector);
		await browser.pause(1200);
		const text = await browser.execute(() => document.querySelector('.hover-popover')?.textContent ?? '');
		if (text.includes('Target body text')) {
			await browser.execute(() => document.querySelectorAll('.hover-popover').forEach((p) => p.remove()));
			return true;
		}
		console.info(`hover attempt ${attempt} on ${selector}: popover text "${text.slice(0, 80)}"`);
	}
	return false;
}

