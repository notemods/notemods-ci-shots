import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pluginId } from './load';
import type Plugin from '../../src/main';

const example = Array.from(readFileSync('tests/fixtures/substack-example.zip'));
const podcast = Array.from(readFileSync('tests/fixtures/substack-podcast.zip'));

/** Await actual DOM and vault state. Do not use a sleep or a theme selector. */
describe('writer export import', () => {
	it('selects a local ZIP in the modal and creates the report and body', async () => {
		await browser.executeObsidianCommand(`${pluginId}:import-export`);
		await browser.waitUntil(async () => await browser.$('input[aria-label="Writer export zip"]').isExisting());
		await browser.$('input[aria-label="Writer export zip"]').setValue(resolve('tests/fixtures/substack-example.zip'));
		await browser.waitUntil(async () => {
			const error = await browser.$('.substack-import-error');
			if (await error.isExisting()) throw new Error(`Preview error: ${await error.getText()}`);
			const counts = await browser.$('.substack-import-counts');
			return await counts.isExisting() && (await counts.getText()).includes('Matched rows: 1');
		}, { timeout: 20000, timeoutMsg: 'The ZIP preview did not finish.' });
		expect(await browser.$('.substack-import-counts').getText()).toContain('HTML files with no CSV row: 1');
		await browser.$('button=Create import folder').click();
		await browser.waitUntil(async () => browser.executeObsidian(({ app }) => !!app.vault.getFileByPath('Substack import/_substack-snapshot.json')), { timeout: 20000, timeoutMsg: 'The import writes did not finish.' });
		const contents = await browser.executeObsidian(async ({ app }) => {
			const note = app.vault.getFileByPath('Substack import/123.first-post.md');
			const report = app.vault.getFileByPath('Substack import/Import report.md');
			if (!note || !report) throw new Error('Import files missing');
			return { note: await app.vault.read(note), report: await app.vault.read(report) };
		});
		expect(contents.note).toContain('A local archive'); expect(contents.note).toContain('published: true');
		expect(contents.report).toContain('posts/456.second-post.html'); expect(contents.note).toContain('2024-01-02T10:00:00Z');
	});

	it('keeps existing files and guards Pro features', async () => {
		const state = await browser.executeObsidian(async ({ app }, bytes) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins['substack-export-import']!;
			const preview = p.prepare(new Uint8Array(bytes));
			const errors: string[] = [];
			try { await p.writeImport(preview, 'Substack import'); } catch (e) { errors.push(String(e)); }
			try { await p.saveProfile({ name: 'Writer', folder: 'Next', mapping: { title: 'title', subtitle: 'subtitle', post_date: 'post_date', published: 'published', audience: 'audience', type: 'type', podcast_url: 'podcast_url' } }); } catch (e) { errors.push(String(e)); }
			try { await p.compareImport('Substack import', preview); } catch (e) { errors.push(String(e)); }
			const file = app.vault.getFileByPath('Substack import/123.first-post.md');
			return { errors, text: file ? await app.vault.read(file) : '' };
		}, example);
		expect(state.errors[0]).toContain('folder exists'); expect(state.errors[1]).toContain('need Pro'); expect(state.errors[2]).toContain('needs Pro'); expect(state.text).toContain('A local archive');
	});

	it('preserves a podcast URL without loading a player', async () => {
		const properties = await browser.executeObsidian(({ app }, bytes) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins['substack-export-import']!;
			return p.prepare(new Uint8Array(bytes)).posts[0]!.properties;
		}, podcast);
		expect(properties.type).toBe('podcast'); expect(properties.podcast_url).toBe('https://audio.example.test/episode.mp3');
	});

	it('saves a profile and compares later bodies with a simulated Sponsors check', async () => {
		const result = await browser.executeObsidian(async ({ app }, bytes) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins['substack-export-import']!;
			if (!p.pro) throw new Error('Sponsors manager missing');
			const manager = p.pro as unknown as { opts: { http: unknown }; refreshNow(): Promise<unknown>; signOut(): void };
			manager.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'fixture-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret('substack-export-import-github-token', 'gho_' + '0'.repeat(36));
			try {
				await manager.refreshNow();
				const mapping = { title: 'headline', subtitle: 'subtitle', post_date: 'post_date', published: 'published', audience: 'audience', type: 'type', podcast_url: 'podcast_url' };
				await p.saveProfile({ name: 'Writer', folder: 'Next export', mapping });
				const preview = p.prepare(new Uint8Array(bytes)); preview.posts[0]!.body = 'Updated local body.';
				return { profile: p.loadProfile('Writer'), changes: await p.compareImport('Substack import', preview) };
			} finally { manager.signOut(); }
		}, example);
		expect(result.profile.mapping.title).toBe('headline'); expect(result.changes[0]!.status).toBe('changed'); expect(result.changes[0]!.before).toContain('A local archive'); expect(result.changes[0]!.after).toBe('Updated local body.');
	});
});
