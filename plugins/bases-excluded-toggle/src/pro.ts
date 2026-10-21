import type { SponsorsConfig, SponsorsManager } from './license/index';

export const SPONSORS: SponsorsConfig = {
	clientId: 'Ov23lic5UPGPZqhBlBGg',
	sponsorLogin: 'theluckystrike',
	minMonthlyUsd: 5,
	oneTimeUsd: 15,
	oneTimeMonths: 0,
	scope: 'read:user',
};

export const PRO_UI = {
	proSummary: 'Pro adds named exclusion presets that you can save and apply from plugin settings.',
	priceText: 'Sponsor $5 a month, or $15 once. When you have paid $15 in total, Pro stays on.',
};

let manager: SponsorsManager | null = null;

export function bindPro(value: SponsorsManager | null): void {
	manager = value;
}

export function isPro(): boolean {
	return manager?.isPro() ?? false;
}

export function onProChange(callback: () => void): () => void {
	return manager ? manager.onChange(callback) : () => undefined;
}
