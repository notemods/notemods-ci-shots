// PROBE (s1026e T1): records disk text, editor text and every write to "Old tasks.md" during the back-fill.
import { browser } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { DIR, clickPreview, closeModals, readFile, run, setPro, setSettings, writeFile } from './helpers';
import { pluginId } from './load';

export const OLD = `${DIR}/Old tasks.md`;
const READING = `${DIR}/Reading list.md`;

async function install(): Promise<void> {
	await browser.executeObsidian(({ app }, path) => {
		const w = window as unknown as Record<string, unknown> & { __tdl?: { t0: number; log: unknown[] } };
		w.__tdl = { t0: Date.now(), log: [] };
		if (w.__tdlInstalled) return;
		w.__tdlInstalled = true;
		const L = (ev: string, extra: Record<string, unknown>) => w.__tdl!.log.push({ t: Date.now() - w.__tdl!.t0, ev, ...extra });
		const stack = () => (new Error().stack ?? '').split('\n').slice(3, 9).map((s) => s.trim().replace(/\(.*\//, '(')).join(' | ');
		const ad = app.vault.adapter as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
		for (const name of ['write', 'process', 'append']) {
			const orig = ad[name];
			if (typeof orig !== 'function') continue;
			ad[name] = async function (this: unknown, ...a: unknown[]) {
				if (a[0] === path) {
					const data = typeof a[1] === 'string' ? a[1] : '(fn)';
					L('adapter.' + name, { len: data.length, head: data.slice(0, 30), stack: stack() });
				}
				return orig.apply(this, a);
			};
		}
		const v = app.vault as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
		for (const name of ['modify', 'process']) {
			const orig = v[name];
			v[name] = async function (this: unknown, ...a: unknown[]) {
				const f = a[0] as { path?: string };
				if (f?.path === path) {
					if (name === 'process' && typeof a[1] === 'function') {
						const fn = a[1] as (s: string) => string;
						a[1] = (now: string) => {
							const out = fn(now);
							L('vault.process.fn', { inLen: now.length, outLen: out.length, outHead: out.slice(0, 30), stack: stack() });
							return out;
						};
					} else L('vault.' + name, { len: String(a[1]).length, head: String(a[1]).slice(0, 30), stack: stack() });
				}
				return orig.apply(this, a);
			};
		}
		for (const name of ['modify', 'create', 'delete', 'rename'] as const) {
			app.vault.on(name as 'modify', (f) => {
				if (f.path !== path) return;
				void app.vault.adapter.read(path).then((disk) => L('event.' + name, { diskLen: disk.length }), (e) => L('event.' + name, { err: String(e) }));
			});
		}
		app.workspace.on('editor-change', (editor, info) => {
			if (info.file?.path === path) L('editor-change', { len: editor.getValue().length });
		});
	}, OLD);
}

async function snap(label: string): Promise<Record<string, unknown>> {
	return browser.executeObsidian(async ({ app }, path, id, label) => {
		const f = app.vault.getFileByPath(path);
		const disk = await app.vault.adapter.read(path).catch((e: unknown) => 'ERR ' + String(e));
		const vread = f ? await app.vault.read(f) : 'NOFILE';
		const views = app.workspace.getLeavesOfType('markdown').map((l) => {
			const v = l.view as unknown as { file?: { path: string }; editor?: { getValue(): string }; getMode?(): string };
			return { file: v.file?.path, len: v.editor?.getValue().length, mode: v.getMode?.() };
		});
		const leaves: string[] = [];
		app.workspace.iterateRootLeaves((l) => { leaves.push(l.view.getViewType()); });
		const p = (app as unknown as { plugins: { plugins: Record<string, { mutationBusy?: boolean; settings: { auto: boolean } }> } }).plugins.plugins[id]!;
		const active = app.workspace.activeEditor;
		return {
			label, t: Date.now() - ((window as unknown as { __tdl?: { t0: number } }).__tdl?.t0 ?? 0),
			diskLen: disk.length, diskHead: disk.slice(0, 30), vreadLen: vread.length, statSize: f?.stat.size,
			activeFile: active?.file?.path, activeLen: active?.editor?.getValue().length, views, leaves,
			busy: p.mutationBusy, auto: p.settings.auto,
			notices: Array.from(document.querySelectorAll('.notice')).map((n) => n.textContent ?? ''),
		};
	}, OLD, pluginId, label);
}

/** One copy of backfill.e2e.ts test 1 with its before and afterEach. Returns the outcome; it does not throw. */
export async function probeOnce(tag: string, i: number, oldText: string, readingText: string): Promise<string> {
	const snaps: Record<string, unknown>[] = [];
	let outcome = 'PASS';
	try {
		await install();
		snaps.push(await snap('start'));
		await obsidianPage.openFile(OLD);
		snaps.push(await snap('opened'));
		await run('link-done-dates-note');
		const el = await browser.$('.task-date-links-preview .task-date-links-summary');
		await el.waitForDisplayed({ timeout: 8000 });
		const summary = await el.getText();
		snaps.push(await snap('preview ' + summary));
		await clickPreview('Link the dates');
		const t0 = Date.now();
		let ok = false;
		while (Date.now() - t0 < 15000) {
			const s = await snap('poll');
			const text = await readFile(OLD);
			if (snaps.length < 40) snaps.push(s);
			if (text.includes('[[2026-09-12]]')) { ok = true; break; }
			await browser.pause(250);
		}
		snaps.push(await snap(ok ? 'written' : 'NOT WRITTEN'));
		if (!ok) outcome = 'FAIL not written';
		else {
			await run('undo-backfill');
			await browser.waitUntil(async () => (await readFile(OLD)) === oldText, { timeout: 15000 }).catch(() => { outcome = 'FAIL undo'; });
		}
	} catch (e) {
		outcome = 'ERROR ' + String(e).slice(0, 200);
		snaps.push(await snap('error').catch(() => ({})));
	}
	const log = await browser.executeObsidian(() => (window as unknown as { __tdl?: { log: unknown[] } }).__tdl?.log ?? []);
	const version = await browser.executeObsidian(({ obsidian }) => obsidian.apiVersion);
	console.log('TDL_PROBE ' + JSON.stringify({ tag, i, version, outcome, oldLen: oldText.length, snaps, log }));
	// The afterEach of backfill.e2e.ts.
	await closeModals();
	await setPro(false);
	await setSettings({ onlyFolders: '', ignoreFolders: '', weekly: false, monthly: false, linkDue: false, linkStart: false, alias: '', dailyFolder: '' });
	await writeFile(OLD, oldText);
	await writeFile(READING, readingText);
	return outcome;
}

export function probeSpec(tag: string, n: number): void {
	describe(`${pluginId} probe ${tag}`, function () {
		it(`back-fill test 1, ${n} times from a fresh app`, async function () {
			const oldText = await readFile(OLD);
			const readingText = await readFile(READING);
			console.log('TDL_PROBE_BEFORE ' + JSON.stringify({ tag, oldLen: oldText.length, readingLen: readingText.length }));
			await setSettings({ auto: true });
			const outcomes: string[] = [];
			for (let i = 0; i < n; i++) outcomes.push(await probeOnce(tag, i, oldText, readingText));
			console.log('TDL_PROBE_SUMMARY ' + JSON.stringify({ tag, outcomes }));
		});
	});
}
