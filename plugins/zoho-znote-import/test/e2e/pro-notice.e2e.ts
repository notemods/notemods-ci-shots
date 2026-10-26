import { browser, expect } from '@wdio/globals';
import { pluginId } from './load';

// A free user runs the Pro command "Compare a later export". The shared Pro notice must show,
// with a Sponsor on GitHub button that opens the Sponsors page with metadata_source=<plugin id>.
describe(`${pluginId} Pro notice`, function () {
	it('shows the Sponsor on GitHub button when a free user runs a Pro command', async function () {
		await browser.executeObsidianCommand(`${pluginId}:compare`);
		await browser.waitUntil(async () => browser.execute(() => document.querySelector('.notice .pf-pro-notice-sponsor') !== null), {
			timeout: 5000,
			timeoutMsg: 'the Pro notice has no Sponsor on GitHub button',
		});
		const notice = await browser.execute(() => {
			const button = document.querySelector('.notice .pf-pro-notice-sponsor');
			return { label: button?.textContent ?? '', text: button?.closest('.notice')?.textContent ?? '' };
		});
		expect(notice.label).toBe('Sponsor on GitHub');
		expect(notice.text).toContain('Card comparison needs Pro.');
		expect(notice.text).toContain('Sponsor on GitHub, then sign in from the plugin settings.');
		// The button opens the Sponsors page. window.open is replaced for this click only, so no page opens.
		const url = await browser.execute(() => {
			const w = window as unknown as { open: (u?: string) => unknown };
			const original = w.open;
			let opened = '';
			w.open = (u?: string) => {
				opened = u ?? '';
				return null;
			};
			try {
				(document.querySelector('.notice .pf-pro-notice-sponsor') as HTMLElement).click();
			} finally {
				w.open = original;
			}
			return opened;
		});
		expect(url).toBe(`https://github.com/sponsors/theluckystrike?metadata_source=${pluginId}`);
		// The free user gets no comparison dialog.
		expect(await browser.execute(() => document.querySelector('.zoho-import-dialog'))).toBeNull();
	});
});
