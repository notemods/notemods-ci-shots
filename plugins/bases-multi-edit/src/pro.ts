// Pro through GitHub Sponsors (packages/license, github.ts). product.yaml pro: holds the same values; fx check compares them.
// This file is the one Pro facade: every Pro check in the plugin calls isPro() or onProChange().
import type { SponsorsConfig, SponsorsManager } from './license/index';
import { showProNotice } from './license/github-obsidian';

export const SPONSORS: SponsorsConfig = {
	// Public client id of the seller's OAuth App (device flow on, no client secret anywhere).
	clientId: 'Ov23lic5UPGPZqhBlBGg',
	sponsorLogin: 'theluckystrike',
	minMonthlyUsd: 5,
	oneTimeUsd: 15,
	// 0 = a one-time sponsorship turns Pro on for life.
	oneTimeMonths: 0,
	// Read-only profile access: the sponsorship tier fields need it. No repository or write access.
	scope: 'read:user',
};

export const PRO_UI = {
 proSummary: 'Pro adds saved bulk actions and 20 session undo batches.',
 priceText: '$15 one time or $5 a month.',
};

let manager: SponsorsManager | null = null;

/** Connects the facade to the plugin's GitHub Sponsors state (main.ts onload). */
export function bindPro(m: SponsorsManager | null): void {
	manager = m;
}

/** Pro from the cached GitHub Sponsors answer. Never sends a request. */
export function isPro(): boolean {
	return manager?.isPro() ?? false;
}

/** Calls cb after every change of the Pro state. Returns the function that removes cb. */
export function onProChange(cb: () => void): () => void {
	return manager ? manager.onChange(cb) : () => undefined;
}

/** Lead of the Pro notice for Save action and the saved action picker. */
export const SAVE_LEAD = 'Saved bulk actions need Pro.';
/** Lead of the Pro notice when a free apply drops the earlier undo batch. */
export const UNDO_LEAD = 'Undo of more than one batch needs Pro. The earlier batch can no longer be undone.';

/** Shows the shared Pro notice: the lead, then the next step for this user. A free user gets a Sponsor on GitHub button. */
export function proNotice(lead: string): void {
	showProNotice(manager, lead);
}
