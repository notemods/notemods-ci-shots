import { Modal, Notice, Setting } from 'obsidian';
import type VimwikiImportPlugin from './main';
import type { Plan } from './importer';
export class ImportModal extends Modal {
	plan: Plan | null = null;
	private source: string;
	private destination: string;
	private diary: string;
	private mode=false;
	private closed=false;
	constructor(private plugin: VimwikiImportPlugin) {super(plugin.app); this.source=plugin.settings.source;this.destination=plugin.settings.destination;this.diary=plugin.settings.diary;}
	onOpen(): void {this.closed=false;this.render();}
	onClose(): void {this.closed=true;this.plan=null;this.contentEl.empty();}
	private render(): void {
		const el=this.contentEl;el.empty();this.setTitle(this.plan ? 'Review Vimwiki conversion' : 'Import default Vimwiki');this.modalEl.addClass('vimwiki-import-modal');
		if (!this.plan) {
			el.createEl('p',{text:'Select .wiki files already in this vault. Sources stay unchanged. Use a new destination folder.'});
			new Setting(el).setName('Source folder').addText(t=>t.setValue(this.source).onChange(v=>this.source=v));
			new Setting(el).setName('New destination folder').addText(t=>t.setValue(this.destination).onChange(v=>this.destination=v));
			new Setting(el).setName('Daily-note folder (pro)').setDesc('Optional. Map diary/YYYY-MM-DD.wiki to this folder.').addText(t=>t.setValue(this.diary).onChange(v=>this.diary=v));
			new Setting(el).setName('These files use default syntax').setDesc('Markdown and media modes are not supported.').addToggle(t=>t.setValue(this.mode).onChange(v=>this.mode=v));
			new Setting(el).addButton(b=>b.setButtonText('Cancel').onClick(()=>this.close())).addButton(b=>b.setButtonText('Preview').setCta().onClick(async()=>{
				if(!this.mode) {new Notice('Select default syntax first.');return;}
				b.setDisabled(true);
				try {const plan=await this.plugin.preview(this.source,this.destination,this.diary);if(this.closed)return;this.plan=plan;this.render();}
				catch(e){new Notice(String(e));b.setDisabled(false);}
			}));return;
		}
		const plan=this.plan;
		el.createEl('p',{text:`${plan.pages.length} ${plan.pages.length === 1 ? 'page' : 'pages'} · ${plan.issues.length} ${plan.issues.length === 1 ? 'warning' : 'warnings'}. Review the Markdown below. Changed sources and output conflicts are skipped at import.`});
		const list=el.createDiv({cls:'vimwiki-preview'});
		for(const page of plan.pages){new Setting(list).setName(`${page.path} → ${page.output}`).setHeading();list.createEl('pre',{text:page.markdown});}
		for(const issue of plan.issues) list.createEl('p',{text:`${issue.source}: ${issue.target} — ${issue.reason}`,cls:'vimwiki-warning'});
		new Setting(el).addButton(b=>b.setButtonText('Cancel').onClick(()=>this.close())).addButton(b=>b.setButtonText('Import').setCta().onClick(async()=>{
			b.setDisabled(true);
			try {
				const result=await this.plugin.importPlan(plan);
				this.plugin.settings={source:this.source,destination:this.destination,diary:this.diary};await this.plugin.saveSettings();
				if(this.closed)return;
				this.plan=null;el.empty();this.setTitle('Vimwiki import result');
				el.createEl('p',{text:`Created ${result.created.length} ${result.created.length === 1 ? 'note' : 'notes'}. Report: ${result.report}`});
				const list=el.createDiv({cls:'vimwiki-preview'});for(const path of result.created)list.createEl('p',{text:path});
				for(const issue of result.issues)list.createEl('p',{text:`${issue.source}: ${issue.reason}`});
				new Setting(el).addButton(b=>b.setButtonText('Close').onClick(()=>this.close()));
			}catch(e){new Notice(String(e));b.setDisabled(false);}
		}));
	}
}
