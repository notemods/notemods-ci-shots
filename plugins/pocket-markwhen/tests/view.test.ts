import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import PocketMarkwhenPlugin from '../src/main';
import { PocketMarkwhenView } from '../src/view';
import { resetPro } from '../src/pro';
import manifest from '../manifest.json';
const views: PocketMarkwhenView[] = [];
afterEach(() => { for (const v of views.splice(0)) v.unload(); resetPro(); });
describe('file source editor', () => {
	it('keeps the source text, requests saving and shows an added event', () => {
		const app = App.createConfigured__();
		const plugin = new PocketMarkwhenPlugin(app as never, manifest as never);
		const view = new PocketMarkwhenView(app.workspace.getLeaf(true) as never, plugin); views.push(view); view.load();
		const source = '---\ntitle: Trip\n---\n\n2026-03-01: A\n';
		view.setViewData(source, true); expect(view.getViewData()).toBe(source);
		view.showTab(true);
		const save = vi.spyOn(view, 'requestSave');
		const textarea = view.contentEl.querySelector<HTMLTextAreaElement>('textarea')!;
		textarea.value += '\n2026-05-01: New'; textarea.dispatchEvent(new Event('input'));
		expect(save).toHaveBeenCalledOnce(); expect(view.getViewData()).toBe(source + '\n2026-05-01: New');
		view.showTab(false); expect(view.contentEl.querySelectorAll('.pocket-markwhen-event')).toHaveLength(2);
		expect(view.contentEl.querySelector('.pocket-markwhen-title')?.textContent).toBe('Trip');
	});
	it('clears the old source and groups when a different file is loaded', () => {
		const app = App.createConfigured__();
		const plugin = new PocketMarkwhenPlugin(app as never, manifest as never);
		const view = new PocketMarkwhenView(app.workspace.getLeaf(true) as never, plugin); views.push(view);
		view.setViewData('# Old\n2026-03-01: A', true); view.setViewData('2027: New file', true);
		expect(view.getViewData()).toBe('2027: New file'); expect(view.contentEl.querySelector('.pocket-markwhen-group')).toBeNull();
	});
	it('keeps CRLF line endings when the textarea normalizes them like Chromium', () => {
		// Chromium returns LF from textarea.value. happy-dom keeps CR, so this test adds the browser behavior.
		const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!;
		Object.defineProperty(HTMLTextAreaElement.prototype, 'value', { configurable: true, get(this: HTMLTextAreaElement) { return String(desc.get!.call(this)).replace(/\r\n?/g, '\n'); }, set(this: HTMLTextAreaElement, v: string) { desc.set!.call(this, v); } });
		try {
			const app = App.createConfigured__();
			const plugin = new PocketMarkwhenPlugin(app as never, manifest as never);
			const view = new PocketMarkwhenView(app.workspace.getLeaf(true) as never, plugin); views.push(view); view.load();
			const source = '---\r\ntitle: Trip\r\n---\r\n\r\n2026-03-01: A\r\n';
			view.setViewData(source, true); expect(view.getViewData()).toBe(source);
			const textarea = view.contentEl.querySelector<HTMLTextAreaElement>('textarea')!;
			textarea.value += '2026-05-01: New'; textarea.dispatchEvent(new Event('input'));
			expect(view.getViewData()).toBe(source + '2026-05-01: New');
			const mixed = '2026-03-01: A\r\n2026-03-02: B\n';
			view.setViewData(mixed, true); expect(view.getViewData()).toBe(mixed);
		} finally { Object.defineProperty(HTMLTextAreaElement.prototype, 'value', desc); }
	});
});
