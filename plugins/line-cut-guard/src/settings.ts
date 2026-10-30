import { Platform, PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { helloSettingItems } from './hello/settings';
import { MODES, effectiveMode, type Mode } from './guard';
import { PRO_UI, isPro, proNotice } from './pro';
import type LineCutGuardPlugin from './main';

export interface LineCutGuardSettings {
	/** R1: what Ctrl/Cmd+X does when nothing is selected. */
	cut: Mode;
	/** R2: what Ctrl/Cmd+C does when nothing is selected. */
	copy: Mode;
	/** R3: show a notice when the plugin stops a cut or copy. */
	notice: boolean;
}

export const DEFAULT_SETTINGS: LineCutGuardSettings = {
	cut: 'block',
	copy: 'allow',
	notice: true,
};

function isMode(v: unknown): v is Mode {
	return typeof v === 'string' && (MODES as readonly string[]).includes(v);
}

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<LineCutGuardSettings> | null | undefined): LineCutGuardSettings {
	const s = saved ?? {};
	return {
		cut: isMode(s.cut) ? s.cut : DEFAULT_SETTINGS.cut,
		copy: isMode(s.copy) ? s.copy : DEFAULT_SETTINGS.copy,
		notice: typeof s.notice === 'boolean' ? s.notice : DEFAULT_SETTINGS.notice,
	};
}

/** The modifier key name on this platform. */
export function modKey(): string {
	return Platform.isMacOS ? 'Cmd' : 'Ctrl';
}

/** Setting names. The e2e tests find the rows by these names. */
export function names(mod = modKey()): { cut: string; copy: string; notice: string } {
	return {
		cut: `${mod}+X with nothing selected`,
		copy: `${mod}+C with nothing selected`,
		notice: 'Show a notice when a cut or copy is stopped',
	};
}

export const CUT_OPTIONS: Record<Mode, string> = {
	block: 'Does nothing',
	allow: 'Cuts the line (Obsidian default)',
	twice: 'Cuts the line on a second press (Pro)',
};

export const COPY_OPTIONS: Record<Mode, string> = {
	allow: 'Copies the line (Obsidian default)',
	block: 'Does nothing',
	twice: 'Copies the line on a second press (Pro)',
};

/** First sentence of the Pro notice when a free user picks the second press mode. */
export const PRO_LEAD = 'The second press mode is a Pro feature.';

export class LineCutGuardSettingTab extends PluginSettingTab {
	plugin: LineCutGuardPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: LineCutGuardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		const n = names();
		const mod = modKey();
		return [
			{
				name: n.cut,
				desc: `With no text selected, Obsidian cuts the whole line under the cursor. Choose what ${mod}+X does instead. Selected text is always cut as usual.`,
				control: { type: 'dropdown', key: 'cut', options: { ...CUT_OPTIONS }, defaultValue: DEFAULT_SETTINGS.cut },
			},
			{
				name: n.copy,
				desc: `With no text selected, Obsidian copies the whole line, and in Reading view the whole note. "Does nothing" keeps your clipboard as it is.`,
				control: { type: 'dropdown', key: 'copy', options: { ...COPY_OPTIONS }, defaultValue: DEFAULT_SETTINGS.copy },
			},
			{
				name: n.notice,
				desc: 'At most one notice in 2 seconds. The "press again" notice of the second press mode always shows.',
				control: { type: 'toggle', key: 'notice', defaultValue: DEFAULT_SETTINGS.notice },
			},
			{
				name: 'Pro features',
				desc: isPro()
					? `Pro is on: the second press mode works. The line is cut or copied when you press ${mod}+X or ${mod}+C again within 2 seconds.`
					: `Free version: ${mod}+X and ${mod}+C can do nothing when no text is selected, and the commands "Cut selection or line" and "Copy selection or line" do the line action. Pro adds a second press mode.`,
			},
			// The Pro group comes after the settings of the plugin.
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}

	getControlValue(key: string): unknown {
		// A free user sees the mode in effect. The stored choice stays for the time that Pro comes back.
		if (key === 'cut' || key === 'copy') return effectiveMode(this.plugin.settings[key], isPro());
		return super.getControlValue(key);
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if ((key === 'cut' || key === 'copy') && value === 'twice' && !isPro()) {
			// Free users can pick the Pro mode: the notice shows what Pro adds and how to get it. Nothing is saved.
			proNotice(PRO_LEAD);
			// Obsidian does not draw a control again while it has the focus. Move the focus out, then draw the tab
			// again, so the row shows the value in effect.
			const active = this.containerEl.ownerDocument.activeElement as HTMLElement | null;
			if (active && this.containerEl.contains(active)) active.blur();
			this.update();
			return;
		}
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		this.plugin.applySettings();
	}
}
