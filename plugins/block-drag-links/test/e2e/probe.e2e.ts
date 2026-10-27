import { browser, expect } from '@wdio/globals';
import { pluginId } from './load';

// Probe: the DOM of a toggle row and the focus path of a refused Pro toggle. The test fails on purpose with the data.
describe('toggle focus probe', function () {
	it('dumps the toggle DOM and the focus after a refused change', async function () {
		const data = await browser.executeObsidian(async ({ app }, id) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, Record<string, unknown>> } }).plugins.plugins[id]!;
			for (const value of Object.values(plugin)) {
				const signOut = (value as { signOut?: unknown } | null)?.signOut;
				if (typeof signOut === 'function') (signOut as () => void).call(value);
			}
			const setting = (app as unknown as { setting: { open(): void; openTabById(id: string): void; activeTab: { containerEl: HTMLElement } } }).setting;
			setting.open();
			setting.openTabById(id);
			await new Promise((r) => setTimeout(r, 500));
			const root = setting.activeTab.containerEl;
			const findRow = () => [...root.querySelectorAll('.setting-item')].find((r) => r.querySelector('.setting-item-name')?.textContent === 'Readable block IDs') as HTMLElement | undefined;
			const desc = (el: Element | null) => (el ? `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}[tabindex=${el.getAttribute('tabindex')}]${findRow()?.contains(el) ? ' IN-ROW' : ''}` : 'null');
			const row = findRow()!;
			const out: Record<string, unknown> = {};
			out.control = row.querySelector('.setting-item-control')?.outerHTML;
			out.rootHasRow = root.contains(row);
			out.rowParents = (() => { const a: string[] = []; let e: HTMLElement | null = row; for (let i = 0; i < 6 && e; i++) { a.push(`${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`); e = e.parentElement; } return a; })();
			out.rootDesc = `${root.tagName.toLowerCase()}.${[...root.classList].join('.')} connected=${root.isConnected}`;
			const box = row.querySelector<HTMLElement>('.checkbox-container')!;
			const input = box.querySelector<HTMLElement>('input');
			if (input) { const cs = getComputedStyle(input); out.inputStyle = `${cs.display} ${cs.visibility} ${cs.opacity} ${cs.width}x${cs.height} ${cs.position}`; }
			box.focus(); out.afterBoxFocus = desc(document.activeElement);
			input?.focus(); out.afterInputFocus = desc(document.activeElement);
			// Keyboard path: focus the previous row control, then Tab is done by the runner below.
			box.setAttribute('data-old', '1');
			// Refused change through a click on the container while the focusable element has the focus.
			const focusable = document.activeElement && row.contains(document.activeElement) ? (document.activeElement as HTMLElement) : box;
			focusable.focus();
			out.before = desc(document.activeElement);
			box.click();
			out.syncAfterClick = desc(document.activeElement);
			const log: string[] = [];
			for (const ms of [0, 20, 60, 150, 300, 600]) {
				await new Promise((r) => setTimeout(r, ms === 0 ? 0 : 40));
				const r2 = findRow();
				const b2 = r2?.querySelector('.checkbox-container');
				log.push(`${ms}: active=${desc(document.activeElement)} rowNew=${r2 !== row} boxOld=${b2?.getAttribute('data-old') === '1'} boxOn=${b2?.classList.contains('is-enabled')}`);
			}
			out.log = log;
			return out;
		}, pluginId);
		// Keyboard: Tab from the toggle row before.
		const tab = await browser.executeObsidian(async ({ app }) => {
			const root = (app as unknown as { setting: { activeTab: { containerEl: HTMLElement } } }).setting.activeTab.containerEl;
			const rows = [...root.querySelectorAll<HTMLElement>('.setting-item')];
			const first = rows[0]!.querySelector<HTMLElement>('.checkbox-container input, .checkbox-container, select, input')!;
			first.focus();
			return `${document.activeElement?.tagName}.${document.activeElement?.className}`;
		});
		await browser.keys(['Tab']);
		const afterTab = await browser.executeObsidian(() => `${document.activeElement?.tagName}.${document.activeElement?.className} row=${document.activeElement?.closest('.setting-item')?.querySelector('.setting-item-name')?.textContent}`);
		expect(JSON.stringify({ ...data, tab, afterTab })).toBe('PROBE');
	});
});
