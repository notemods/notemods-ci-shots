import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI, isPro } from './pro';
import type SyncChurnWatchPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface SyncChurnWatchSettings { threshold: number; alerts: boolean }
export const DEFAULT_SETTINGS: SyncChurnWatchSettings = { threshold: 120, alerts: false };
export function normalizeSettings(saved: unknown): SyncChurnWatchSettings {
	const s = saved && typeof saved === 'object' ? saved as Partial<SyncChurnWatchSettings> : {};
	return {
		threshold: typeof s.threshold === 'number' && Number.isFinite(s.threshold) ? Math.min(100_000, Math.max(1, Math.round(s.threshold))) : DEFAULT_SETTINGS.threshold,
		alerts: typeof s.alerts === 'boolean' ? s.alerts : DEFAULT_SETTINGS.alerts,
	};
}
export class SyncChurnWatchSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], readonly owner: SyncChurnWatchPlugin) { super(app, owner); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Write rate notices (Pro)', desc: 'Show one notice per file per session above the threshold. Rates use at least one minute.', control: { type: 'toggle', key: 'alerts', defaultValue: false, disabled: () => !isPro() } },
			{ name: 'Writes per hour threshold (Pro)', desc: 'From 1 to 100,000. Changes are saved when you stop a session.', control: { type: 'number', key: 'threshold', defaultValue: 120, disabled: () => !isPro(), validate: (n) => Number.isFinite(n) && n >= 1 && n <= 100_000 ? undefined : 'Use a number from 1 to 100,000.' } },
			{ name: 'Local storage', desc: 'Session data and changes to these controls are saved only when a session stops. An unfinished session is lost on unload.' },
			...(this.owner.pro ? sponsorsSettingItems(this.owner.pro, PRO_UI) : []),
		];
	}
	setControlValue(key: string, value: unknown): void {
		if (!isPro() || !['alerts', 'threshold'].includes(key)) return;
		this.owner.settings = normalizeSettings({ ...this.owner.settings, [key]: value });
		this.owner.redraw();
	}
}
