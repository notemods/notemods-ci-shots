import { browser } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';

// Kill gate spike: record what the core embed keeps of the size text in Live Preview and Reading view.
const NOTE = [
	'A ![[wide.png|50%]]',
	'',
	'B ![[wide.png|50%x30%]]',
	'',
	'C ![[wide.png|20rem]]',
	'',
	'D ![[wide.png|200]]',
	'',
	'E ![alt|50%](wide.png)',
	'',
	'F ![[wide.png|cap|40vw]]',
	'',
	'G ![Image](wide.png){width=50%}',
	'',
	'![[wide.png|60%]]',
	'',
].join('\n');

async function dump(mode: 'source' | 'preview'): Promise<unknown> {
	await browser.executeObsidian(async ({ app }, m) => {
		const leaf = app.workspace.getLeaf(false);
		const file = app.vault.getFileByPath('Spike.md');
		if (!file) throw new Error('no Spike.md');
		await leaf.openFile(file);
		const s = leaf.getViewState();
		await leaf.setViewState({ ...s, state: { ...s.state, mode: m, source: false } });
	}, mode);
	await browser.pause(2500);
	return browser.execute((m: string) => {
		const root = document.querySelector(m === 'source' ? '.workspace-leaf.mod-active .markdown-source-view' : '.workspace-leaf.mod-active .markdown-reading-view');
		if (!root) return 'no root';
		const attrs = (el: Element) => Object.fromEntries(Array.from(el.attributes).map((a) => [a.name, a.name === 'src' && a.value.length > 60 ? a.value.slice(0, 20) + '...' + a.value.slice(-20) : a.value]));
		return Array.from(root.querySelectorAll('img')).map((img) => {
			const wrap = img.closest('.internal-embed, .image-embed, .cm-line, p');
			return {
				img: attrs(img),
				wrap: wrap ? { tag: wrap.tagName, cls: wrap.className, attrs: attrs(wrap) } : null,
				w: Math.round(img.getBoundingClientRect().width),
				line: (img.closest('.cm-line, p')?.textContent ?? '').slice(0, 60),
			};
		});
	}, mode);
}

describe('spike', function () {
	it('dumps embed attributes', async function () {
		await obsidianPage.write('Spike.md', NOTE);
		await browser.pause(1500);
		const lp = await dump('source');
		const rv = await dump('preview');
		const version = await browser.executeObsidian(({ obsidian }) => (obsidian as unknown as { apiVersion: string }).apiVersion);
		console.log('SPIKE ' + JSON.stringify({ version, lp, rv }));
	});
});
