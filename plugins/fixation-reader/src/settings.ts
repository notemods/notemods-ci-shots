import { PluginSettingTab, normalizePath, type Notice, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_LEADS, PRO_UI, isPro, proNotice } from './pro';
import type FixationReaderPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface FixationReaderSettings {
	enabled: boolean;
	strength: number;
	minimum: number;
	livePreview: boolean;
	excludedFolders: string;
	excludedTags: string;
	weight: number;
	color: string;
	endingOpacity: number;
}
export const DEFAULT_SETTINGS: FixationReaderSettings = {
	enabled: true, strength: 0.5, minimum: 3, livePreview: false,
	excludedFolders: '', excludedTags: '', weight: 700, color: '', endingOpacity: 1,
};

function number(value: unknown, fallback: number, min: number, max: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function normalizeSettings(saved: unknown): FixationReaderSettings {
	const s = saved && typeof saved === 'object' ? saved as Partial<FixationReaderSettings> : {};
	return {
		enabled: typeof s.enabled === 'boolean' ? s.enabled : true,
		strength: number(s.strength, 0.5, 0.2, 0.7),
		minimum: Math.round(number(s.minimum, 3, 1, 30)),
		livePreview: s.livePreview === true,
		excludedFolders: typeof s.excludedFolders === 'string' ? s.excludedFolders.split('\n').map((v) => v.trim() ? normalizePath(v.trim()) : '').join('\n') : '',
		excludedTags: typeof s.excludedTags === 'string' ? s.excludedTags : '',
		weight: Math.round(number(s.weight, 700, 400, 900)),
		color: typeof s.color === 'string' && /^#[\da-f]{6}$/i.test(s.color) ? s.color : '',
		endingOpacity: number(s.endingOpacity, 1, 0.3, 1),
	};
}

export class FixationReaderSettingTab extends PluginSettingTab {
	plugin: FixationReaderPlugin;
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: FixationReaderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Enable fixation', desc: 'Bold word starts in Reading view.', control: { type: 'toggle', key: 'enabled', defaultValue: true } },
			{ name: 'Fixation strength', desc: 'Share of letters to bold, from 0.2 to 0.7. The count rounds to the nearest letter.', control: { type: 'slider', key: 'strength', defaultValue: 0.5, min: 0.2, max: 0.7, step: 0.05 } },
			{ name: 'Minimum word length', desc: 'Words with fewer letters stay unchanged, from 1 to 30.', control: { type: 'slider', key: 'minimum', defaultValue: 3, min: 1, max: 30, step: 1 } },
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{ type: 'group', heading: 'Live Preview (Pro)', items: [
				{ name: 'Enable in Live Preview', desc: 'Show word starts while you edit. Source mode stays unchanged.', control: { type: 'toggle', key: 'livePreview', defaultValue: false } },
			] },
			{ type: 'group', heading: 'Folder and tag rules (Pro)', items: [
				{ name: 'Excluded folders', desc: 'One vault folder per line. Includes its subfolders. Paths are case sensitive.', control: { type: 'textarea', key: 'excludedFolders', defaultValue: '' } },
				{ name: 'Excluded tags', desc: 'Exact tags, separated by commas or new lines. A leading # is optional. Case does not matter.', control: { type: 'textarea', key: 'excludedTags', defaultValue: '' } },
			] },
			{ type: 'group', heading: 'Custom style (Pro)', items: [
				{ name: 'Word start weight', desc: 'Font weight from 400 to 900. Your font controls the result.', control: { type: 'slider', key: 'weight', defaultValue: 700, min: 400, max: 900, step: 100 } },
				{ name: 'Word start color', desc: 'A six digit hex color, such as #527a99. Empty uses the text color.', control: { type: 'text', key: 'color', defaultValue: '' } },
				{ name: 'Ending opacity', desc: 'From 0.3 to 1. A value of 1 keeps the word ending at full opacity.', control: { type: 'slider', key: 'endingOpacity', defaultValue: 1, min: 0.3, max: 1, step: 0.05 } },
			] },
		];
	}
	/** The last Pro notice of this tab. A second notice does not show while it is open. */
	private notice: Notice | null = null;

	getControlValue(key: string): unknown {
		// A free user sees the values in effect without Pro. The stored choice stays for the time that Pro comes back.
		if (PRO_LEADS[key] !== undefined && !isPro()) return DEFAULT_SETTINGS[key as keyof FixationReaderSettings];
		return super.getControlValue(key);
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (!['enabled', 'strength', 'minimum'].includes(key) && !isPro()) {
			// A free user selected a Pro setting: tell how to get Pro and save nothing.
			const lead = PRO_LEADS[key];
			if (lead && !this.notice?.messageEl.isConnected) this.notice = proNotice(lead);
			// Obsidian does not draw a control again while it has the focus. Move the focus out, then draw the tab
			// again, so the control shows the value in effect.
			const active = this.containerEl.ownerDocument.activeElement as HTMLElement | null;
			if (active && this.containerEl.contains(active)) active.blur();
			this.update();
			return;
		}
		this.plugin.settings = normalizeSettings({ ...this.plugin.settings, [key]: value });
		await this.plugin.saveSettings();
	}
}
