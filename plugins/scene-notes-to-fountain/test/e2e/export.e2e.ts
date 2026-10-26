// The export window in a real vault. No waits on time: each step waits for a DOM state or a vault state.
import { browser, expect } from '@wdio/globals';
import type SceneNotesToFountainPlugin from '../../src/main';

const ROOT = 'Scene Notes to Fountain';
const HEIST = `${ROOT}/Heist`;
const LAB = `${HEIST}/01 Lab.md`;
const OUTLINE =
	'.INT. LAB - DAY\n\n= Ada finds a key in the old centrifuge.\n\n.02 Rooftop\n\n= Ada waits on the roof for the signal from Bo.\n\n' +
	'.EXT. STREET - NIGHT\n\n= Bo starts the van.\n= A patrol car turns the corner.\n\n.INT. BANK VAULT - NIGHT\n\n= Ada and Bo open the door and find the vault empty.\n';
const SWAPPED = OUTLINE.replace(
	'.EXT. STREET - NIGHT\n\n= Bo starts the van.\n= A patrol car turns the corner.\n\n.INT. BANK VAULT - NIGHT\n\n= Ada and Bo open the door and find the vault empty.\n',
	'.INT. BANK VAULT - NIGHT\n\n= Ada and Bo open the door and find the vault empty.\n\n.EXT. STREET - NIGHT\n\n= Bo starts the van.\n= A patrol car turns the corner.\n',
);

type Win = { current: unknown; close(): void };

async function openWindow(folder: string): Promise<void> {
	await browser.executeObsidian(({ app }, folder) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, SceneNotesToFountainPlugin> } }).plugins.plugins['scene-notes-to-fountain']!;
		(window as unknown as { snfModal: Win }).snfModal = p.openExport(folder) as unknown as Win;
	}, folder);
	await browser.$('.scene-notes-to-fountain .snf-notes').waitForExist();
}

async function clickButton(text: string): Promise<void> {
	await browser.execute(() => document.querySelectorAll('.notice').forEach((n) => n.remove()));
	const b = browser.$('.scene-notes-to-fountain').$(`button=${text}`);
	await b.waitForEnabled();
	await b.click();
}

async function fountainFiles(): Promise<string[]> {
	return browser.executeObsidian(({ app }) =>
		app.vault
			.getFiles()
			.filter((f) => f.extension === 'fountain')
			.map((f) => f.path)
			.sort(),
	);
}

async function readFile(path: string): Promise<string | null> {
	return browser.executeObsidian(async ({ app }, path) => {
		const f = app.vault.getFileByPath(path);
		return f ? app.vault.read(f) : null;
	}, path);
}

describe('export window in a real vault', function () {
	let labText = '';

	before(async function () {
		labText = (await readFile(LAB)) ?? '';
	});

	afterEach(async function () {
		await browser.executeObsidian(async ({ app }, lab, labText) => {
			(window as unknown as { snfModal?: Win }).snfModal?.close();
			for (const f of app.vault.getFiles().filter((f) => f.extension === 'fountain')) await app.vault.delete(f);
			const l = app.vault.getFileByPath(lab);
			if (l) await app.vault.modify(l, labText);
		}, LAB, labText);
	});

	it('previews the Heist folder and saves a new file without a change to the notes', async function () {
		const before = await browser.executeObsidian(async ({ app }, folder) => {
			const out: Record<string, string> = {};
			for (const f of app.vault.getMarkdownFiles().filter((f) => f.parent?.path === folder)) out[f.path] = await app.vault.read(f);
			return out;
		}, HEIST);
		await openWindow(HEIST);
		expect(await browser.$$('.scene-notes-to-fountain .snf-note').length).toBe(4);
		await clickButton('Preview');
		await browser.$('.scene-notes-to-fountain .snf-text').waitForExist();
		expect(await browser.$('.scene-notes-to-fountain .snf-text').getProperty('textContent')).toBe(OUTLINE);
		await clickButton('Save');
		await browser.waitUntil(async () => (await fountainFiles()).length === 1);
		expect(await fountainFiles()).toEqual([`${HEIST}/Outline.fountain`]);
		expect(await readFile(`${HEIST}/Outline.fountain`)).toBe(OUTLINE);
		for (const [p, t] of Object.entries(before)) expect(await readFile(p)).toBe(t);
	});

	it('Move up puts the vault scene above the street scene, and a second save gets a new number', async function () {
		await openWindow(HEIST);
		const up = browser.$$('.scene-notes-to-fountain .snf-note')[3]!.$('[aria-label="Move up"]');
		await up.click();
		await clickButton('Preview');
		await browser.$('.scene-notes-to-fountain .snf-text').waitForExist();
		expect(await browser.$('.scene-notes-to-fountain .snf-text').getProperty('textContent')).toBe(SWAPPED);
		await clickButton('Save');
		await browser.waitUntil(async () => (await fountainFiles()).length === 1);
		await openWindow(HEIST);
		await clickButton('Preview');
		await clickButton('Save');
		await browser.waitUntil(async () => (await fountainFiles()).length === 2);
		expect(await fountainFiles()).toEqual([`${HEIST}/Outline 2.fountain`, `${HEIST}/Outline.fountain`]);
		expect(await readFile(`${HEIST}/Outline.fountain`)).toBe(SWAPPED);
		expect(await readFile(`${HEIST}/Outline 2.fountain`)).toBe(OUTLINE);
	});

	it('shows the errors of the Drafts folder and keeps Save off', async function () {
		await openWindow(`${ROOT}/Drafts`);
		await clickButton('Preview');
		await browser.$('.scene-notes-to-fountain .snf-errors').waitForExist();
		const items = await browser.$$('.scene-notes-to-fountain .snf-errors li').map((e) => e.getText());
		expect(items).toEqual([
			`${ROOT}/Drafts/Alley.md: The property "synopsis" is a list. It must be text.`,
			`${ROOT}/Drafts/Phone call.md: Unsupported text: the synopsis contains the Fountain delimiter [[ (first paragraph).`,
		]);
		expect(await browser.$('.scene-notes-to-fountain').$('button=Save').isEnabled()).toBe(false);
		await clickButton('Cancel');
		expect(await fountainFiles()).toEqual([]);
	});

	it('a note change after preview rebuilds the preview', async function () {
		await openWindow(HEIST);
		await clickButton('Preview');
		await browser.$('.scene-notes-to-fountain .snf-text').waitForExist();
		await browser.executeObsidian(async ({ app }, lab) => {
			await app.vault.process(app.vault.getFileByPath(lab)!, (s) => s.replace('in the old centrifuge', 'under the desk'));
		}, LAB);
		await browser.waitUntil(async () => ((await browser.$('.scene-notes-to-fountain .snf-text').getProperty('textContent')) as string).includes('under the desk'));
		await clickButton('Save');
		await browser.waitUntil(async () => (await fountainFiles()).length === 1);
		expect(await readFile(`${HEIST}/Outline.fountain`)).toBe(OUTLINE.replace('in the old centrifuge', 'under the desk'));
	});

	it('signed-out Pro actions save no group and export nothing', async function () {
		const r = await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, SceneNotesToFountainPlugin> } }).plugins.plugins['scene-notes-to-fountain']!;
			p.pro!.signOut();
			return { group: await p.saveGroup('Test', 'x', ['a.md']), exported: await p.exportGroups(), groups: p.settings.groups.length };
		});
		expect(r).toEqual({ group: false, exported: [], groups: 0 });
	});
});
