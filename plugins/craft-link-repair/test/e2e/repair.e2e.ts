import { browser, expect } from '@wdio/globals';
import { resetSettings, writeFixture, type TestPlugins } from './load';

describe('Craft Link Repair in a real vault', function () {
	it('previews through the command, writes through the button, and keeps sources', async function () {
		const source = '# Imported project\n[My project](craftdocs://open?documentId=project)\n[Monday](day://2026-10-12)\n[Lost](craftdocs://open?documentId=missing)';
		await writeFixture('E2E/Core/Project.textbundle/text.md', source);
		await writeFixture('E2E/Core/Project.textbundle/info.json', '{"identifier":"project"}');
		await resetSettings('E2E/Core');
		await browser.executeObsidianCommand('craft-link-repair:preview-repair');
		const preview = browser.$('.craft-repair'); await preview.waitForDisplayed({ timeout: 30000 });
		await preview.$('button=Preview links').click();
		await browser.waitUntil(async () => (await preview.$('.craft-repair-summary').getText()).includes('2 repaired links'), { timeout: 30000 });
		expect(await browser.executeObsidian(({ app }) => app.vault.getAbstractFileByPath('E2E/Core/Project.textbundle/text.repaired.md') === null)).toBe(true);
		await preview.$('button=Write copies').click();
		await browser.waitUntil(async () => (await preview.getText()).includes('1 copies written.'), { timeout: 30000 });
		const result = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: TestPlugins }).plugins.plugins['craft-link-repair'];
			const read = async (path: string) => { const f = app.vault.getFileByPath(path); if (!f) throw new Error(`Missing ${path}`); return app.vault.read(f); };
			return { source: await read('E2E/Core/Project.textbundle/text.md'), copy: await read('E2E/Core/Project.textbundle/text.repaired.md'), report: await read(p.lastResult!.report), failures: p.lastResult!.failures };
		});
		expect(result.source).toBe(source); expect(result.copy).toContain('[[E2E/Core/Project.textbundle/text.repaired|My project]]');
		expect(result.copy).toContain('[[2026-10-12|Monday]]'); expect(result.copy).toContain('craftdocs://open?documentId=missing');
		expect(result.report).toContain('Missing or ambiguous page identifier'); expect(result.failures).toEqual([]);
		await preview.$('button=Open report').click(); await browser.waitUntil(async () => !(await browser.$('.craft-repair').isExisting()), { timeout: 30000 });
	});
	it('blocks collisions without changing the occupied note', async function () {
		await writeFixture('E2E/Collision/Page.md', 'source'); await writeFixture('E2E/Collision/Page.repaired.md', 'keep');
		await resetSettings('E2E/Collision');
		const result = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: TestPlugins }).plugins.plugins['craft-link-repair']; const plan = await p.prepare('E2E/Collision');
			let message = ''; try { await p.writePlan(plan); } catch (e) { message = String(e); }
			return { message, content: await app.vault.read(app.vault.getFileByPath('E2E/Collision/Page.repaired.md')!) };
		});
		expect(result.message).toContain('Output already exists'); expect(result.content).toBe('keep');
	});
	it('requires a new preview after a source change', async function () {
		await writeFixture('E2E/Stale/Page.md', 'source'); await resetSettings('E2E/Stale');
		const result = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: TestPlugins }).plugins.plugins['craft-link-repair']; const plan = await p.prepare('E2E/Stale');
			await app.vault.process(app.vault.getFileByPath('E2E/Stale/Page.md')!, () => 'changed');
			let message = ''; try { await p.writePlan(plan); } catch (e) { message = String(e); }
			return { message, created: !!app.vault.getAbstractFileByPath('E2E/Stale/Page.repaired.md') };
		});
		expect(result.message).toContain('Preview again'); expect(result.created).toBe(false);
	});
	it('blocks 11 copies free and permits them with a local sponsor fixture', async function () {
		for (let i = 0; i < 11; i++) await writeFixture(`E2E/Limit/${i}.md`, 'note');
		await resetSettings('E2E/Limit');
		const blocked = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: TestPlugins }).plugins.plugins['craft-link-repair']; const plan = await p.prepare('E2E/Limit');
			let message = ''; try { await p.writePlan(plan); } catch (e) { message = String(e); } return message;
		});
		expect(blocked).toContain('Free limit'); await resetSettings('E2E/Limit', true);
		const result = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: TestPlugins }).plugins.plugins['craft-link-repair']; return p.writePlan(await p.prepare('E2E/Limit'));
		});
		expect(result.written).toHaveLength(11); expect(result.failures).toEqual([]);
	});
	it('uses saved Pro output and date paths', async function () {
		await writeFixture('E2E/Pro/Page.textbundle/text.md', '[Page](craftdocs://open?documentId=page)\n[Monday](day://2026-10-12)\n![Sketch](assets/sketch.png)');
		await writeFixture('E2E/Pro/Page.textbundle/info.json', '{"identifier":"page"}'); await resetSettings('E2E/Pro', true);
		const copied = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: TestPlugins }).plugins.plugins['craft-link-repair'];
			p.settings.outputFolder = 'E2E/Copies'; p.settings.dateFolder = 'Daily'; p.settings.dateFormat = 'YYYY.MM.DD';
			const result = await p.writePlan(await p.prepare('E2E/Pro'));
			return { result, text: await app.vault.read(app.vault.getFileByPath('E2E/Copies/Page.textbundle/text.md')!) };
		});
		expect(copied.result.failures).toEqual([]); expect(copied.text).toContain('[[E2E/Copies/Page.textbundle/text|Page]]');
		expect(copied.text).toContain('[[Daily/2026.10.12|Monday]]'); expect(copied.text).toContain('../../Pro/Page.textbundle/assets/sketch.png');
	});
	it('automatically repairs a new export after its metadata arrives', async function () {
		await writeFixture('E2E/Auto/Welcome.md', 'Automatic folder'); await resetSettings('E2E/Auto', true);
		await browser.executeObsidian(({ app }) => { const p = (app as unknown as { plugins: TestPlugins }).plugins.plugins['craft-link-repair']; p.settings.automatic = true; });
		await writeFixture('E2E/Auto/New.textbundle/text.md', '[Today](day://2026-10-13)');
		await writeFixture('E2E/Auto/New.textbundle/info.json', '{"identifier":"new"}');
		await writeFixture('E2E/Auto/info.json', '{"identifier":"welcome"}');
		await browser.waitUntil(async () => browser.executeObsidian(({ app }) => !!app.vault.getFileByPath('E2E/Auto/New.textbundle/text.repaired.md')), { timeout: 30000 });
		const copy = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: TestPlugins }).plugins.plugins['craft-link-repair']; p.settings.automatic = false;
			return app.vault.read(app.vault.getFileByPath('E2E/Auto/New.textbundle/text.repaired.md')!);
		});
		expect(copy).toBe('[[2026-10-13|Today]]');
	});
	it('ignores Pro choices and automatic repair after sign out', async function () {
		await writeFixture('E2E/SignedOut/Page.md', '[Day](day://2026-10-12)'); await resetSettings('E2E/SignedOut');
		const result = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: TestPlugins }).plugins.plugins['craft-link-repair'];
			p.settings.outputFolder = 'ProOnly'; p.settings.dateFolder = 'Daily'; p.settings.dateFormat = 'YYYY.MM.DD'; p.settings.automatic = true;
			return { plan: await p.prepare('E2E/SignedOut'), auto: await p.runAutomatic() };
		});
		expect(result.plan.copies[0].path).toBe('E2E/SignedOut/Page.repaired.md'); expect(result.plan.copies[0].text).toBe('[[2026-10-12|Day]]'); expect(result.auto).toBeNull();
	});
});
