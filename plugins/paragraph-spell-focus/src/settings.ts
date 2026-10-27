import { PluginSettingTab, type Notice, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_RULES, PRO_SCOPE, PRO_UI, proNotice } from './pro';
import { parseRules } from './policy';
import type ParagraphSpellFocusPlugin from './main';
import { helloSettingItems } from './hello/settings';

export class ParagraphSpellFocusSettingTab extends PluginSettingTab {
 constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], public plugin: ParagraphSpellFocusPlugin) { super(app, plugin); }
 getSettingDefinitions(): SettingDefinitionItem[] {
  // The product rows, then the "More from NoteMods" card (packages/hello).
  return [...this.productSettingDefinitions(), ...helloSettingItems()];
 }

 productSettingDefinitions(): SettingDefinitionItem[] {
  const p = this.plugin;
  return [
   { name: 'Paragraph spelling focus', desc: 'Keep native spellcheck in the paragraph with the caret. Enable the native spelling option first.', control: { type: 'toggle', key: 'enabled', defaultValue: true } },
   { name: 'Mark the active range', desc: 'Use a subtle background for the paragraph or section being edited.', control: { type: 'toggle', key: 'highlight', defaultValue: true } },
   { name: 'Focus scope (Pro)', desc: 'Section uses the nearest heading and stops at the next heading of the same or a higher level.', control: { type: 'dropdown', key: 'scope', defaultValue: 'paragraph', options: { paragraph: 'Paragraph', section: 'Section' } } },
   { name: 'Folder rules (Pro)', desc: 'One rule per line: Drafts=section, Notes=paragraph, or Code=off. The most specific folder wins. Off restores normal native spelling in that folder.', render: s => {
    // A free user sees the rules in effect: none. A typed rule goes back to empty and shows the Pro notice.
    s.addTextArea(area => area.setValue(p.pro?.isPro() ? p.settings.rules.map(r => `${r.folder}=${r.scope}`).join('\n') : '').setPlaceholder('Drafts=section').onChange(async value => {
     if (!p.pro?.isPro()) { area.setValue(''); this.refuse(PRO_RULES); return; }
     p.settings.rules = parseRules(value);
     await p.saveSettings();
    }));
   } },
   ...(p.pro ? sponsorsSettingItems(p.pro, PRO_UI) : []),
  ];
 }
 /** The last Pro notice of this tab. A second notice does not show while it is open. */
 private notice: Notice | null = null;
 private refuse(lead: string): void { if (!this.notice?.messageEl.isConnected) this.notice = proNotice(this.plugin.pro, lead); }
 getControlValue(key: string): unknown {
  // A free user sees the scope in effect: Paragraph. The stored choice stays for the time that Pro comes back.
  if (key === 'scope' && !this.plugin.pro?.isPro()) return 'paragraph';
  return super.getControlValue(key);
 }
 async setControlValue(key: string, value: unknown): Promise<void> {
  if ((key === 'scope' || key === 'rules') && !this.plugin.pro?.isPro()) {
   // A free user selected a Pro setting: tell how to get Pro and save nothing. Move the focus out, then draw the tab
   // again, so the control shows the value in effect (Obsidian does not draw a focused control again).
   this.refuse(PRO_SCOPE);
   const active = this.containerEl.ownerDocument.activeElement as HTMLElement | null;
   if (active && this.containerEl.contains(active)) active.blur();
   this.update();
   return;
  }
  await super.setControlValue(key, value);
  await this.plugin.saveSettings();
 }
}
