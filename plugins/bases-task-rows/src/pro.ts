// Pro through GitHub Sponsors (packages/license, github.ts). product.yaml pro: holds the same values; fx check compares them.
// Every Pro check in this plugin goes through isPro() and onProChange() below.
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
	proSummary: 'Pro shows every task past 200, groups rows by note, heading, tag or date, edits due dates in the row, completes or moves many tasks to today at once, writes the next occurrence of a recurring task, and counts several tags in the Task progress view.',
	priceText: 'Sponsor $5 a month, or $15 once. When you have paid $15 in total, Pro stays on.',
};

let source: SponsorsManager | null = null;

/** main.ts hands the Sponsors state over once in onload, and null in onunload. */
export function setProSource(manager: SponsorsManager | null): void {
	source = manager;
}

/** Pro from the cached GitHub Sponsors answer. Never sends a request. */
export function isPro(): boolean {
	return source?.isPro() ?? false;
}

/** Calls cb when Pro turns on or off. Returns the function that stops it. */
export function onProChange(cb: () => void): () => void {
	return source ? source.onChange(cb) : () => undefined;
}

/** Shows the shared Pro notice: the lead, then the next step for this user. A free user gets a Sponsor on GitHub button. */
export function proNotice(lead: string): void {
	showProNotice(source, lead);
}
