import type { SponsorsConfig, SponsorsManager } from './license/index';

export const SPONSORS: SponsorsConfig = {
	clientId: 'Ov23lic5UPGPZqhBlBGg',
	sponsorLogin: 'theluckystrike',
	minMonthlyUsd: 5,
	oneTimeUsd: 15,
	oneTimeMonths: 0,
	scope: 'read:user',
};

export const PRO_ONE_TIME_URL = 'https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=bases-date-backlinks';

export const PRO_UI = {
	proSummary: 'Pro adds week and month rollups, extra date properties, and inclusive date ranges.',
	priceText: 'Sponsor $5 a month, or $15 once. When you have paid $15 in total, Pro stays on.',
};

let manager: SponsorsManager | null = null;
let unbind: (() => void) | null = null;
const listeners = new Set<() => void>();

export function bindPro(value: SponsorsManager | null): void {
	unbind?.();
	manager = value;
	unbind = value?.onChange(() => {
		for (const listener of [...listeners]) listener();
	}) ?? null;
}

export function isPro(): boolean {
	return manager?.isPro() ?? false;
}

export function onProChange(callback: () => void): () => void {
	listeners.add(callback);
	return () => listeners.delete(callback);
}

export function resetPro(): void {
	unbind?.();
	unbind = null;
	manager = null;
	listeners.clear();
}
