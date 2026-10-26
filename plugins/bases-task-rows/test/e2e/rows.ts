// Helpers for the Task rows view in a real Obsidian.
import { browser } from '@wdio/globals';
import { pluginId } from './load';

export const DIR = 'Bases Task Rows';

export interface ViewState {
	rows: number;
	ids: string[];
	groups: string[];
	info: string;
	timing: { collect: number; render: number; tasks: number; rows: number };
}

/** State of the Task rows view in the active tab, or null when there is none yet. */
export async function viewState(): Promise<ViewState | null> {
	return browser.executeObsidian(({ app }, id) => {
		interface V {
			rootEl: HTMLElement;
			shownIds(): string[];
			timing: ViewState['timing'];
		}
		const p = (app as unknown as { plugins: { plugins: Record<string, { views: Set<V> }> } }).plugins.plugins[id];
		const leafEl = document.querySelector('.workspace-leaf.mod-active');
		const v = [...(p?.views ?? [])].find((x) => x.rootEl.isConnected && leafEl?.contains(x.rootEl));
		if (!v) return null;
		return {
			rows: v.rootEl.querySelectorAll('tr.btr-row').length,
			ids: v.shownIds(),
			groups: Array.from(v.rootEl.querySelectorAll('tr.btr-group td')).map((td) => td.textContent ?? ''),
			info: v.rootEl.querySelector('.btr-info')?.textContent ?? '',
			timing: { ...v.timing },
		};
	}, pluginId);
}

/** Opens a base file and waits until its view shows the given number of rows. */
export async function openBase(file: string, rows: number, timeout = 15000): Promise<ViewState> {
	const { obsidianPage } = await import('wdio-obsidian-service');
	await obsidianPage.openFile(`${DIR}/${file}`);
	return waitRows(rows, timeout);
}

export async function waitRows(rows: number, timeout = 15000): Promise<ViewState> {
	let last: ViewState | null = null;
	await browser.waitUntil(
		async () => {
			last = await viewState();
			return last?.rows === rows;
		},
		{ timeout, interval: 200, timeoutMsg: `expected ${rows} rows` },
	);
	return last!;
}

/** Clicks an element inside the row with this id. */
export async function clickInRow(rowId: string, selector: string): Promise<void> {
	const ok = await browser.execute(
		(id: string, sel: string) => {
			const tr = Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active tr.btr-row')).find((x) => x.dataset.id === id);
			const el = tr?.querySelector<HTMLElement>(sel);
			el?.click();
			return !!el;
		},
		rowId,
		selector,
	);
	if (!ok) throw new Error(`no ${selector} in row ${rowId}`);
}

export async function readNote(path: string): Promise<string> {
	return browser.executeObsidian(async ({ app }, p) => app.vault.read(app.vault.getFileByPath(p)!), path);
}

export async function today(): Promise<string> {
	return browser.executeObsidian(({ obsidian }) => obsidian.moment().format('YYYY-MM-DD'));
}

/** Puts a fake GitHub reply into the plugin, stores a fake token and presses Refresh. */
export async function signInWith(reply: { status: number; json: unknown }): Promise<{ pro: boolean; status: string; secret: string | null }> {
	return browser.executeObsidian(
		async ({ app }, id, r) => {
			interface Pro {
				opts: { http: unknown };
				refreshNow(): Promise<void>;
				getState(): { status: string };
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: Pro; isPro(): boolean }> } }).plugins.plugins[id]!;
			p.pro.opts.http = () => Promise.resolve(r);
			app.secretStorage.setSecret(`${id}-github-token`, `gho_${'0'.repeat(36)}`);
			await p.pro.refreshNow();
			return { pro: p.isPro(), status: p.pro.getState().status, secret: app.secretStorage.getSecret(`${id}-github-token`) };
		},
		pluginId,
		reply,
	);
}

export const sponsoring = (cents: number, oneTime = false) => ({
	status: 200,
	json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: oneTime, tier: { name: 'tier', monthlyPriceInCents: cents, isOneTime: oneTime } } } } },
});
