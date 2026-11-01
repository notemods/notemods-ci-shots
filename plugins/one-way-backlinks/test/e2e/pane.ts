// Helpers that read the pane of One-way Backlinks in a real Obsidian.
import { browser } from '@wdio/globals';
import type { ChainablePromiseElement } from 'webdriverio';
import { pluginId } from './load';

export interface PaneState {
	note: string;
	/** The list that shows: one-way or paired. */
	mode: string;
	oneWay: number;
	paired: number;
	/** Names of the rows that show, top to bottom. */
	rows: string[];
	/** Link counts of the rows that show. */
	counts: string[];
	empty: string;
	draws: number;
	computes: number;
	lastComputeMs: number;
	scrollTop: number;
}

/** The state of the first pane, or null when no loaded pane exists. */
export async function pane(): Promise<PaneState | null> {
	return browser.executeObsidian(({ app }, type) => {
		const leaf = app.workspace.getLeavesOfType(type)[0];
		const view = leaf?.view as unknown as { contentEl?: HTMLElement; draws?: number; computes?: number; lastComputeMs?: number; getViewType(): string } | undefined;
		const el = view?.contentEl;
		if (!view || !el || view.getViewType() !== type || typeof view.draws !== 'number') return null;
		const q = (s: string): string => el.querySelector(s)?.textContent ?? '';
		return {
			note: q('.owb-note'),
			mode: el.querySelector('.owb-list')?.getAttribute('data-mode') ?? '',
			oneWay: Number(q('.owb-mode[data-mode="one-way"] .owb-mode-count')),
			paired: Number(q('.owb-mode[data-mode="paired"] .owb-mode-count')),
			rows: [...el.querySelectorAll('.owb-row .owb-name')].map((e) => e.textContent ?? ''),
			counts: [...el.querySelectorAll('.owb-row .owb-count')].map((e) => e.textContent ?? ''),
			empty: q('.owb-empty'),
			draws: view.draws,
			computes: view.computes ?? 0,
			lastComputeMs: view.lastComputeMs ?? 0,
			scrollTop: el.scrollTop,
		};
	}, pluginId);
}

/** Opens the note in the main area and shows the pane. Waits until the pane names the note. */
export async function openWithPane(path: string): Promise<PaneState> {
	await browser.executeObsidian(async ({ app }, p) => {
		const file = app.vault.getFileByPath(p);
		if (!file) throw new Error(`no note ${p}`);
		await app.workspace.getLeaf(false).openFile(file);
	}, path);
	await browser.executeObsidianCommand(`${pluginId}:open`);
	const name = path.replace(/\.md$/, '').split('/').pop() ?? path;
	return waitPane((s) => s.note === name, `pane for ${path}`);
}

/** Waits until the pane state passes the test. The error message holds the last state. */
export async function waitPane(test: (s: PaneState) => boolean, what: string, timeout = 10_000): Promise<PaneState> {
	let last: PaneState | null = null;
	await browser
		.waitUntil(
			async () => {
				last = await pane();
				return !!last && test(last);
			},
			{ timeout, interval: 100 },
		)
		.catch(() => {
			throw new Error(`${what}: last pane state ${JSON.stringify(last)}`);
		});
	return last!;
}

/** Clicks a button of the pane with a real pointer click. */
export async function clickMode(mode: 'one-way' | 'paired'): Promise<void> {
	const el = browser.$(`.owb-view .owb-mode[data-mode="${mode}"]`);
	await clickable(el, `button ${mode}`);
	await el.click();
}

/** Waits until the element takes a click. The error message holds the drawer state and the box of the element. */
async function clickable(el: ChainablePromiseElement, what: string): Promise<void> {
	await el.waitForClickable({ timeout: 5000 }).catch(async () => {
		const info = await browser.executeObsidian(({ app }) => {
			const split = app.workspace.rightSplit as unknown as { collapsed?: boolean; containerEl?: HTMLElement; children?: { view?: { getViewType(): string } }[] };
			const views = [...document.querySelectorAll<HTMLElement>('.owb-view')].map((v) => {
				const box = v.getBoundingClientRect();
				let hidden = '';
				for (let a: HTMLElement | null = v; a; a = a.parentElement) {
					const cs = getComputedStyle(a);
					if (cs.display === 'none' || cs.visibility === 'hidden') { hidden = `${a.tagName}.${a.className} display=${cs.display} visibility=${cs.visibility}`; break; }
				}
				return { box: [box.x, box.y, box.width, box.height], hidden, leaf: v.closest('.workspace-leaf')?.className ?? '' };
			});
			const leaves = app.workspace.getLeavesOfType('one-way-backlinks').length;
			const drawer = (split.children ?? []).map((c) => c.view?.getViewType() ?? '?');
			return { collapsed: split.collapsed ?? null, splitClass: split.containerEl?.className ?? '', views, leaves, drawer, active: (app.workspace as unknown as { activeLeaf?: { view?: { getViewType(): string } } }).activeLeaf?.view?.getViewType() ?? null, mobile: document.body.classList.contains('is-mobile') };
		});
		throw new Error(`${what} is not clickable: ${JSON.stringify(info)}`);
	});
}

/** Clicks the Link back button of the row of this note. */
export async function clickLinkBack(name: string): Promise<void> {
	const rows = await browser.$$('.owb-view .owb-row');
	for (const row of rows) {
		if ((await row.$('.owb-name').getHTML({ includeSelectorTag: false })) === name) {
			const btn = row.$('.owb-link-back');
			await clickable(btn, `Link back of ${name}`);
			await btn.click();
			return;
		}
	}
	throw new Error(`no row ${name}`);
}

/** Starts to record console.error calls and uncaught errors in the app. takeErrors() reads and clears them. */
export async function captureErrors(): Promise<void> {
	await browser.executeObsidian(() => {
		const w = window as unknown as { __owbErrors?: string[]; __owbOrig?: typeof console.error };
		if (w.__owbErrors) return;
		w.__owbErrors = [];
		w.__owbOrig = console.error;
		console.error = (...args: unknown[]) => {
			w.__owbErrors!.push(args.map(String).join(' '));
			w.__owbOrig!(...args);
		};
		window.addEventListener('error', (e) => w.__owbErrors?.push(String(e.message)));
		window.addEventListener('unhandledrejection', (e) => w.__owbErrors?.push(String(e.reason)));
	});
}

export async function takeErrors(): Promise<string[]> {
	return browser.executeObsidian(() => {
		const w = window as unknown as { __owbErrors?: string[] };
		const out = [...(w.__owbErrors ?? [])];
		if (w.__owbErrors) w.__owbErrors.length = 0;
		return out;
	});
}
