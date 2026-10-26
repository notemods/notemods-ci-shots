import type { SponsorsConfig } from './license/index';

// Public OAuth client id. Device flow needs no client secret.
export const SPONSORS: SponsorsConfig = {
	clientId: 'Ov23lic5UPGPZqhBlBGg',
	sponsorLogin: 'theluckystrike',
	minMonthlyUsd: 5,
	oneTimeUsd: 15,
	oneTimeMonths: 0,
	scope: 'read:user',
};
export const PRO_UI = {
	proSummary: 'Pro adds one-click renames, automatic scans with a status count, and report notes.',
	priceText: 'Sponsor $5 a month, or $15 once. When you have paid $15 in total, Pro stays on.',
};
