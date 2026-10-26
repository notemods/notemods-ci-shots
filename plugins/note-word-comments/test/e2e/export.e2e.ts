import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

// Real-app checks of the export command. Each wait is on a data-state marker or a file, not on a fixed time.
const DIR = 'E2E export';

/** Facts about a vault file: null when it does not exist. */
async function fileFacts(path: string): Promise<{ size: number; zip: boolean; comments: boolean; text: string } | null> {
	return browser.executeObsidian(async ({ app }, p) => {
		const f = app.vault.getFileByPath(p);
		if (!f) return null;
		const bytes = new Uint8Array(await app.vault.readBinary(f));
		const ascii = Array.from(bytes, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ' ')).join('');
		const text = f.extension === 'md' ? await app.vault.read(f) : '';
		return { size: bytes.length, zip: bytes[0] === 0x50 && bytes[1] === 0x4b, comments: ascii.includes('word/comments.xml'), text };
	}, path);
}

async function modalState(): Promise<string | null> {
	const el = await browser.$('.modal.nwc-modal');
	return (await el.isExisting()) ? await el.getAttribute('data-state') : null;
}

async function openAndRun(path: string): Promise<void> {
	await obsidianPage.openFile(path);
	await browser.executeObsidianCommand(`${pluginId}:export-active-note`);
	await browser.waitUntil(async () => ['ready', 'blocked'].includes((await modalState()) ?? ''), { timeout: 10000, timeoutMsg: 'preview did not open' });
}

describe('export to a docx file', function () {
	before(async function () {
		await browser.executeObsidian(async ({ app }, dir) => {
			const old = app.vault.getFolderByPath(dir);
			if (old) await app.fileManager.trashFile(old);
			await app.vault.createFolder(dir);
			await app.vault.create(`${dir}/Draft.md`, '# Draft\n\nWe need evidence %% add a source %%.\n');
			await app.vault.create(`${dir}/Broken.md`, 'Some **bold** text %% fix %%.\n\n```\ncode\n```\n');
		}, DIR);
	});

	it('shows the comment count and writes Draft.docx with a comments part', async function () {
		await openAndRun(`${DIR}/Draft.md`);
		expect(await modalState()).toBe('ready');
		expect(await browser.$('.nwc-count').getText()).toBe('Comments: 1');
		expect(await browser.$('.nwc-path').getText()).toBe(`New file: ${DIR}/Draft.docx`);
		await browser.$('.nwc-export').click();
		await browser.waitUntil(async () => (await fileFacts(`${DIR}/Draft.docx`)) !== null, { timeout: 15000, timeoutMsg: 'no DOCX file' });
		const docx = await fileFacts(`${DIR}/Draft.docx`);
		expect(docx).toMatchObject({ zip: true, comments: true });
		expect((await fileFacts(`${DIR}/Draft.md`))?.text).toBe('# Draft\n\nWe need evidence %% add a source %%.\n');
		await browser.waitUntil(async () => (await modalState()) === null, { timeout: 5000, timeoutMsg: 'preview did not close' });
	});

	it('writes Draft (2).docx the second time and keeps Draft.docx', async function () {
		const first = await fileFacts(`${DIR}/Draft.docx`);
		await openAndRun(`${DIR}/Draft.md`);
		expect(await browser.$('.nwc-path').getText()).toBe(`New file: ${DIR}/Draft (2).docx`);
		await browser.$('.nwc-export').click();
		await browser.waitUntil(async () => (await fileFacts(`${DIR}/Draft (2).docx`)) !== null, { timeout: 15000, timeoutMsg: 'no second DOCX file' });
		expect((await fileFacts(`${DIR}/Draft.docx`))?.size).toBe(first?.size);
	});

	it('stops on unsupported Markdown: Export is off and no file is written', async function () {
		await openAndRun(`${DIR}/Broken.md`);
		expect(await modalState()).toBe('blocked');
		const problems = await browser.$('.nwc-problems').getText();
		expect(problems).toContain('Broken.md line 1: bold text');
		expect(problems).toContain('Broken.md line 3: fenced code block');
		expect(await browser.$('.nwc-export').isEnabled()).toBe(false);
		await browser.$('.nwc-export').click();
		expect(await fileFacts(`${DIR}/Broken.docx`)).toBeNull();
		await browser.keys(['Escape']);
		await browser.waitUntil(async () => (await modalState()) === null, { timeout: 5000 });
	});

	it('asks for Pro before joining notes', async function () {
		await obsidianPage.openFile(`${DIR}/Draft.md`);
		await browser.executeObsidianCommand(`${pluginId}:export-folder-notes`);
		// Wait on the text: a notice from an earlier export can still be on screen.
		await browser.waitUntil(async () => (await browser.$$('.notice').map((n) => n.getText())).some((t) => t.includes('Joining several notes is a pro feature')), {
			timeout: 5000,
			timeoutMsg: 'no Pro notice',
		});
		expect(await modalState()).toBeNull();
	});
});
