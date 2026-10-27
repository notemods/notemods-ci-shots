import { afterEach, describe, expect, it, vi } from 'vitest';
import { SceneMoverModal } from '../src/modal';
import { resetPro } from '../src/pro';
import { enablePro, fixture } from './fixtures';

const open: SceneMoverModal[] = [];
afterEach(() => { for (const modal of open.splice(0)) { modal.close(); modal.containerEl.remove(); } resetPro(); vi.restoreAllMocks(); });
async function modalFixture(scenes: unknown = ['A', ['a1', ['x']], 'B', 'C']) {
	const f = fixture(scenes);
	const modal = new SceneMoverModal(f.app as never, f.plugin, await f.plugin.readPreview(f.file as never), vi.fn());
	open.push(modal); document.body.append(modal.containerEl); modal.onOpen();
	return { ...f, modal };
}
function select(modal: SceneMoverModal, field: string, value: string) {
	const el = modal.contentEl.querySelector<HTMLSelectElement>(`[data-field="${field}"]`)!;
	el.value = value; el.dispatchEvent(new Event('change', { bubbles: true }));
}
async function press(modal: SceneMoverModal, action: string) {
	modal.contentEl.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click();
	await vi.waitFor(() => expect(modal.contentEl.querySelector('.ssm-status')?.getAttribute('data-pending')).toBe('false'));
}

describe('mover controls', () => {
	it('shows an empty tree and disables move and apply', async () => {
		const f = await modalFixture([]);
		expect(f.modal.contentEl.querySelector('[data-tree="before"]')?.textContent).toBe('(empty scene tree)');
		for (const action of ['preview', 'apply']) expect(f.modal.contentEl.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.disabled).toBe(true);
		expect(await f.app.vault.read(f.file)).toBe(f.source);
	});
	it('shows scene text as text and does not create an injected image', async () => {
		const f = await modalFixture(['<img src=x onerror=alert(1)>', 'B']);
		expect(f.modal.contentEl.querySelector('[data-tree="before"]')?.textContent).toContain('<img src=x');
		expect(f.modal.contentEl.querySelector('img')).toBeNull();
	});
	it('previews a free move and permits a reset before changing the file', async () => {
		const f = await modalFixture(); select(f.modal, 'position', '2'); await press(f.modal, 'preview');
		expect(f.modal.contentEl.querySelector('[data-tree="after"]')?.textContent).toBe('1. B\n2. C\n3. A\n  1. a1\n    1. x');
		// Add move (Pro) stays selectable. A free select shows the Pro notice (tests/pro-notice.test.ts).
		expect(f.modal.contentEl.querySelector<HTMLButtonElement>('[data-action="preview"]')?.disabled).toBe(false);
		expect(await f.app.vault.read(f.file)).toBe(f.source);
		await press(f.modal, 'reset');
		expect(f.modal.contentEl.querySelector<HTMLButtonElement>('[data-action="preview"]')?.disabled).toBe(false);
		expect(f.modal.contentEl.querySelector<HTMLButtonElement>('[data-action="apply"]')?.disabled).toBe(true);
	});
	it('starts a nested scene in its current sibling group', async () => {
		const f = await modalFixture(); select(f.modal, 'chapter', '[0,0]');
		const options = f.modal.contentEl.querySelector<HTMLSelectElement>('[data-field="position"]')!.options;
		expect([...options].map((o) => o.textContent)).toEqual(['1 · a1']);
	});
	it('previews a free parent change and applies with descendants', async () => {
		const f = await modalFixture();
		select(f.modal, 'parent', '[1]');
		await press(f.modal, 'preview');
		expect(f.modal.contentEl.querySelector('[data-tree="after"]')?.textContent).toBe('1. B\n  1. A\n    1. a1\n      1. x\n2. C');
		expect(await f.app.vault.read(f.file)).toBe(f.source);
		await press(f.modal, 'apply');
		expect(f.modal.contentEl.querySelector('.ssm-status')?.textContent).toContain('Order applied. Backup:');
		expect(f.app.vault.getFiles()).toHaveLength(2);
	});
	it('moves a subtree to another parent without ES2022 Array.prototype.at', async () => {
		// The build target is ES2021. Older mobile WebViews do not have Array.prototype.at.
		const f = await modalFixture(['A', ['a1'], 'B', ['b1']]);
		const at = Object.getOwnPropertyDescriptor(Array.prototype, 'at')!;
		delete (Array.prototype as { at?: unknown }).at;
		try {
			select(f.modal, 'chapter', '[0,0]');
			select(f.modal, 'parent', '[1]');
			select(f.modal, 'position', '1');
			await press(f.modal, 'preview');
			expect(f.modal.contentEl.querySelector('[data-tree="after"]')?.textContent).toBe('1. A\n2. B\n  1. b1\n  2. a1');
		} finally {
			Object.defineProperty(Array.prototype, 'at', at);
		}
	});
	it('excludes the selected scene and its descendants as parents', async () => {
		const f = await modalFixture();
		const options = f.modal.contentEl.querySelector<HTMLSelectElement>('[data-field="parent"]')!.options;
		expect([...options].map((o) => o.value)).toEqual(['[]', '[1]', '[2]']);
	});
	it('offers root promotion and an end slot in another parent group', async () => {
		const f = await modalFixture(['A', ['a1'], 'B', ['b1']]);
		select(f.modal, 'chapter', '[0,0]');
		select(f.modal, 'parent', '[1]');
		const options = f.modal.contentEl.querySelector<HTMLSelectElement>('[data-field="position"]')!.options;
		expect([...options].map((o) => o.textContent)).toEqual(['1 · Before b1', '2 · At end']);
		select(f.modal, 'parent', '[]');
		select(f.modal, 'position', '2');
		await press(f.modal, 'preview');
		expect(f.modal.contentEl.querySelector('[data-tree="after"]')?.textContent).toBe('1. A\n2. B\n  1. b1\n3. a1');
		await press(f.modal, 'reset');
		expect(f.modal.contentEl.querySelector<HTMLSelectElement>('[data-field="parent"]')?.value).toBe('[]');
		expect(await f.app.vault.read(f.file)).toBe(f.source);
	});
	it('shows an unchanged order without creating a backup', async () => {
		const f = await modalFixture(); await press(f.modal, 'preview');
		expect(f.modal.contentEl.querySelector('.ssm-status')?.textContent).toContain('order is unchanged');
		expect(f.app.vault.getFiles()).toHaveLength(1);
	});
	it('keeps the staged move clear when an added move uses the current position', async () => {
		enablePro();
		const f = await modalFixture();
		select(f.modal, 'position', '2'); await press(f.modal, 'preview');
		await press(f.modal, 'preview');
		expect(f.modal.contentEl.querySelector('.ssm-status')?.textContent).toContain('Previous preview changes remain');
		expect(f.modal.contentEl.querySelector<HTMLButtonElement>('[data-action="apply"]')?.disabled).toBe(false);
		expect(await f.app.vault.read(f.file)).toBe(f.source);
	});
	it('permits two staged moves with Pro and refuses their apply after sign out', async () => {
		const state = enablePro(); const f = await modalFixture();
		select(f.modal, 'position', '2'); await press(f.modal, 'preview');
		select(f.modal, 'position', '1'); await press(f.modal, 'preview');
		expect(f.modal.contentEl.querySelector('.ssm-status')?.textContent).toContain('2 moves');
		state.set(false); await press(f.modal, 'apply');
		expect(f.modal.contentEl.querySelector('.ssm-status')?.textContent).toContain('needs Pro');
		expect(await f.app.vault.read(f.file)).toBe(f.source);
	});
});
