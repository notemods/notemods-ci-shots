import type { SponsorsConfig, SponsorsManager } from './license/index';
import { showProNotice } from './license/github-obsidian';

export const SPONSOR_MONTHLY_URL = 'https://github.com/sponsors/theluckystrike?metadata_source=word-count-property';
export const SPONSOR_ONE_TIME_URL = 'https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=word-count-property';

export const SPONSORS: SponsorsConfig = {
	clientId: 'Ov23lic5UPGPZqhBlBGg',
	sponsorLogin: 'theluckystrike',
	minMonthlyUsd: 5,
	oneTimeUsd: 15,
	oneTimeMonths: 0,
	scope: 'read:user',
};

export const PRO_UI = {
	proSummary: 'Pro adds a local reading preview with rendered-text and code display options.',
	priceText: 'Pro costs $15 one time or $5 a month.',
};

let manager: SponsorsManager | null = null;

export function bindPro(pro: SponsorsManager | null): void {
	manager = pro;
}

export function isPro(): boolean {
	return manager?.isPro() ?? false;
}

/** Shows the shared Pro notice: the lead, then the next step for this user. A free user gets a Sponsor on GitHub button. */
export function proNotice(lead: string): void {
	showProNotice(manager, lead);
}
