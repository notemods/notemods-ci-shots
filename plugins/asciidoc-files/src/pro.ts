// Pro through GitHub Sponsors (packages/license, github.ts). product.yaml pro: holds the same values; fx check compares them.
import type { SponsorsConfig, SponsorsManager } from './license/index';

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
	proSummary: 'Pro resolves include directives from the vault, adds the outline and links panel, and exports HTML files.',
	priceText: 'Sponsor $5 a month, or $15 once. When you have paid $15 in total, Pro stays on.',
};

// The one facade every Pro check goes through (Phase 4 rule). main.ts binds the manager in onload.
let manager: SponsorsManager | null = null;

export function bindPro(pro: SponsorsManager | null): void {
	manager = pro;
}

/** Pro from the cached GitHub Sponsors answer. Never sends a request. */
export function isPro(): boolean {
	return manager?.isPro() ?? false;
}

/** Calls cb when the Pro state changes; returns the unsubscribe function. */
export function onProChange(cb: () => void): () => void {
	return manager ? manager.onChange(cb) : () => undefined;
}
