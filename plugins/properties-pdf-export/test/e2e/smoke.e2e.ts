import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';

describe(`${pluginId} real renderer`, function () {
	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('renders properties once, keeps unsafe values as text, and leaves source unchanged', async function () {
		const source = '---\nauthor: Ada\napproved: false\nunsafe: "<img src=x onerror=alert(1)>"\n---\n# Report\n\nBody text';
		await obsidianPage.write('Smoke.md', source);
		await obsidianPage.openFile('Smoke.md');
		await browser.executeObsidianCommand(`${pluginId}:toggle-header-preview`);
		await browser.executeObsidianCommand('markdown:toggle-preview');
		await browser.waitUntil(async () => browser.execute(() => {
			const headers = document.querySelectorAll('.workspace-leaf.mod-active .ppe-header');
			return headers.length === 1 && headers[0]!.textContent?.includes('Ada') === true;
		}), { timeout: 10000 });
		const result = await browser.execute(() => {
			const header = document.querySelector('.workspace-leaf.mod-active .ppe-header') as HTMLElement;
			return { text: header.textContent, images: header.querySelectorAll('img').length, visible: getComputedStyle(header).display !== 'none' };
		});
		expect(result.text).toContain('No');
		expect(result.text).toContain('<img src=x onerror=alert(1)>');
		expect(result.images).toBe(0);
		expect(result.visible).toBe(true);
		const saved = await browser.executeObsidian(async ({app}) => {
			const file = app.vault.getFileByPath('Smoke.md');
			return file ? await app.vault.read(file) : null;
		});
		expect(saved).toBe(source);
	});
	it('core Export to PDF renders exactly one visible header with preview off', async function () {
		const source = '---\nauthor: Ada\nposition: Engineer\napproved: false\naliases: [Private alias]\ncssclasses: private-style\n---\n# PDF report\n\nBody retained in print';
		await obsidianPage.write('Print.md', source);
		await obsidianPage.openFile('Print.md');
		const result = await browser.executeObsidian(async ({app}) => {
			// Intercept the core export modal's print container, not the plugin renderer.
			// testPrint calls the same core print() as the save-to-PDF pipeline.
			const { Modal } = require('obsidian');
			const plugins = (app as any).plugins.plugins;
			const plugin = plugins['properties-pdf-export'];
			plugin.settings.preview = false; plugin.settings.hidden = 'cssclasses, aliases';
			await plugin.saveSettings();
			let modal: any;
			const originalOpen = Modal.prototype.open;
			Modal.prototype.open = function () { modal = this; return originalOpen.call(this); };
			try {
				if (!(app as any).commands.executeCommandById(['workspace', 'export-pdf'].join(':'))) throw new Error('Core PDF command unavailable');
			} finally { Modal.prototype.open = originalOpen; }
			if (!modal || typeof modal.testPrint !== 'function') throw new Error('Core PDF print interception unavailable');
			modal.close();
			const electron = require('electron');
			const remote = electron.remote ?? require('@electron/remote');
			const debug = remote.getCurrentWebContents().debugger;
			debug.attach('1.3');
			try {
				await debug.sendCommand('Emulation.setEmulatedMedia', {media:'print'});
				await modal.testPrint();
				const print = document.querySelector('body > .print') as HTMLElement;
				const headers = print.querySelectorAll<HTMLElement>('.ppe-header');
				const header = headers[0];
				return {
					count: headers.length, text: header?.textContent,
					visible: !!header && header.getBoundingClientRect().height > 0 && getComputedStyle(header).display !== 'none' && getComputedStyle(header).visibility === 'visible',
					outsideFrontmatter: !header?.closest('.mod-frontmatter, .mod-ui'),
					body: print.textContent,
				};
			} finally {
				document.querySelector<HTMLElement>('body > .print')?.click();
				await debug.sendCommand('Emulation.setEmulatedMedia', {media:''}); debug.detach();
			}
		});
		expect(result.count).toBe(1);
		expect(result.visible).toBe(true);
		expect(result.outsideFrontmatter).toBe(true);
		expect(result.text).toContain('Ada');
		expect(result.text).toContain('Engineer');
		expect(result.text).toContain('No');
		expect(result.text).not.toContain('Private alias');
		expect(result.text).not.toContain('private-style');
		expect(result.body).toContain('Body retained in print');
	});

});
