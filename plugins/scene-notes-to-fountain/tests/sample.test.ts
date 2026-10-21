import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import SceneNotesToFountainPlugin from '../src/main';
import { resetPro } from '../src/pro';
import manifest from '../manifest.json';

// The sample notes of the screenshots. The end-to-end vault has a copy, and the e2e test checks the same text.
const DIR = join(__dirname, '..', 'docs', 'sample-notes');
export const HEIST =
	'.INT. LAB - DAY\n\n= Ada finds a key in the old centrifuge.\n\n.02 Rooftop\n\n= Ada waits on the roof for the signal from Bo.\n\n' +
	'.EXT. STREET - NIGHT\n\n= Bo starts the van.\n= A patrol car turns the corner.\n\n.INT. BANK VAULT - NIGHT\n\n= Ada and Bo open the door and find the vault empty.\n';

function walk(dir: string, out: Record<string, string> = {}): Record<string, string> {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else out[relative(DIR, p).split('\\').join('/')] = readFileSync(p, 'utf8');
	}
	return out;
}

afterEach(() => resetPro());

describe('sample notes', () => {
	it('the e2e vault holds the same notes', () => {
		const e2e = join(__dirname, '..', 'test', 'e2e', 'vault', 'Scene Notes to Fountain');
		for (const [p, t] of Object.entries(walk(DIR))) expect(readFileSync(join(e2e, p), 'utf8')).toBe(t);
	});

	it('the Heist folder gives the outline of the screenshots', async () => {
		const app = App.createConfigured__({ files: walk(DIR) });
		const plugin = new SceneNotesToFountainPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		const sp = await plugin.makePlan(plugin.notesIn('Heist').map((f) => f.path));
		expect(sp.plan.text).toBe(HEIST);
	});

	it('the Drafts folder gives the two errors of the screenshots', async () => {
		const app = App.createConfigured__({ files: walk(DIR) });
		const plugin = new SceneNotesToFountainPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		const sp = await plugin.makePlan(plugin.notesIn('Drafts').map((f) => f.path));
		expect(sp.plan.text).toBeNull();
		expect(sp.plan.errors).toEqual([
			{ path: 'Drafts/Alley.md', message: 'The property "synopsis" is a list. It must be text.' },
			{ path: 'Drafts/Phone call.md', message: 'Unsupported text: the synopsis contains the Fountain delimiter [[ (first paragraph).' },
		]);
	});
});
