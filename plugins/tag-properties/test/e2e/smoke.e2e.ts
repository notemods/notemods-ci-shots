import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';

async function clickByText(selector: string, text: string): Promise<void> {
	for (const element of await browser.$$(selector)) {
		if (await element.getText() === text) {
			await element.click();
			return;
		}
	}
	throw new Error(`No ${selector} element has text ${JSON.stringify(text)}.`);
}

describe(`${pluginId} live tag workflow`, function () {
	it('is enabled and reloads with no console errors', async function () {
		expect(await reloadPlugin(pluginId)).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('counts custom list tags and includes child notes on click', async function () {
		await obsidianPage.write('Tag parent.md', '---\ntopics: ["research", "#Research"]\n---\n# Parent');
		await obsidianPage.write('Tag child.md', '---\ntopics: ["research/interviews"]\n---\n# Child');
		await obsidianPage.openFile('Tag parent.md');
		await browser.executeObsidianCommand(`${pluginId}:open-view`);
		await browser.waitUntil(async () => {
			return await browser.executeObsidian(({ app }) => {
				const leaf = app.workspace.getLeavesOfType('tag-properties-view')[0];
				return !!leaf?.view.containerEl.textContent?.includes('#research · 1');
			});
		}, { timeout: 10000 });
		await clickByText('.tag-properties-chip', '#research · 1');
		expect(await browser.$('.tag-properties-notes').getText()).toContain('Tag parent');
		expect(await browser.$('.tag-properties-notes').getText()).not.toContain('Tag child');
		await browser.$('.tag-properties-toggle input').click();
		expect(await browser.$('.tag-properties-notes').getText()).toContain('Tag child');
		expect(await browser.$('.tag-properties-filter').getValue()).toContain('startsWith("research/")');
	});

	it('opens a matching note link', async function () {
		await clickByText('.tag-properties-notes a', 'Tag child');
		await browser.waitUntil(async () => await browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path === 'Tag child.md'), { timeout: 5000 });
	});
	it('runs the generated filter in a native Bases table', async function () {
		const expression = await browser.$('.tag-properties-filter').getValue();
		await obsidianPage.write('Tag scalar.md', '---\ntopics: research\n---\n# Scalar');
		await obsidianPage.write('Tag invalid.md', '---\ntopics: [17, false]\n---\n# Invalid');
		await obsidianPage.write('Tag selection.base', `filters: ${JSON.stringify(expression)}\nviews:\n  - type: table\n    name: Selected topics\n    order:\n      - file.name\n      - topics\n`);
		await obsidianPage.openFile('Tag selection.base');
		await browser.waitUntil(async () => await browser.execute(() => document.querySelectorAll('.workspace-leaf.mod-active .bases-tbody .bases-tr').length === 2), { timeout: 15000, timeoutMsg: 'Native Bases should match the parent and child notes, with no scalar or invalid values.' });
		const rows = await browser.$('.workspace-leaf.mod-active .bases-tbody').getText();
		expect(rows).toContain('Tag parent');
		expect(rows).toContain('Tag child');
		expect(rows).not.toContain('Tag scalar');
	});

});
