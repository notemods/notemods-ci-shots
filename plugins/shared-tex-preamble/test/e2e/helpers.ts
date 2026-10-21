// Helpers for the Shared TeX Preamble end-to-end tests. Each helper waits on state, not on a fixed time.
import { browser } from '@wdio/globals';

export interface PluginApi {
	settings: { path: string; libraries: { name: string; path: string }[]; active: string };
	saveSettings(): Promise<void>;
	reload(reason: 'startup' | 'command'): Promise<{ status: string; loaded: string[]; errors: { line: number; message: string }[]; refreshed: number }>;
	last: { status: string; loaded: string[] } | null;
}

/** Sets the macro file path and saves the settings. */
export async function setPath(path: string): Promise<void> {
	await browser.executeObsidian(async ({ app }, p) => {
		const plugin = (app as unknown as { plugins: { plugins: Record<string, PluginApi> } }).plugins.plugins['shared-tex-preamble']!;
		plugin.settings.path = p;
		await plugin.saveSettings();
	}, path);
}

/** Removes the notices on screen, so the next check sees only new notices. */
export async function clearNotices(): Promise<void> {
	await browser.execute(() => document.querySelectorAll('.notice').forEach((n) => n.remove()));
}

/** Waits for a notice that contains each part. Returns its text. */
export async function waitNotice(...parts: string[]): Promise<string> {
	let found = '';
	await browser.waitUntil(
		async () => {
			const texts = await browser.execute(() => [...document.querySelectorAll('.notice')].map((n) => n.textContent ?? ''));
			found = texts.find((t) => parts.every((p) => t.includes(p))) ?? '';
			return found !== '';
		},
		{ timeout: 10_000, timeoutMsg: `No notice with ${parts.join(', ')}` },
	);
	return found;
}

/**
 * Opens each note in Reading view. On desktop each note gets its own split, so each view stays loaded and visible.
 * The mobile UI has no splits and defers hidden tabs, so there each note replaces the last one.
 */
export async function openReading(paths: string[]): Promise<void> {
	await browser.executeObsidian(async ({ app, obsidian }, list) => {
		for (const p of list) {
			const file = app.vault.getFileByPath(p);
			if (!file) throw new Error(`No file ${p}`);
			const leaf = obsidian.Platform.isMobile ? app.workspace.getLeaf(false) : app.workspace.getLeaf('split');
			await leaf.openFile(file, { state: { mode: 'preview' } });
		}
	}, paths);
}

/** True when the test runs with the mobile UI. */
export async function isMobile(): Promise<boolean> {
	return browser.executeObsidian(({ obsidian }) => obsidian.Platform.isMobile);
}

/** The math text of each open Reading view of the note, with spaces removed. "ERR:" marks a math error. */
export async function mathTexts(path: string): Promise<string[]> {
	return browser.executeObsidian(({ app, obsidian }, p) => {
		// MathJax 3 (1.13) gives each glyph as a class such as mjx-c32; MathJax 4 (1.14) gives it as text.
		const text = (e: Element) => Array.from(e.querySelectorAll('mjx-c')).map((c) => c.textContent || String.fromCodePoint(parseInt(/mjx-c([0-9A-F]+)/.exec(c.getAttribute('class') ?? '')?.[1] ?? '20', 16))).join('');
		return app.workspace
			.getLeavesOfType('markdown')
			.map((l) => l.view)
			.filter((v): v is InstanceType<typeof obsidian.MarkdownView> => v instanceof obsidian.MarkdownView && v.file?.path === p && v.getMode() === 'preview')
			.map((v) => {
				const m = v.previewMode.containerEl.querySelector('mjx-container');
				if (!m) return '';
				const err = m.querySelector('[data-mjx-error], mjx-merror, mjx-mtext[style*="red"]');
				return (err ? 'ERR:' : '') + text(m).replace(/\s+/g, '');
			});
	}, path);
}

/** Waits until each loaded Reading view of the note shows the text. There must be one such view or more. */
export async function waitMath(path: string, text: string): Promise<void> {
	let last: string[] = [];
	await browser.waitUntil(
		async () => {
			last = await mathTexts(path);
			return last.length >= 1 && last.every((x) => x === text);
		},
		{ timeout: 15_000, timeoutMsg: `${path} does not show ${text}` },
	).catch((e: unknown) => {
		throw new Error(`${String(e)}; views show ${JSON.stringify(last)}`);
	});
}

/** The engine error for the source, or "" when it renders with no error. Uses only the public renderMath. */
export async function engineError(source: string): Promise<string> {
	return browser.executeObsidian(async ({ obsidian }, s) => {
		await obsidian.loadMathJax();
		const el = obsidian.renderMath(s, false);
		const err = el.querySelector('[data-mjx-error]');
		if (err) return err.getAttribute('data-mjx-error') || 'error';
		if (el.querySelector('mjx-merror')) return 'error';
		// An undefined command shows as red text with its name.
		const text = (e: Element) => Array.from(e.querySelectorAll('mjx-c')).map((c) => c.textContent || String.fromCodePoint(parseInt(/mjx-c([0-9A-F]+)/.exec(c.getAttribute('class') ?? '')?.[1] ?? '20', 16))).join('');
		const red = Array.from(el.querySelectorAll('mjx-mtext')).find((t) => /^\\[A-Za-z]+$/.test(text(t)) && (t.getAttribute('style') ?? '').includes('red'));
		return red ? `undefined ${text(red)}` : '';
	}, source);
}

/** Writes a vault file through the vault API. obsidianPage.write wrote stray bytes for an empty text. */
export async function write(path: string, text: string): Promise<void> {
	await browser.executeObsidian(async ({ app }, p, t) => {
		const f = app.vault.getFileByPath(p);
		if (f) await app.vault.modify(f, t);
		else await app.vault.create(p, t);
	}, path, text);
}

export async function read(path: string): Promise<string> {
	return browser.executeObsidian(async ({ app }, p) => app.vault.adapter.read(p), path);
}

export async function exists(path: string): Promise<boolean> {
	return browser.executeObsidian(async ({ app }, p) => app.vault.adapter.exists(p), path);
}
