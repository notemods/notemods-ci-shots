// Settings for Fold Stop. The vault toggle is free. Folder rules and the note override are Pro.
import { PluginSettingTab, type Setting, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_FOLDERS, PRO_OVERRIDE, PRO_UI, isPro, proNotice } from './pro';
import { effectiveRuleForPath, normalizeFolders, type EffectiveRule, type FolderRuleEntry } from './rules';
import type HrFoldStopPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface HrFoldStopSettings {
	/** Fold Stop on for the whole vault. Free. */
	enabled: boolean;
	/** Stop folds at `%% fold-stop %%` end markers. Free. */
	endMarkers: boolean;
	/** Pro: folder rules, longest matching path wins. */
	folders: FolderRuleEntry[];
	/** Pro: note property name that overrides a folder rule. Empty = no note override. */
	overrideProperty: string;
}

export const DEFAULT_SETTINGS: HrFoldStopSettings = {
	enabled: true,
	endMarkers: true,
	folders: [],
	overrideProperty: 'fold-stop',
};

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<HrFoldStopSettings> | null | undefined): HrFoldStopSettings {
	const s = saved ?? {};
	return {
		enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_SETTINGS.enabled,
		endMarkers: typeof s.endMarkers === 'boolean' ? s.endMarkers : DEFAULT_SETTINGS.endMarkers,
		folders: normalizeFolders(s.folders),
		overrideProperty: typeof s.overrideProperty === 'string' ? s.overrideProperty.trim() : DEFAULT_SETTINGS.overrideProperty,
	};
}

/** The rule the editor extension reads. Pro off = folders empty and no override. */
export function effectiveRuleOf(settings: HrFoldStopSettings): EffectiveRule {
	const pro = isPro();
	return {
		vaultEnabled: settings.enabled,
		folders: pro ? settings.folders : [],
		overrideProperty: pro ? settings.overrideProperty : '',
	};
}

/** One line of text for the effective-rule panel. */
export function describeRule(active: boolean, source: string, folder: string | null): string {
	const place = source === 'note' ? 'the note property' : source === 'folder' && folder ? `folder ${folder}` : 'the vault toggle';
	return `Fold Stop ${active ? 'on' : 'off'} for this note (${place}).`;
}

export class HrFoldStopSettingTab extends PluginSettingTab {
	plugin: HrFoldStopPlugin;
	private effectiveSetting: Setting | null = null;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: HrFoldStopPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{
				name: 'Stop folds at horizontal rules',
				desc: 'Stop heading folds before the first top-level horizontal rule, so the next section stays visible.',
				control: { type: 'toggle', key: 'enabled', defaultValue: DEFAULT_SETTINGS.enabled },
			},
			{
				name: 'Stop folds at end markers',
				desc: 'Stop heading folds before a %% fold-stop %% line. Add a digit, as in %% fold-stop 4 %%, to stop only headings of that level and deeper.',
				control: { type: 'toggle', key: 'endMarkers', defaultValue: DEFAULT_SETTINGS.endMarkers },
			},
			{
				name: 'Folder rules (Pro)',
				desc: 'Use a vault folder path. The longest matching path wins. Paths are case sensitive.',
				render: setting => {
					// Free users can select the Pro controls: they show what Pro adds and how to get it, and change no setting.
					setting.addButton(button => button.setButtonText('Add folder').onClick(async () => {
						if (!isPro()) { proNotice(PRO_FOLDERS); return; }
						this.plugin.settings.folders.push({ folder: '', enabled: true });
						this.update();
					}));
				},
			},
			...this.plugin.settings.folders.map((rule, index): SettingDefinitionItem => ({
				name: `Folder ${index + 1} (Pro)`,
				render: setting => {
					setting.addText(text => text.setPlaceholder('Folder path').setValue(rule.folder).onChange(async value => {
						if (!isPro()) { this.refuse(PRO_FOLDERS, text.inputEl); return; }
						rule.folder = value.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
						await this.plugin.saveSettings();
					}));
					setting.addToggle(toggle => toggle.setValue(rule.enabled).onChange(async value => {
						if (!isPro()) { this.refuse(PRO_FOLDERS); return; }
						rule.enabled = value;
						await this.plugin.saveSettings();
						this.update();
					}));
					setting.addButton(button => button.setButtonText('Remove').onClick(async () => {
						if (!isPro()) { proNotice(PRO_FOLDERS); return; }
						this.plugin.settings.folders.splice(index, 1);
						await this.plugin.saveSettings();
						this.update();
					}));
				},
			})),
			{
				name: 'Override property (Pro)',
				desc: 'A Boolean note property takes priority over folder and vault rules. Text values do not apply.',
				render: setting => { setting.addText(text => text.setValue(this.plugin.settings.overrideProperty).onChange(async value => {
					if (!isPro()) { this.refuse(PRO_OVERRIDE, text.inputEl); return; }
					this.plugin.settings.overrideProperty = value.trim();
					await this.plugin.saveSettings();
				})); },
			},
			{
				name: 'Effective rule (Pro)',
				desc: this.effectiveDescription(),
				visible: () => isPro(),
				render: setting => {
					this.effectiveSetting = setting;
					setting.setDesc(this.effectiveDescription());
					return () => { if (this.effectiveSetting === setting) this.effectiveSetting = null; };
				},
			},
		];
	}

	/** A free user changed a Pro field: show the notice, save nothing, and draw the stored values again. A text field loses the focus, so one edit gives one notice. */
	private refuse(lead: string, input?: HTMLInputElement): void {
		input?.blur();
		proNotice(lead);
		this.update();
	}

	refreshEffectiveRule(): void {
		this.effectiveSetting?.setDesc(this.effectiveDescription());
	}

	effectiveDescription(): string {
		const path = this.app.workspace.getActiveFile()?.path;
		if (!path) return 'Open a note to see its rule.';
		if (this.plugin.restoredNotes.has(path)) return `${path}: normal folding from the restore command.`;
		const config = this.plugin.editorConfig(path);
		const decision = effectiveRuleForPath(config.rule, path, config.noteOverride);
		return `${path}: ${describeRule(decision.active, decision.source, decision.folder?.folder ?? null)}`;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		await this.plugin.saveSettings();
		this.plugin.reconfigure();
	}
}
