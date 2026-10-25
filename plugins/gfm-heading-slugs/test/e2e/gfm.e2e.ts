import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { lastNotice, pluginId } from './load';

// Real-app checks for acceptance criteria A6 to A9 of the spec, on minAppVersion and on the latest app (wdio.conf.mts).
const fill = (name: string, n: number): string => Array.from({ length: n }, (_, i) => `${name} note line ${i + 1}. This text fills the page so that the heading is out of view.`).join('\n');
const GUIDE = `# Project guide

Contents, written for GitHub:

- [Install](#install)
- [Setup steps](#setup-steps)
- [What's new?](#whats-new)
- [The second Hello World](#hello-world-1)
- [Install guide in the other note](Other%20note.md#install-guide)

## Install

${fill('Install', 40)}

## Setup steps

${fill('Setup', 40)}

## What's new?

${fill('News', 20)}

## Hello World

First one.

## Hello World

Second one.

## **Bold** and \`code span\` here

End.
`;
const OTHER = '# Other note\n\n## Install guide\n\nRun the installer, then open the vault.\n';
const OLD = [
	'# Old links',
	'',
	'## Setup steps',
	'',
	'## Team notes: 2026',
	'',
	'- [Setup](#Setup%20steps)',
	'- [Team](#Team%20notes%202026)',
	'- [Guide install](Project%20guide.md#Install)',
	'- [Already a slug](#setup-steps)',
	'',
].join('\n');
const OLD_CONVERTED = OLD.replace('(#Setup%20steps)', '(#setup-steps)').replace('(#Team%20notes%202026)', '(#team-notes-2026)').replace('(Project%20guide.md#Install)', '(Project%20guide.md#install)');
/** 0-based lines of the headings in GUIDE. */
const LINE = { setup: 53, hello2: 123 };
const ACTIVE = '.workspace-leaf.mod-active';

/** Writes a note and waits until the metadata cache lists `headings` headings for it. */
async function writeNote(path: string, text: string, headings: number): Promise<void> {
	await obsidianPage.write(path, text);
	await browser.waitUntil(
		async () =>
			browser.executeObsidian(
				async ({ app }, p, t, n) => {
					const file = app.vault.getFileByPath(p);
					if (!file || (await app.vault.cachedRead(file)) !== t) return false;
					return (app.metadataCache.getFileCache(file)?.headings?.length ?? 0) === n;
				},
				path,
				text,
				headings,
			),
		{ timeout: 10000, interval: 50, timeoutMsg: `${path} was not indexed` },
	);
}

async function setMode(mode: 'source' | 'preview'): Promise<void> {
	await browser.executeObsidian(async ({ app }, m) => {
		const leaf = app.workspace.getMostRecentLeaf();
		if (!leaf) return;
		const s = leaf.getViewState();
		await leaf.setViewState({ ...s, state: { ...s.state, mode: m, source: false } });
	}, mode);
}

async function openGuide(mode: 'source' | 'preview'): Promise<void> {
	await obsidianPage.openFile('Project guide.md');
	await setMode(mode);
	await browser.executeObsidian(({ app }) => {
		const editor = app.workspace.activeEditor?.editor;
		editor?.setCursor({ line: 2, ch: 0 });
		editor?.scrollTo(0, 0);
	});
	await browser.pause(300);
}

/** True when 0-based `line` of the active Live Preview editor is in the visible part of the scroller. */
async function lineVisible(line: number): Promise<boolean> {
	return browser.executeObsidian(({ app }, l) => {
		interface Cm {
			state: { doc: { line(n: number): { from: number } } };
			lineBlockAt(pos: number): { top: number };
			scrollDOM: { scrollTop: number; clientHeight: number };
		}
		const cm = (app.workspace.activeEditor?.editor as unknown as { cm: Cm } | undefined)?.cm;
		if (!cm) return false;
		const top = cm.lineBlockAt(cm.state.doc.line(l + 1).from).top;
		return top >= cm.scrollDOM.scrollTop - 4 && top <= cm.scrollDOM.scrollTop + cm.scrollDOM.clientHeight - 10;
	}, line);
}

/** Marks the Live Preview element that shows `text` as link text, for a real click. */
async function markEditorLink(text: string): Promise<string> {
	const ok = await browser.execute(
		(sel: string, t: string) => {
			document.querySelectorAll('[data-e2e]').forEach((e) => e.removeAttribute('data-e2e'));
			const el = Array.from(document.querySelectorAll(`${sel} .markdown-source-view .cm-content .cm-underline, ${sel} .markdown-source-view .cm-content .cm-link`)).find((e) => e.textContent === t);
			el?.setAttribute('data-e2e', 'target');
			return !!el;
		},
		ACTIVE,
		text,
	);
	if (!ok) throw new Error(`no Live Preview link text "${text}"`);
	return '[data-e2e="target"]';
}

async function activePath(): Promise<string> {
	return browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path ?? '');
}

async function readingScroll(): Promise<number> {
	return browser.executeObsidian(({ app }) => {
		const view = app.workspace.getMostRecentLeaf()?.view as unknown as { previewMode?: { getScroll(): number } } | undefined;
		return view?.previewMode?.getScroll() ?? -1;
	});
}

async function noticeTexts(): Promise<string[]> {
	return browser.execute(() => Array.from(document.querySelectorAll('.notice')).map((n) => n.textContent ?? ''));
}

async function clearNotices(): Promise<void> {
	await browser.execute(() => document.querySelectorAll('.notice').forEach((n) => n.remove()));
}

describe(`${pluginId} in the real app`, function () {
	before(async function () {
		await writeNote('Project guide.md', GUIDE, 7);
		await writeNote('Other note.md', OTHER, 2);
		await writeNote('Old links.md', OLD, 3);
	});

	it('A6 Reading view gives each heading its GitHub slug as id', async function () {
		await openGuide('preview');
		await browser.waitUntil(async () => browser.execute((sel: string) => document.querySelectorAll(`${sel} .markdown-reading-view [data-gfm-slug]`).length >= 7, ACTIVE), {
			timeout: 10000,
			interval: 100,
			timeoutMsg: 'headings have no slug ids',
		});
		const ids = await browser.execute((sel: string) => Array.from(document.querySelectorAll(`${sel} .markdown-reading-view [data-gfm-slug]`)).map((h) => h.id), ACTIVE);
		expect(ids).toEqual(['project-guide', 'install', 'setup-steps', 'whats-new', 'hello-world', 'hello-world-1', 'bold-and-code-span-here']);
	});

	it('A6 Reading view click on a slug link opens the later duplicate heading', async function () {
		await openGuide('preview');
		await clearNotices();
		expect(await readingScroll()).toBeLessThan(5);
		await browser.$(`${ACTIVE} .markdown-reading-view a[data-gfm-href="#hello-world-1"]`).click();
		await browser.waitUntil(async () => (await readingScroll()) >= LINE.hello2 - 3, { timeout: 5000, interval: 100, timeoutMsg: 'Reading view did not scroll to the second Hello World' });
		expect(await activePath()).toBe('Project guide.md');
		expect((await noticeTexts()).join(' ')).not.toContain('Unable to find');
	});

	it('A6 Reading view click on a slug link to another note opens that note', async function () {
		await openGuide('preview');
		await browser.$(`${ACTIVE} .markdown-reading-view a[data-gfm-href="Other note.md#install-guide"], ${ACTIVE} .markdown-reading-view a[data-gfm-href="Other%20note.md#install-guide"]`).click();
		await browser.waitUntil(async () => (await activePath()) === 'Other note.md', { timeout: 5000, interval: 100, timeoutMsg: 'the other note did not open' });
	});

	it('A7 Live Preview click on a slug link moves to the heading', async function () {
		await openGuide('source');
		await clearNotices();
		expect(await lineVisible(LINE.setup)).toBe(false);
		await browser.$(await markEditorLink('Setup steps')).click();
		await browser.waitUntil(async () => lineVisible(LINE.setup), { timeout: 5000, interval: 100, timeoutMsg: 'the Setup steps heading is not in view' });
		expect(await activePath()).toBe('Project guide.md');
		expect((await noticeTexts()).join(' ')).not.toContain('Unable to find');
	});

	it('A7 Live Preview click on a later duplicate moves to its line', async function () {
		await openGuide('source');
		await browser.$(await markEditorLink('The second Hello World')).click();
		await browser.waitUntil(async () => lineVisible(LINE.hello2), { timeout: 5000, interval: 100, timeoutMsg: 'the second Hello World is not in view' });
		const line = await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getCursor().line ?? -1);
		expect(line).toBe(LINE.hello2);
	});

	it('A7 Live Preview click on a slug link to another note opens it', async function () {
		await openGuide('source');
		await browser.$(await markEditorLink('Install guide in the other note')).click();
		await browser.waitUntil(async () => (await activePath()) === 'Other note.md', { timeout: 5000, interval: 100, timeoutMsg: 'the other note did not open' });
	});

	it('A8 copy command gives a GitHub-style link to the current heading', async function () {
		await openGuide('source');
		await browser.executeObsidian(({ app }, l) => app.workspace.activeEditor?.editor?.setCursor({ line: l + 5, ch: 0 }), LINE.setup);
		await browser.executeObsidianCommand(`${pluginId}:copy-github-heading-link`);
		await browser.waitUntil(async () => (await lastNotice()).includes('[Setup steps](#setup-steps)'), { timeout: 5000, timeoutMsg: 'no copy notice' });
	});

	it('A8 convert command changes the %20 links in one step, and one undo restores them', async function () {
		await obsidianPage.openFile('Old links.md');
		await setMode('source');
		await browser.executeObsidianCommand(`${pluginId}:convert-note-links`);
		const list = await browser.$('.modal .gfm-slugs-preview-list');
		await list.waitForExist({ timeout: 5000 });
		expect(await browser.execute(() => document.querySelectorAll('.modal .gfm-slugs-preview-list li').length)).toBe(3);
		await browser.$('.modal button.mod-cta').click();
		const text = (): Promise<string> => browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getValue() ?? '');
		await browser.waitUntil(async () => (await text()) === OLD_CONVERTED, { timeout: 5000, timeoutMsg: 'the links were not converted' });
		await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.undo());
		expect(await text()).toBe(OLD);
	});

	it('A5 an inserted heading link gets the slug in the same undo step', async function () {
		await obsidianPage.openFile('Old links.md');
		await setMode('source');
		const result = await browser.executeObsidian(({ app }) => {
			const editor = app.workspace.activeEditor?.editor;
			if (!editor) return ['', ''];
			const end = { line: editor.lastLine(), ch: 0 };
			editor.replaceRange('See [Team notes](#Team%20notes%202026)', end);
			const after = editor.getLine(end.line);
			editor.undo();
			return [after, editor.getLine(end.line)];
		});
		expect(result).toEqual(['See [Team notes](#team-notes-2026)', '']);
	});

	it('A9 typing in a 5,000-line note does no heading work', async function () {
		const big = Array.from({ length: 5000 }, (_, i) => (i % 50 === 0 ? `## Heading ${i}` : `Line ${i} with a [link](#Heading%20${i - (i % 50)}) in it.`)).join('\n');
		await writeNote('Big.md', big, 100);
		await obsidianPage.openFile('Big.md');
		await setMode('source');
		const r = await browser.executeObsidian(async ({ app }, id) => {
			interface P {
				stats: { filterScans: number };
				index: { computeCount: number };
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, P> } }).plugins.plugins[id]!;
			const editor = app.workspace.activeEditor?.editor;
			if (!editor) return { scans: -1, computes: -1, ms: -1 };
			const scans = p.stats.filterScans;
			const computes = p.index.computeCount;
			const t0 = performance.now();
			editor.setCursor({ line: 2500, ch: 5 });
			for (let i = 0; i < 50; i++) editor.replaceSelection('a');
			const ms = performance.now() - t0;
			return { scans: p.stats.filterScans - scans, computes: p.index.computeCount - computes, ms };
		}, pluginId);
		expect(r.scans).toBe(0);
		expect(r.computes).toBe(0);
		expect(r.ms).toBeLessThan(3000);
	});

	it('A1 the setting off leaves links to core', async function () {
		await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { settings: { useSlugs: boolean }; refresh(): void }> } }).plugins.plugins[id]!;
			p.settings.useSlugs = false;
			p.refresh();
		}, pluginId);
		await openGuide('preview');
		await browser.pause(500);
		const n = await browser.execute((sel: string) => document.querySelectorAll(`${sel} .markdown-reading-view [data-gfm-slug]`).length, ACTIVE);
		await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { settings: { useSlugs: boolean }; refresh(): void }> } }).plugins.plugins[id]!;
			p.settings.useSlugs = true;
			p.refresh();
		}, pluginId);
		expect(n).toBe(0);
	});
});
