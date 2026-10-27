import { afterEach, describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import KanbanDraftVaultPlugin from '../src/main';
import { BoardLimitsModal } from '../src/recovery';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

afterEach(() => { resetPro(); document.body.empty(); });

function apply(draftCount: string) {
	bindPro({ isPro: () => true, onChange: () => () => {} } as never);
	const p = new KanbanDraftVaultPlugin(App.createConfigured__({}) as never, manifest as never);
	const at = Date.now();
	for (const id of ['one', 'two', 'three']) p.capture({ id, board: 'Board A.md', lane: 'Todo', text: `Card ${id}`, at });
	const modal = new BoardLimitsModal(p); modal.open();
	modal.contentEl.querySelector('input')!.value = draftCount;
	[...modal.contentEl.querySelectorAll('button')].find((b) => b.textContent === 'Apply limits')!.click();
	return p;
}

describe('retention limit dialog', () => {
	it('does not apply a limit of 1 when a number field is empty', async () => {
		const p = apply(''); await p.saves.flush();
		expect(p.settings.limits).toEqual({});
		expect(p.settings.drafts).toHaveLength(3);
	});
	it('applies a complete valid limit', async () => {
		const p = apply('2'); await new Promise((r) => setTimeout(r, 0)); await p.saves.flush();
		expect(p.settings.limits['Board A.md']).toEqual({ drafts: 2, days: 30, versions: 10 });
		expect(p.settings.drafts).toHaveLength(2);
	});
});
