// Screenshots and the GIF from qa.json, taken in the wdio Obsidian (own temp profile, real HOME).
// Not part of test:e2e (the specs glob is *.e2e.ts). Run after a build:
//   OBSIDIAN_VERSIONS=latest/latest pnpm exec wdio run ./wdio.conf.mts --spec ./test/e2e/shots.ts
// It writes docs/<feature>.png (1200 px wide, 400 KB at most) and docs/<feature>.gif (900 px, 2 MB at most).
import { browser } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface Step {
	note?: string;
	eval?: string;
	commands?: string[];
	wait?: number;
	after?: string;
	hold?: number;
}
interface Shot extends Step {
	feature: string;
	frames?: Step[];
}

const DIR = 'AsciiDoc Files';
const WIDTH = 1200;
const HEIGHT = 760;
const MAX_PNG = 400 * 1024;
const MAX_GIF = 2 * 1024 * 1024;
const shots = JSON.parse(readFileSync('qa.json', 'utf8')) as Shot[];
const tmp = mkdtempSync(join(tmpdir(), 'adoc-shots-'));

function ffmpeg(args: string[]): void {
	const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
}

function shrinkPng(raw: string, out: string): number {
	ffmpeg(['-i', raw, '-vf', `scale=${WIDTH}:-1:flags=lanczos`, '-compression_level', '9', out]);
	if (statSync(out).size > MAX_PNG) ffmpeg(['-i', raw, '-vf', `scale=${WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256[p];[b][p]paletteuse=dither=none`, out]);
	const size = statSync(out).size;
	if (size > MAX_PNG) throw new Error(`${out} is ${size} bytes`);
	return size;
}

function makeGif(frames: string[], hold: number[], out: string): number {
	const list = join(tmp, 'frames.txt');
	writeFileSync(list, frames.map((f, i) => `file '${f}'\nduration ${(hold[i] ?? 1200) / 1000}`).join('\n') + `\nfile '${frames.at(-1)}'\n`);
	const vf = 'scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle';
	ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', vf, '-loop', '0', out]);
	const size = statSync(out).size;
	if (size > MAX_GIF) throw new Error(`${out} is ${size} bytes`);
	return size;
}

async function run(code: string | undefined): Promise<void> {
	if (code) await browser.execute((c: string) => (0, eval)(c) as unknown, code);
}

async function step(s: Step): Promise<void> {
	if (s.note) {
		// One tab per shot: close the AsciiDoc tabs of earlier shots and the right sidebar.
		await run("app.workspace.getLeavesOfType('asciidoc-files').forEach((l) => l.detach()); app.workspace.rightSplit.collapse(); 'ok'");
		await obsidianPage.openFile(`${DIR}/${s.note}`);
	}
	await browser.pause(500);
	await run(s.eval);
	for (const id of s.commands ?? []) await browser.executeObsidianCommand(id);
	await browser.pause(s.wait ?? 700);
}

describe('screenshots from qa.json', function () {
	before(async function () {
		await run(`electron.remote.getCurrentWindow().setContentSize(${WIDTH}, ${HEIGHT}); 'ok'`);
		await run("app.vault.setConfig('settingsPopoutWindow', false); app.workspace.leftSplit.collapse(); document.body.classList.add('is-focused'); 'ok'");
	});

	for (const shot of shots) {
		it(shot.feature, async function () {
			if (shot.frames) {
				const files: string[] = [];
				for (const [i, s] of shot.frames.entries()) {
					await step(s);
					const raw = join(tmp, `${shot.feature}-${i}-raw.png`);
					await browser.saveScreenshot(raw);
					files.push(join(tmp, `${shot.feature}-${i}.png`));
					shrinkPng(raw, files.at(-1)!);
				}
				console.log(`shot docs/${shot.feature}.gif ${makeGif(files, shot.frames.map((s) => s.hold ?? 1200), `docs/${shot.feature}.gif`)} bytes`);
				return;
			}
			await step(shot);
			const raw = join(tmp, `${shot.feature}-raw.png`);
			await browser.saveScreenshot(raw);
			console.log(`shot docs/${shot.feature}.png ${shrinkPng(raw, `docs/${shot.feature}.png`)} bytes`);
			await run(shot.after);
			await run("document.querySelectorAll('.notice').forEach((n) => n.remove()); app.workspace.leftSplit.collapse(); 'ok'");
		});
	}
});
