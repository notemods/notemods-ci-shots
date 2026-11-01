import { PluginSettingTab, type Notice, type SettingDefinitionItem } from 'obsidian';
import { redrawKeepFocus, sponsorsSettingItems } from './license/github-obsidian';
import { helloSettingItems } from './hello/settings';
import { PRO_UI, isPro, proNotice } from './pro';
import type { ParseOptions } from './markup';
import type WikilinkAliasMarkupPlugin from './main';

export interface WikilinkAliasMarkupSettings {
	/** Show markup in Live Preview. Reading view always shows it. */
	livePreview: boolean;
	/** Pro: show `$...$` in an alias as math. */
	math: boolean;
}

export const DEFAULT_SETTINGS: WikilinkAliasMarkupSettings = {
	livePreview: true,
	math: true,
};

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<WikilinkAliasMarkupSettings> | null | undefined): WikilinkAliasMarkupSettings {
	const s = saved ?? {};
	return {
		livePreview: typeof s.livePreview === 'boolean' ? s.livePreview : DEFAULT_SETTINGS.livePreview,
		math: typeof s.math === 'boolean' ? s.math : DEFAULT_SETTINGS.math,
	};
}

export interface Options extends ParseOptions {
	livePreview: boolean;
}

/** The settings in effect. Without Pro, math stays text. */
export function effectiveOptions(settings: WikilinkAliasMarkupSettings, pro: boolean): Options {
	return { livePreview: settings.livePreview, math: pro && settings.math };
}

/** First sentences of the Pro notices. A free user who selects a Pro setting gets the notice; the value is not saved. */
export const PRO_LEADS: Partial<Record<keyof WikilinkAliasMarkupSettings, string>> = {
	math: 'Math in aliases is a Pro feature.',
};

export class WikilinkAliasMarkupSettingTab extends PluginSettingTab {
	/** The last Pro notice of this tab and its lead. The same notice does not show again while it is open. */
	private notice: Notice | null = null;
	private noticeLead = '';
	plugin: WikilinkAliasMarkupPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: WikilinkAliasMarkupPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Show markup in Live Preview',
				desc: 'Show the markup of an alias in Live Preview too. When the cursor is in the link, you see the source. Reading view always shows the markup.',
				control: { type: 'toggle', key: 'livePreview', defaultValue: DEFAULT_SETTINGS.livePreview },
			},
			{
				name: 'Math in aliases',
				desc: 'Pro. Show $...$ in an alias as math, for example [[Ammonia|$NH_3$]]. The free version shows the dollar signs as text, as Obsidian does.',
				control: { type: 'toggle', key: 'math', defaultValue: DEFAULT_SETTINGS.math },
			},
			{
				name: 'Pro features',
				desc: isPro()
					? 'Pro is on: math in aliases works.'
					: 'Free version: inline code, bold, italic, strikethrough and highlight in aliases, in Reading view and Live Preview. Pro adds math in aliases.',
			},
			// The Pro group comes after the settings of the plugin.
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}

	getControlValue(key: string): unknown {
		// A free user sees the value in effect. The stored choice stays for the time that Pro comes back.
		if (key === 'math' && !isPro()) return false;
		return super.getControlValue(key);
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const lead = PRO_LEADS[key as keyof WikilinkAliasMarkupSettings];
		if (lead && !isPro()) {
			// Free users can select the Pro setting: the notice shows what Pro adds and how to get it. Nothing is saved.
			if (!this.notice?.messageEl.isConnected || this.noticeLead !== lead) {
				this.notice = proNotice(lead);
				this.noticeLead = lead;
			}
			// Obsidian does not draw a control again while it has the focus. Move the focus out, then draw the tab
			// again, so the row shows the value in effect.
			redrawKeepFocus(this);
			return;
		}
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		this.plugin.redrawAll();
	}
}
