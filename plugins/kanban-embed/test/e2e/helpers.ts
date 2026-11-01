import { browser } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

// Helpers shared by the real-app checks of the kanban-embed code block.
export const DIR = 'Kanban Embed';
export const WEB = `${DIR}/Boards/Website redesign.md`;
export const MOBILE = `${DIR}/Boards/Mobile app.md`;
export const SPRINT = `${DIR}/Boards/Team sprint.md`;

export interface EmbedState {
	draws: number;
	lanes: string[];
	counts: string[];
	cards: number;
	over: number;
	notes: string[];
	title: string;
}

/** State of the newest embed that is on screen in the active tab. */
export async function embedState(): Promise<EmbedState | null> {
	return browser.executeObsidian(({ app }, id) => {
		interface E {
			draws: number;
			containerEl: HTMLElement;
		}
		const p = (app as unknown as { plugins: { plugins: Record<string, { embeds: Set<E> }> } }).plugins.plugins[id];
		const embeds = [...(p?.embeds ?? [])].filter((e) => e.containerEl.isConnected && e.containerEl.offsetParent !== null && e.draws > 0);
		const e = embeds[embeds.length - 1];
		if (!e) return null;
		const el = e.containerEl;
		const texts = (sel: string) => Array.from(el.querySelectorAll(sel)).map((x) => x.textContent?.trim() ?? '');
		return {
			draws: e.draws,
			lanes: texts('.kanban-embed-lane-title'),
			counts: texts('.kanban-embed-lane-count'),
			cards: el.querySelectorAll('.kanban-embed-card').length,
			over: el.querySelectorAll('.kanban-embed-lane.mod-over').length,
			notes: texts('.kanban-embed-note'),
			title: el.querySelector('.kanban-embed-title')?.textContent?.trim() ?? '',
		};
	}, pluginId);
}

export async function waitFor(pred: (s: EmbedState) => boolean, msg: string, timeout = 15000): Promise<EmbedState> {
	let last: EmbedState | null = null;
	await browser.waitUntil(
		async () => {
			last = await embedState();
			return last !== null && pred(last);
		},
		{ timeout, interval: 250, timeoutMsg: `${msg}; last state ${JSON.stringify(last)}` },
	);
	return last!;
}

export async function readFile(path: string): Promise<string> {
	return browser.executeObsidian(async ({ app }, p) => app.vault.read(app.vault.getFileByPath(p)!), path);
}

export async function writeFile(path: string, text: string): Promise<void> {
	await browser.executeObsidian(async ({ app }, p, t) => app.vault.modify(app.vault.getFileByPath(p)!, t), path, text);
}

/** Pro on: a stubbed GitHub Sponsors reply ($5 a month) and a fake token, then Refresh. Pro off: sign out. No real request. */
export async function setPro(on: boolean): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, id, value) => {
			interface Pro {
				opts: { http: unknown };
				refreshNow(): Promise<void>;
				signOut(): void;
				isPro(): boolean;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: Pro }> } }).plugins.plugins[id]!;
			if (!value) {
				p.pro.signOut();
				return;
			}
			const reply = { status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } };
			p.pro.opts.http = () => Promise.resolve(reply);
			// A sign out just before can still be clearing the stored token, so set it again until the check passes.
			for (let i = 0; i < 20 && !p.pro.isPro(); i++) {
				app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
				await p.pro.refreshNow();
				if (!p.pro.isPro()) await new Promise((r) => setTimeout(r, 100));
			}
			if (!p.pro.isPro()) throw new Error('Pro did not turn on with the stubbed sponsor reply');
		},
		pluginId,
		on,
	);
}

/** Opens the card menu of the card whose text starts with `text`, then clicks the menu item `item`. */
export async function cardMenu(text: string, item: string): Promise<void> {
	await browser.execute((t: string) => {
		const cards = Array.from(document.querySelectorAll<HTMLElement>('.workspace-leaf.mod-active .kanban-embed-card')).filter((x) => x.offsetParent !== null);
		const card = cards.find((c) => c.querySelector('.kanban-embed-card-body')?.textContent?.trim().startsWith(t));
		card?.querySelector<HTMLElement>('.kanban-embed-more')?.click();
	}, text);
	const menuItem = await browser.$(`//div[contains(@class,"menu-item")][.//div[contains(@class,"menu-item-title")][text()="${item}"]]`);
	await menuItem.waitForDisplayed({ timeout: 5000 });
	await menuItem.click();
}

export async function open(note: string): Promise<void> {
	await obsidianPage.openFile(`${DIR}/${note}`);
	// Reading view draws code blocks the same way as Live Preview, and is stable for clicks.
	await browser.executeObsidian(async ({ app }) => {
		const leaf = app.workspace.getMostRecentLeaf();
		const state = leaf?.getViewState();
		if (leaf && state) await leaf.setViewState({ ...state, state: { ...state.state, mode: 'preview' } });
	});
}

