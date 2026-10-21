import { strFromU8, unzipSync } from 'fflate';
import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { lastNotice, pluginId, reloadPlugin } from './load';

const DIR = 'Pocket Mochi Export';

/** True when the preview modal is open. */
async function previewOpen(): Promise<boolean> {
	return browser.execute(() => document.querySelector('.modal-container .pocket-mochi-export-preview') !== null);
}

/** The text of the open preview. */
async function previewText(): Promise<string> {
	return browser.execute(() => document.querySelector('.modal-container .pocket-mochi-export-preview')?.textContent ?? '');
}

/** Bytes of a vault file, or null when it does not exist. */
async function fileBytes(path: string): Promise<number[] | null> {
	return browser.executeObsidian(async ({ app }, p) => {
		const f = app.vault.getFileByPath(p);
		return f ? Array.from(new Uint8Array(await app.vault.readBinary(f))) : null;
	}, path);
}

describe(`${pluginId} smoke test`, function () {
	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('exports the active note to a .mochi ZIP after the preview', async function () {
		await obsidianPage.openFile(`${DIR}/Cell biology.md`);
		await browser.executeObsidianCommand(`${pluginId}:export-active-note`);
		await browser.waitUntil(previewOpen, { timeout: 20000 });
		const text = await previewText();
		expect(text).toContain('Cards3');
		expect(text).toContain('Cell biology (3 cards)');
		expect(text).toContain('Mochi exports/Cell biology.mochi');
		await browser.execute(() => (document.querySelector('.modal-container button.mod-cta') as HTMLButtonElement).click());
		await browser.waitUntil(async () => (await fileBytes('Mochi exports/Cell biology.mochi')) !== null, { timeout: 20000 });
		const bytes = await fileBytes('Mochi exports/Cell biology.mochi');
		const zip = unzipSync(new Uint8Array(bytes!));
		expect(Object.keys(zip).sort()).toEqual(['cell.png', 'data.edn']);
		const edn = strFromU8(zip['data.edn']!);
		expect(edn).toContain(':version 2');
		expect(edn).toContain(':name "Cell biology"');
		expect(edn.match(/:content /g)).toHaveLength(3);
		expect(edn).toContain('@media/cell.png');
		expect(edn).not.toContain('#card');
		expect(Array.from(zip['cell.png']!)).toEqual(await fileBytes(`${DIR}/attachments/cell.png`));
		await browser.waitUntil(async () => (await lastNotice()).startsWith('Exported 3 cards'), { timeout: 20000 });
	});

	it('keeps the old archive and writes the same bytes to the next name', async function () {
		const old = await fileBytes('Mochi exports/Cell biology.mochi');
		await obsidianPage.openFile(`${DIR}/Cell biology.md`);
		await browser.executeObsidianCommand(`${pluginId}:export-active-note`);
		await browser.waitUntil(previewOpen, { timeout: 20000 });
		expect(await previewText()).toContain('Mochi exports/Cell biology 1.mochi');
		await browser.execute(() => (document.querySelector('.pocket-mochi-export-preview button.mod-cta') as HTMLButtonElement).click());
		await browser.waitUntil(async () => (await fileBytes('Mochi exports/Cell biology 1.mochi')) !== null, { timeout: 20000 });
		expect(await fileBytes('Mochi exports/Cell biology.mochi')).toEqual(old);
		expect(await fileBytes('Mochi exports/Cell biology 1.mochi')).toEqual(old);
	});

	it('lists a missing image in the preview', async function () {
		await obsidianPage.openFile(`${DIR}/Plant biology.md`);
		await browser.executeObsidianCommand(`${pluginId}:export-active-note`);
		await browser.waitUntil(previewOpen, { timeout: 20000 });
		expect(await previewText()).toContain('Missing attachmentsstoma.png');
		await browser.execute(() => (Array.from(document.querySelectorAll('.pocket-mochi-export-preview button')).find((b) => b.textContent === 'Cancel') as HTMLButtonElement).click());
		await browser.waitUntil(async () => !(await previewOpen()), { timeout: 20000 });
		expect(await fileBytes('Mochi exports/Plant biology.mochi')).toBeNull();
	});

	it('shows No cards found for a note with no card line', async function () {
		await obsidianPage.write('Plain.md', '# Plain\nNo cards here.');
		await obsidianPage.openFile('Plain.md');
		await browser.executeObsidianCommand(`${pluginId}:export-active-note`);
		await browser.waitUntil(async () => (await lastNotice()) === 'No cards found', { timeout: 20000 });
		expect(await previewOpen()).toBe(false);
	});

	it('folder export without Pro shows the Pro notice', async function () {
		await obsidianPage.openFile(`${DIR}/Biology/Genetics.md`);
		await browser.executeObsidianCommand(`${pluginId}:export-folder-subdecks`);
		await browser.waitUntil(async () => (await lastNotice()).includes('is a pro feature'), { timeout: 20000 });
		expect(await previewOpen()).toBe(false);
	});
});
