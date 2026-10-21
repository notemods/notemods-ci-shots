// The panel against the sample scripts in test/e2e/vault. No fixed waits: each step awaits the plugin call or
// polls the DOM with a 20 s bound. No theme or color checks.
import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { lastNotice, pluginId } from './load';

const ROOT = 'Fountain Reference Panel';
const ADA = `${ROOT}/Characters/Ada.md`;
const PILOT = `${ROOT}/Scripts/Pilot.fountain`;

interface Row {
	source: string;
	line: string;
	scene: string;
	context: string;
}

/** Opens the note, opens the panel and runs one scan. Returns the rows and the status in the DOM. */
async function panelFor(note: string): Promise<{ rows: Row[]; status: string }> {
	await obsidianPage.openFile(note);
	return browser.executeObsidian(async ({ app }, id) => {
		const plugin = (app as unknown as { plugins: { plugins: Record<string, { openPanel(): Promise<void>; refresh(): Promise<unknown> }> } }).plugins.plugins[id]!;
		await plugin.openPanel();
		await plugin.refresh();
		const el = document.querySelector('.fountain-reference-panel')!;
		const rows = [...el.querySelectorAll('.fountain-reference-panel-row')].map((r) => ({
			source: r.querySelector('.fountain-reference-panel-source')?.textContent ?? '',
			line: r.querySelector('.fountain-reference-panel-line')?.textContent ?? '',
			scene: r.querySelector('.fountain-reference-panel-scene')?.textContent ?? '',
			context: r.querySelector('.fountain-reference-panel-context')?.textContent ?? '',
		}));
		return { rows, status: el.querySelector('.fountain-reference-panel-status')?.textContent ?? '' };
	}, pluginId);
}

describe(`${pluginId} panel`, function () {
	it('lists the references to Ada with scene heading and nearby text', async function () {
		const { rows, status } = await panelFor(ADA);
		expect(rows).toEqual([
			{ source: `${ROOT}/Scripts/Episode 2.fountain`, line: 'Line 9', scene: 'EXT. NORTH ROCK - DAWN', context: 'Ada waits at the dock with two coffees.' },
			{ source: PILOT, line: 'Line 8', scene: 'EXT. LIGHTHOUSE - NIGHT', context: 'ADA (40s) climbs the last steps with a log book.' },
			{ source: PILOT, line: 'Line 22', scene: 'INT. RADIO ROOM - LATER', context: 'Ada picks up the handset. Ada smiles.' },
			{ source: `${ROOT}/Shorts/Test scene.fountain`, line: 'Line 3', scene: 'INT. KITCHEN - DAY', context: 'A test scene. Ada makes tea.' },
		]);
		expect(status).toBe('4 references from 3 scripts. 3 scripts scanned, 1 unresolved target.');
	});

	it('does not list the boneyard reference to Ben', async function () {
		const { rows } = await panelFor(`${ROOT}/Characters/Ben.md`);
		expect(rows.map((r) => r.line)).toEqual(['Line 10', 'Line 21']);
	});

	it('Refresh shows an edit, a rename and a delete of a script', async function () {
		const draft = `${ROOT}/Scripts/Draft.fountain`;
		const renamed = `${ROOT}/Scripts/Draft v2.fountain`;
		await obsidianPage.write(draft, 'INT. CELLAR - NIGHT\n\n[[>Ada]] finds a lamp.');
		expect((await panelFor(ADA)).rows.map((r) => r.source)).toContain(draft);
		await obsidianPage.write(draft, 'EXT. GARDEN - DAY\n\n[[>Ada]] finds a key.');
		expect((await panelFor(ADA)).rows.find((r) => r.source === draft)).toMatchObject({ scene: 'EXT. GARDEN - DAY', context: 'Ada finds a key.' });
		await browser.executeObsidian(async ({ app }, [from, to]) => {
			await app.fileManager.renameFile(app.vault.getFileByPath(from)!, to);
		}, [draft, renamed] as [string, string]);
		const after = (await panelFor(ADA)).rows.map((r) => r.source);
		expect(after).toContain(renamed);
		expect(after).not.toContain(draft);
		await obsidianPage.delete(renamed);
		expect((await panelFor(ADA)).rows.map((r) => r.source)).not.toContain(renamed);
	});

	it('follows another note from the last scan without scanning again', async function () {
		await panelFor(ADA);
		await obsidianPage.openFile(`${ROOT}/Characters/Ben.md`);
		await browser.waitUntil(async () => (await browser.$$('.fountain-reference-panel-row').length) === 2, { timeout: 20000 });
		expect(await browser.$('.fountain-reference-panel-note').getText()).toBe(`${ROOT}/Characters/Ben.md`);
	});

	it('resolves a short link from its script folder when two notes have the same name', async function () {
		const paths = await browser.executeObsidian(async ({ app }, root) => {
			const a = `${root}/Twin A`;
			const b = `${root}/Twin B`;
			await app.vault.createFolder(a);
			await app.vault.createFolder(b);
			await app.vault.create(`${a}/Twin.md`, '# Twin A');
			await app.vault.create(`${b}/Twin.md`, '# Twin B');
			await app.vault.create(`${a}/Local.fountain`, 'INT. ROOM - DAY\n\n[[>Twin]] enters.');
			return { a, b };
		}, ROOT);
		try {
			expect((await panelFor(`${paths.a}/Twin.md`)).rows.map((r) => r.source)).toEqual([`${paths.a}/Local.fountain`]);
			expect((await panelFor(`${paths.b}/Twin.md`)).rows).toEqual([]);
		} finally {
			await browser.executeObsidian(async ({ app }, { a, b }) => {
				await app.vault.delete(app.vault.getFolderByPath(a)!, true);
				await app.vault.delete(app.vault.getFolderByPath(b)!, true);
			}, paths);
		}
	});

	it('keeps the row and explains the missing viewer when the script does not open', async function () {
		await panelFor(ADA);
		const opened = await browser.executeObsidian(({ app }) => (app as unknown as { viewRegistry: { getTypeByExtension(e: string): string | undefined } }).viewRegistry.getTypeByExtension('fountain') ?? null);
		await browser.$('.fountain-reference-panel-source').click();
		if (opened === null) {
			await browser.waitUntil(async () => (await lastNotice()).includes('no view for .fountain files'), { timeout: 20000 });
		}
		expect(await browser.$$('.fountain-reference-panel-row').length).toBe(4);
	});

	it('the report is a Pro feature', async function () {
		await browser.executeObsidianCommand(`${pluginId}:export-report`);
		await browser.waitUntil(async () => (await lastNotice()).includes('pro feature'), { timeout: 20000 });
	});
});
