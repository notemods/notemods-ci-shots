import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import PropertiesPdfExportPlugin from '../src/main';
import { DEFAULT_SETTINGS } from '../src/header';
import manifest from '../manifest.json';

function setup() {
	const plugin = new PropertiesPdfExportPlugin(App.createConfigured__({files:{'a.md':'# Hello'}}) as never, manifest as never);
	const el = document.createElement('div');
	el.append(document.createElement('p'));
	const ctx = { sourcePath:'a.md',docId:'one',frontmatter:{author:'Ada'}, getSectionInfo:()=>({lineStart:0,lineEnd:4,text:'---\nauthor: Ada\n---\n# Hello'}),addChild:()=>{} };
	return {plugin,el,ctx};
}
describe('render lifecycle', () => {
	it('loads default settings', async()=>{const {plugin}=setup();await plugin.loadSettings();expect(plugin.settings).toEqual(DEFAULT_SETTINGS);});
	it('adds one header across repeated calls', async()=>{const {plugin,el,ctx}=setup();await plugin.process(el,ctx);await plugin.process(el,ctx);expect(el.querySelectorAll('.ppe-header')).toHaveLength(1);});
	it('does not add a later section header', async()=>{const {plugin,el,ctx}=setup();ctx.getSectionInfo=()=>({lineStart:5,lineEnd:6,text:''});await plugin.process(el,ctx);expect(el.querySelector('.ppe-header')).toBeNull();});
	it('handles unknown section', async()=>{const {plugin,el,ctx}=setup();ctx.getSectionInfo=()=>null as never;await plugin.process(el,ctx);expect(el.querySelector('.ppe-header')).toBeNull();});
	it('removes an existing disabled header', async()=>{const {plugin,el,ctx}=setup();await plugin.process(el,ctx);plugin.settings.enabled=false;await plugin.process(el,ctx);expect(el.querySelector('.ppe-header')).toBeNull();});
	it('uses source context values', async()=>{const {plugin,el,ctx}=setup();ctx.sourcePath='Other/a.md';ctx.frontmatter.author='Grace';await plugin.process(el,ctx);expect(el.querySelector('dd')?.textContent).toBe('Grace');});
});

describe('print ownership', () => {
	it('prints once with null section information outside frontmatter', async () => {
		const {plugin,el,ctx}=setup();
		const print=document.createElement('div'); print.className='print';
		const root=document.createElement('div'); root.className='markdown-preview-view'; print.append(root);
		el.className='mod-frontmatter mod-ui'; root.append(el);
		ctx.getSectionInfo=()=>null as never;
		await plugin.process(el,ctx); await plugin.process(root,ctx);
		expect(root.querySelectorAll('.ppe-header')).toHaveLength(1);
		expect(root.firstElementChild?.classList.contains('ppe-header')).toBe(true);
		expect(el.querySelector('.ppe-header')).toBeNull();
	});
	it('uses the first content section after hidden frontmatter with no section info', async () => {
		const {plugin,el,ctx}=setup(); const root=document.createElement('div'); root.className='markdown-preview-sizer'; root.append(el);
		el.className='mod-frontmatter mod-ui'; ctx.getSectionInfo=()=>null as never;
		await plugin.process(el,ctx); expect(el.querySelector('.ppe-header')).toBeNull();
		const first=document.createElement('div');root.append(first);await plugin.process(first,ctx);
		expect(first.querySelector('.ppe-header')).not.toBeNull();
		const later=document.createElement('div');root.append(later); await plugin.process(later,ctx);
		expect(root.querySelectorAll('.ppe-header')).toHaveLength(1);
	});
});
