import { browser } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

// DOM probe: prints the structure of the core Bases cards view. Temporary, removed after the selectors are fixed.
describe(`${pluginId} DOM probe`, function () {
	it('prints the cards DOM of a base tab and an embed', async function () {
		const ver = await browser.executeObsidian(() => (window as unknown as { electron?: unknown }) && (navigator.userAgent.match(/obsidian\/([\d.]+)/i)?.[1] ?? 'unknown'));
		await browser.executeObsidian(async ({ app }) => {
			const folder = 'Bases Card Wrap/Quotes';
			for (let i = 0; i < 60; i++) {
				const p = `${folder}/Gen ${String(i).padStart(3, '0')}.md`;
				if (!app.vault.getAbstractFileByPath(p)) await app.vault.create(p, `---\nquote: "Generated quote number ${i} with enough words to run past the width of one card in the grid view"\nauthor: Gen\nadded: 2026-01-01\n---\n`);
			}
		});
		await obsidianPage.openFile('Bases Card Wrap/Quotes.base');
		await browser.waitUntil(async () => await browser.execute(() => document.querySelectorAll('.workspace-leaf.mod-active .bases-cards-item').length > 0), { timeout: 20000 });
		await browser.pause(800);
		const tab = await browser.executeObsidian(({ app }) => {
			const leaf = app.workspace.getMostRecentLeaf()!;
			const root = leaf.view.containerEl;
			const card = root.querySelector('.bases-cards-item') as HTMLElement;
			const chain: string[] = [];
			let el: HTMLElement | null = card;
			while (el && el !== root) {
				const cs = getComputedStyle(el);
				chain.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} [${[...el.attributes].filter((a) => a.name !== 'class').map((a) => `${a.name}=${a.value.slice(0, 80)}`).join(' ')}] pos=${cs.position} disp=${cs.display} h=${el.getBoundingClientRect().height.toFixed(0)} gtr=${cs.gridTemplateRows.slice(0, 40)} gac=${cs.gridAutoRows}`);
				el = el.parentElement;
			}
			const props = [...card.querySelectorAll('*')].slice(0, 40).map((e) => {
				const cs = getComputedStyle(e);
				return `${e.tagName.toLowerCase()}.${[...e.classList].join('.')} ws=${cs.whiteSpace} ov=${cs.overflow} to=${cs.textOverflow} h=${e.getBoundingClientRect().height.toFixed(0)} attrs=[${[...e.attributes].filter((a) => a.name !== 'class').map((a) => `${a.name}=${a.value.slice(0, 40)}`).join(' ')}]`;
			});
			const items = root.querySelectorAll('.bases-cards-item').length;
			const vs = leaf.getViewState();
			const anyView = leaf.view as unknown as Record<string, unknown>;
			return { viewType: leaf.view.getViewType(), state: JSON.stringify(vs.state).slice(0, 400), keys: Object.keys(anyView).slice(0, 40), items, chain, props, html: card.outerHTML.slice(0, 2500), toolbar: (root.querySelector('.bases-toolbar') as HTMLElement | null)?.outerHTML.slice(0, 1500) ?? 'none', viewEl: (root.querySelector('.bases-view') as HTMLElement | null)?.outerHTML.slice(0, 300) };
		});
		console.log(`PROBE ${ver} TAB ${JSON.stringify(tab, null, 1)}`);
		await obsidianPage.openFile('Bases Card Wrap/Reading list.md');
		await browser.executeObsidian(async ({ app }) => {
			const leaf = app.workspace.getMostRecentLeaf()!;
			await leaf.setViewState({ type: 'markdown', state: { file: 'Bases Card Wrap/Reading list.md', mode: 'source', source: false } });
		});
		await browser.pause(3000);
		const embed = await browser.executeObsidian(({ app }) => {
			const root = app.workspace.getMostRecentLeaf()!.view.containerEl;
			const views = [...root.querySelectorAll('.bases-view')] as HTMLElement[];
			return views.map((v) => {
				const chain: string[] = [];
				let el: HTMLElement | null = v;
				for (let i = 0; i < 8 && el; i++) {
					chain.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} [${[...el.attributes].filter((a) => a.name !== 'class').map((a) => `${a.name}=${a.value.slice(0, 80)}`).join(' ')}]`);
					el = el.parentElement;
				}
				return { cards: v.querySelectorAll('.bases-cards-item').length, chain };
			});
		});
		console.log(`PROBE ${ver} EMBED ${JSON.stringify(embed, null, 1)}`);
	});
});
