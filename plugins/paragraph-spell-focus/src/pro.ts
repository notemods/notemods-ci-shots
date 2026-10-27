// Pro through GitHub Sponsors (packages/license, github.ts). product.yaml pro: holds the same values; fx check compares them.
// The plugin uses its SponsorsManager to guard Pro scopes and folder rules.
import type { Notice } from 'obsidian';
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
	proSummary: 'Pro adds section spelling focus and saved folder rules.',
	priceText: 'Sponsor $5 a month, or $15 once. When you have paid $15 in total, Pro stays on.',
};


/** Leads of the Pro notices of the settings. */
export const PRO_SCOPE = 'Section spelling focus needs Pro.';
export const PRO_RULES = 'Folder rules need Pro.';

/** Shows the shared Pro notice: the lead, then the next step for this user. A free user gets a Sponsor on GitHub button. */
export function proNotice(pro: SponsorsManager | null, lead: string): Notice | null {
	return showProNotice(pro, lead);
}
