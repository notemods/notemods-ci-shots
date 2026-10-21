// Runs every qa.json entry of the plugin in PLUGIN_DIR in a real Obsidian and saves raw screenshots.
// qa.json format (factory runbook G-make.md): feature, caption, note, eval, commands, wait, zoom, after, frames.
// Output in OUT_DIR: raw/<feature>.png, frames/<feature>/NN.png + frames.txt (ffmpeg concat list), results.json.
// A test fails when the plugin is not loaded, when it logs an error at load or reload, when an eval throws,
// when a command id is unknown or fails, or when anything logs console.error / an uncaught error during an entry.
import { browser, expect } from '@wdio/globals';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';

const PLUGIN_DIR = path.resolve(process.env.PLUGIN_DIR);
const OUT = path.resolve(process.env.OUT_DIR);
const WIDTH = Number(process.env.SHOT_WIDTH ?? 1200);
const HEIGHT = Number(process.env.SHOT_HEIGHT ?? 760);
const manifest = JSON.parse(readFileSync(path.join(PLUGIN_DIR, 'manifest.json'), 'utf8'));
const qaPath = path.join(PLUGIN_DIR, 'qa.json');
const qa = existsSync(qaPath) ? JSON.parse(readFileSync(qaPath, 'utf8')) : [];
const notesDir = path.join(PLUGIN_DIR, 'docs', 'sample-notes');
const results = [];
mkdirSync(path.join(OUT, 'raw'), { recursive: true });

const log = (msg) => console.log(`[shots] ${msg}`);

/** Starts recording console.error, uncaught errors and unhandled rejections in the app window. */
async function installErrorCapture() {
	await browser.executeObsidian(() => {
		const w = window;
		if (w.__shotsErrors) return;
		w.__shotsErrors = [];
		const original = console.error;
		const fmt = (x) => (x && x.stack ? x.stack : typeof x === 'object' ? JSON.stringify(x) : String(x));
		console.error = (...args) => {
			w.__shotsErrors.push(args.map(fmt).join(' '));
			original.apply(console, args);
		};
		window.addEventListener('error', (e) => w.__shotsErrors.push(`uncaught: ${e.message}`));
		window.addEventListener('unhandledrejection', (e) => w.__shotsErrors.push(`unhandled rejection: ${fmt(e.reason)}`));
	});
}

/** Returns and clears the errors recorded since the last call. */
async function takeErrors() {
	return browser.executeObsidian(() => window.__shotsErrors.splice(0));
}

async function evalInApp(code, label) {
	const out = await browser.executeObsidian(async (_obs, src) => {
		try {
			const value = await (0, eval)(src);
			return { ok: true, value: value === undefined ? 'undefined' : String(value).slice(0, 200) };
		} catch (e) {
			return { ok: false, error: e && e.stack ? e.stack : String(e) };
		}
	}, code);
	if (!out.ok) throw new Error(`${label} threw: ${out.error}`);
	log(`${label} => ${out.value}`);
}

async function runCommand(id) {
	const ok = await browser.executeObsidian(({ app }, cid) => app.commands.executeCommandById(cid), id);
	if (!ok) throw new Error(`command ${id} not found or failed (executeCommandById returned false)`);
	log(`command ${id} ok`);
}

/** One qa step: clear notices, open (and reset) the note, zoom, eval, commands, wait. Same order as tools/dev.mjs. */
async function runStep(step) {
	await browser.executeObsidian(() => document.querySelectorAll('.notice-container .notice').forEach((n) => n.remove()));
	if (step.note) {
		const vaultPath = `${manifest.name}/${step.note}`;
		const text = readFileSync(path.join(notesDir, step.note), 'utf8');
		await browser.waitUntil(() => browser.executeObsidian(({ app }, p) => !!app.vault.getAbstractFileByPath(p), vaultPath), {
			timeout: 15_000,
			timeoutMsg: `note ${vaultPath} is not in the vault`,
		});
		await browser.executeObsidian(
			async ({ app }, p, t) => {
				const file = app.vault.getAbstractFileByPath(p);
				await app.vault.modify(file, t);
				await app.workspace.getLeaf(false).openFile(file);
			},
			vaultPath,
			text,
		);
		await browser.waitUntil(() => browser.executeObsidian(({ app }, p) => app.workspace.getActiveFile()?.path === p, vaultPath), {
			timeout: 10_000,
			timeoutMsg: `note ${vaultPath} did not open`,
		});
		log(`opened ${vaultPath}`);
	}
	const zoom = Number(step.zoom ?? 1);
	if (!(zoom >= 0.5 && zoom <= 1.5)) throw new Error(`zoom ${step.zoom} must be 0.5 to 1.5`);
	await browser.executeObsidian((_obs, z) => require('electron').webFrame.setZoomFactor(z), zoom);
	if (step.eval) await evalInApp(step.eval, 'eval');
	for (const id of step.commands ?? []) await runCommand(id);
	await browser.pause(step.wait ?? 700);
}

/** Fails with the errors that the app logged since the last check. */
async function assertNoErrors(where) {
	const errors = await takeErrors();
	if (errors.length) throw new Error(`errors logged during ${where}:\n${errors.join('\n')}`);
}

describe(`shots ${manifest.id}`, function () {
	before(async function () {
		await installErrorCapture();
		await browser.executeObsidian((_obs, w, h) => {
			const el = window.electron ?? require('electron');
			const remote = el.remote ?? require('@electron/remote');
			const win = remote.getCurrentWindow();
			win.setContentSize(w, h);
			win.webContents.setBackgroundThrottling(false);
		}, WIDTH, HEIGHT);
		await browser.pause(800);
		await browser.executeObsidian(({ app }) => {
			app.workspace.leftSplit.collapse();
			app.internalPlugins.getPluginById('sync')?.disable(true);
		});
		const size = await browser.executeObsidian(() => `${window.innerWidth}x${window.innerHeight} dpr ${window.devicePixelRatio}`);
		log(`Obsidian ${await browser.getObsidianVersion()} installer ${await browser.getObsidianInstallerVersion()}, viewport ${size}`);
	});

	it('loads the plugin and reloads it with no errors', async function () {
		const loaded = await browser.executeObsidian(({ app }, id) => !!app.plugins.plugins[id]?._loaded, manifest.id);
		expect(loaded).toBe(true);
		await takeErrors(); // capture starts after boot; the reload below repeats onload under capture
		const reloaded = await browser.executeObsidian(async ({ app }, id) => {
			await app.plugins.disablePlugin(id);
			const ok = await app.plugins.enablePlugin(id);
			await new Promise((r) => setTimeout(r, 1000));
			return ok && !!app.plugins.plugins[id]?._loaded;
		}, manifest.id);
		expect(reloaded).toBe(true);
		await assertNoErrors('plugin load');
		log(`${manifest.id} ${manifest.version} loaded with 0 errors`);
	});

	if (!qa.length) it('has a qa.json with entries', () => expect(qa.length).toBeGreaterThan(0));

	for (const f of qa) {
		it(`qa ${f.feature}`, async function () {
			if (typeof f.feature !== 'string' || !/^[a-z0-9-]+$/.test(f.feature)) throw new Error(`feature "${f.feature}" must be a-z, 0-9, -`);
			await browser.executeObsidian(({ app }) => app.commands.executeCommandById('editor:focus'));
			try {
				if (f.frames) {
					const dir = path.join(OUT, 'frames', f.feature);
					mkdirSync(dir, { recursive: true });
					const list = [];
					for (const [i, step] of f.frames.entries()) {
						await runStep(step);
						const file = path.join(dir, `${String(i).padStart(2, '0')}.png`);
						await browser.saveScreenshot(file);
						list.push(`file '${file}'\nduration ${(step.hold ?? 1200) / 1000}`);
					}
					list.push(`file '${path.join(dir, `${String(f.frames.length - 1).padStart(2, '0')}.png`)}'`);
					writeFileSync(path.join(dir, 'frames.txt'), `${list.join('\n')}\n`);
					log(`frames ${f.feature}: ${f.frames.length}`);
				} else {
					await runStep(f);
					await browser.saveScreenshot(path.join(OUT, 'raw', `${f.feature}.png`));
					log(`shot ${f.feature}.png`);
					if (f.after) await evalInApp(f.after, 'after').catch((e) => log(`after (ignored): ${e.message}`));
				}
				await assertNoErrors(`qa ${f.feature}`);
				results.push({ feature: f.feature, kind: f.frames ? 'gif' : 'png', ok: true, caption: f.caption ?? '' });
			} catch (e) {
				results.push({ feature: f.feature, kind: f.frames ? 'gif' : 'png', ok: false, error: String(e.message ?? e).slice(0, 2000) });
				throw e;
			} finally {
				writeFileSync(path.join(OUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
			}
		});
	}
});
