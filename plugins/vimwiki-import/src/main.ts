import { Notice, Plugin, TFolder, normalizePath } from 'obsidian';
import { createGitHubSponsors } from './license/github-obsidian';
import type { SponsorsManager } from './license/index';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { DEFAULT_SETTINGS, VimwikiImportSettingTab, normalizeSettings, type VimwikiImportSettings } from './settings';
import { assessPage, cleanPath, combinedReport, planImport, reportText, type Plan, type ImportRecord, type Issue } from './importer';
import { ImportModal } from './modal';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';
export default class VimwikiImportPlugin extends Plugin {
	settings: VimwikiImportSettings = {...DEFAULT_SETTINGS};
	pro: SponsorsManager | null = null;
	records: ImportRecord[] = [];
	private busy = false;
	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		this.pro=createGitHubSponsors(this.app,this.manifest.id,SPONSORS,this); this.pro.init(); bindPro(this.pro);
		const tab=new VimwikiImportSettingTab(this.app,this); this.addSettingTab(tab);
		const pro = this.pro;
		this.register(pro.onChange(() => tab.update()));
		this.app.workspace.onLayoutReady(() => {
			if (!this.pro) return;
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
		this.addCommand({id:'preview-import',name:'Preview import',callback:()=>new ImportModal(this).open()});
		this.addCommand({id:'unresolved-report',name:'Create unresolved-link report (pro)',callback:()=>void this.writeCombined().catch(e=>new Notice(String(e)))});
	}
	onunload(): void {this.pro=null;resetPro();}
	async loadSettings(): Promise<void> {
		const saved=await this.loadData() as {settings?: Partial<VimwikiImportSettings>; records?: ImportRecord[]} | null;
		this.settings=normalizeSettings(saved?.settings);
		this.records=Array.isArray(saved?.records) ? saved.records.filter(r=>r && typeof r.source==='string' && typeof r.destination==='string' && Array.isArray(r.issues) && r.issues.every(i=>i && typeof i.source==='string' && typeof i.target==='string' && typeof i.reason==='string')) : [];
	}
	async saveSettings(): Promise<void> {await this.saveData({settings:this.settings,records:this.records});}
	async preview(source: string, destination: string, diary = ''): Promise<Plan> {
		if (diary && !isPro()) throw new Error('Diary mapping needs Pro.');
		const options={source:normalizePath(cleanPath(source)),destination:normalizePath(cleanPath(destination)),diary:diary ? normalizePath(cleanPath(diary)) : ''};
		if (this.app.vault.getAbstractFileByPath(options.destination)) throw new Error('Select a new destination folder.');
		const files=this.app.vault.getFiles().filter(f=>f.path.startsWith(`${options.source}/`) && f.extension==='wiki');
		const snapshots=[];
		for (const file of files) snapshots.push({path:file.path,text:await this.app.vault.read(file)});
		const plan=planImport(snapshots,options);
		if (!plan.pages.length) throw new Error('No default .wiki pages found in this source folder.');
		return plan;
	}
	async ensureFolder(path: string): Promise<void> {
		let current='';
		for (const part of normalizePath(cleanPath(path)).split('/')) {
			if (!part) continue;
			current=current ? `${current}/${part}` : part;
			const existing=this.app.vault.getAbstractFileByPath(current);
			if (existing && !(existing instanceof TFolder)) throw new Error(`A file blocks folder ${current}.`);
			if (!existing) await this.app.vault.createFolder(normalizePath(current));
		}
	}
	async importPlan(plan: Plan): Promise<{created: string[]; issues: Issue[]; report: string}> {
		if (this.busy) throw new Error('An import is in progress.');
		if (plan.options.diary && !isPro()) throw new Error('Diary mapping needs Pro.');
		this.busy=true;
		try {
			const issues=[...plan.issues]; const created: string[]=[];
			for (const page of plan.pages) {
				try {
					const file=this.app.vault.getFileByPath(page.path);
					const reason=assessPage(page.text,file ? await this.app.vault.read(file) : null,!!this.app.vault.getAbstractFileByPath(page.output));
					if (reason) {issues.push({source:page.path,target:page.output,reason});continue;}
					await this.ensureFolder(page.output.slice(0,page.output.lastIndexOf('/')));
					await this.app.vault.create(normalizePath(page.output),page.markdown);created.push(page.output);
				} catch(e) {issues.push({source:page.path,target:page.output,reason:`Write failed; page skipped. ${String(e)}`});}
			}
			await this.ensureFolder(plan.options.destination);
			const report=await this.uniqueReport(plan.options.destination,reportText('Vimwiki import report',[`Source: ${JSON.stringify(plan.options.source)}`,`Created: ${created.length}`, ...created.map(p=>`- ${JSON.stringify(p)}`)],issues));
			const record={source:plan.options.source,destination:plan.options.destination,issues};
			this.records=[...this.records.filter(r=>r.source!==record.source),record];await this.saveSettings();
			return {created,issues,report};
		} finally {this.busy=false;}
	}
	async uniqueReport(folder: string, text: string): Promise<string> {
		let path=normalizePath(`${folder}/Vimwiki report.md`);
		for(let n=2;this.app.vault.getAbstractFileByPath(path);n++) path=normalizePath(`${folder}/Vimwiki report ${n}.md`);
		await this.app.vault.create(path,text);return path;
	}
	async writeCombined(): Promise<string> {
		if (!isPro()) throw new Error('The combined report needs Pro.');
		const path=await this.uniqueReport('',combinedReport(this.records));new Notice(`Created ${path}`);return path;
	}
}
