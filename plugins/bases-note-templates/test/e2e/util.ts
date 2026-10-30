// Helpers for the end-to-end specs: plugin setup, Pro with a stubbed network, the core New button, files.
import { browser } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

export const TOKEN_ID = `${pluginId}-github-token`;
const FAKE_TOKEN = `gho_${'0'.repeat(36)}`;
const SPONSOR_REPLY = { status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } };

export interface BaseSetup {
	templates?: string[];
	folder?: string;
	pattern?: string;
	onNew?: boolean;
	views?: Record<string, string>;
}

interface PluginLike {
	settings: Record<string, unknown>;
	saveSettings(): Promise<void>;
	refreshButtons(): void;
	isPro?: () => boolean;
	pro: { opts: { http: unknown }; refreshNow(): Promise<void>; signOut(): void; isPro(): boolean };
}

/** Replaces the plugin settings: bases maps a base path to its setup. */
export async function configure(bases: Record<string, BaseSetup>, extra: Record<string, unknown> = {}): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, id, b, x) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, PluginLike> } }).plugins.plugins[id]!;
			p.settings = { bases: b, hookNew: true, dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm', templater: true, ...x };
			await p.saveSettings();
			p.refreshButtons();
		},
		pluginId,
		bases,
		extra,
	);
}

/** Turns Pro on (stubbed GitHub reply, fake token in the real SecretStorage) or off (sign out). */
export async function setPro(on: boolean): Promise<boolean> {
	return browser.executeObsidian(
		async ({ app }, id, tokenId, token, reply, want) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, PluginLike> } }).plugins.plugins[id]!;
			if (!want) {
				p.pro.signOut();
				return p.pro.isPro();
			}
			p.pro.opts.http = () => Promise.resolve(reply);
			app.secretStorage.setSecret(tokenId, token);
			await p.pro.refreshNow();
			return p.pro.isPro();
		},
		pluginId,
		TOKEN_ID,
		FAKE_TOKEN,
		SPONSOR_REPLY,
		on,
	);
}

/** Opens a base in a new tab and switches it to one of its views. */
export async function openBase(path: string, view?: string): Promise<void> {
	await obsidianPage.openFile(path);
	if (view) {
		await browser.executeObsidian(async ({ app }, v) => {
			const leaf = app.workspace.getMostRecentLeaf()!;
			const state = leaf.getViewState();
			await leaf.setViewState({ ...state, state: { ...(state.state ?? {}), viewName: v } });
		}, view);
	}
	await browser.pause(800);
}

/** Clicks the core New button of the base in the active tab. */
export async function pressNew(): Promise<void> {
	const btn = await browser.$('.workspace-leaf.mod-active .bases-toolbar-new-item-menu .text-icon-button, .workspace-leaf.mod-active .bases-toolbar-new-item-menu button, .workspace-leaf.mod-active .bases-toolbar-new-item-menu > *');
	await btn.click();
}

/** Markdown files in a folder (direct children), sorted. */
export async function filesIn(folder: string): Promise<string[]> {
	return browser.executeObsidian(({ app }, f) => app.vault.getMarkdownFiles().filter((x) => (x.parent?.path ?? '') === f).map((x) => x.path).sort(), folder);
}

/** Waits until a new file shows up in the folder and its text satisfies ok. Returns path and text. */
export async function waitForNew(folder: string, before: string[], ok: (text: string, path: string) => boolean, timeout = 8000): Promise<{ path: string; text: string }> {
	let found = { path: '', text: '' };
	await browser.waitUntil(
		async () => {
			for (const path of await filesIn(folder)) {
				if (before.includes(path)) continue;
				const text = await obsidianPage.read(path);
				found = { path, text };
				if (ok(text, path)) return true;
			}
			return false;
		},
		{ timeout, timeoutMsg: `no matching new file in ${folder}; last seen ${JSON.stringify(found)}` },
	);
	return found;
}

/** Frontmatter of a file as the app parses it. */
export async function frontmatter(path: string): Promise<Record<string, unknown>> {
	return browser.executeObsidian(async ({ app, obsidian }, p) => {
		const text = await app.vault.adapter.read(p);
		const m = /^---\n([\s\S]*?)\n?---/.exec(text);
		return m ? ((obsidian.parseYaml(m[1] ?? '') as Record<string, unknown> | null) ?? {}) : {};
	}, path);
}

/** Closes popovers, modals and tabs left over from a test. */
export async function cleanUp(): Promise<void> {
	await browser.keys(['Escape']);
	await browser.executeObsidian(({ app }) => {
		document.querySelectorAll('.modal-close-button').forEach((b) => (b as HTMLElement).click());
		app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.getViewState().type !== 'empty') leaf.detach();
		});
	});
	await browser.pause(300);
}

/** Local date as YYYY-MM-DD in the app. */
export async function today(): Promise<string> {
	return browser.executeObsidian(() => {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	});
}
