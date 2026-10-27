import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { DEFAULT_LAYOUT, validateLayout, type Layout } from './importer';
import { PRO_UI } from './pro';
import type RemNoteJsonImportPlugin from './main';
import { helloSettingItems } from './hello/settings';
export interface Preset { name: string; layout: Layout }
export interface ImportSettings { folder: string; presets: Preset[]; snapshot: Record<string, string> | null }
export const DEFAULT_SETTINGS: ImportSettings = { folder: DEFAULT_LAYOUT.folder, presets: [], snapshot: null };
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function normalizeSettings(value: unknown): ImportSettings {
 const saved = record(value) ? value : {};
 let folder = DEFAULT_LAYOUT.folder;
 try { if (typeof saved.folder === 'string') folder = validateLayout({ ...DEFAULT_LAYOUT, folder: saved.folder }).folder; } catch { /* Keep the default folder. */ }
 const presets: Preset[] = [];
 if (Array.isArray(saved.presets)) for (const item of saved.presets.slice(0, 10) as unknown[]) {
  if (!record(item) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 40 || !record(item.layout)) continue;
  try { presets.push({ name: item.name.trim(), layout: validateLayout(item.layout as unknown as Layout) }); } catch { /* Omit invalid presets. */ }
 }
 let snapshot: Record<string, string> | null = null;
 if (record(saved.snapshot) && Object.keys(saved.snapshot).length <= 25000 && Object.values(saved.snapshot).every(v => typeof v === 'string')) snapshot = Object.fromEntries(Object.entries(saved.snapshot)) as Record<string, string>;
 return { folder, presets, snapshot };
}
export class ImportSettingTab extends PluginSettingTab {
 constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], readonly importer: RemNoteJsonImportPlugin) { super(app, importer); }
 getSettingDefinitions(): SettingDefinitionItem[] {
 	// The product rows, then the "More from NoteMods" card (packages/hello).
 	return [...this.productSettingDefinitions(), ...helloSettingItems()];
 }

 productSettingDefinitions(): SettingDefinitionItem[] {
  return [
   { name: 'Default import folder', desc: 'Each import needs a new folder. Change the folder in the import window if it exists.', control: { type: 'text', key: 'folder', defaultValue: DEFAULT_LAYOUT.folder } },
   { name: 'Local import data', desc: 'Presets and the last complete import snapshot are stored in this vault’s plugin data. The snapshot contains source records.', render: setting => { setting.addButton(button => button.setButtonText('Clear snapshot').onClick(async () => { this.importer.settings.snapshot = null; await this.importer.saveSettings(); this.update(); })); } },
   ...(this.importer.pro ? sponsorsSettingItems(this.importer.pro, PRO_UI) : []),
  ];
 }
 async setControlValue(key: string, value: unknown): Promise<void> {
  if (key === 'folder' && typeof value === 'string') validateLayout({ ...DEFAULT_LAYOUT, folder: value });
  await super.setControlValue(key, value);
 }
}
