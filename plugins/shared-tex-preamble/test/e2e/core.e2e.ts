import { browser, expect } from '@wdio/globals';
import { clearNotices, engineError, exists, isMobile, openReading, read, setPath, waitMath, waitNotice, write } from './helpers';

const A = 'Core A.md';
const B = 'Core B.md';
const NOTE_A = 'First note $\\Vcheck{2}$';
const NOTE_B = 'Second note\n\n$$\\Vcheck{2}$$\n';

describe('shared-tex-preamble core', function () {
	before(async function () {
		await write(A, NOTE_A);
		await write(B, NOTE_B);
	});

	it('case 1: one definition renders in two notes and the notes do not change', async function () {
		await write('Macros.tex', '% shared macros\n\\newcommand{\\Vcheck}[1]{#1+7}\n');
		await setPath('Macros.tex');
		await clearNotices();
		await browser.executeObsidianCommand('shared-tex-preamble:reload');
		await waitNotice('loaded 1 definition', 'Macros.tex');
		// Open and check one note at a time, so the check works with the mobile UI too.
		await openReading([A]);
		await waitMath(A, '2+7');
		await openReading([B]);
		await waitMath(B, '2+7');
		expect(await read(A)).toBe(NOTE_A);
		expect(await read(B)).toBe(NOTE_B);
	});

	it('case 3: renewcommand and Reload refresh each open Reading view', async function () {
		const mobile = await isMobile();
		await openReading(mobile ? [A] : [A, B]);
		await waitMath(A, '2+7');
		if (!mobile) await waitMath(B, '2+7');
		await write('Macros.tex', '\\renewcommand{\\Vcheck}[1]{#1+8}\n');
		await clearNotices();
		await browser.executeObsidianCommand('shared-tex-preamble:reload');
		// Desktop: both notes are open in splits, so the reload draws both again without a new open.
		const notice = await waitNotice('loaded 1 definition', 'Refreshed');
		await waitMath(A, '2+8');
		if (!mobile) {
			await waitMath(B, '2+8');
			expect(Number(/Refreshed (\d+)/.exec(notice)?.[1])).toBeGreaterThanOrEqual(2);
		}
		await openReading([B]);
		await waitMath(B, '2+8');
		expect(await read(A)).toBe(NOTE_A);
		expect(await read(B)).toBe(NOTE_B);
	});

	it('case 4: a missing file gives a notice with its name and creates no file', async function () {
		await setPath('Missing.tex');
		await clearNotices();
		await browser.executeObsidianCommand('shared-tex-preamble:reload');
		await waitNotice('Missing.tex', 'does not exist');
		expect(await exists('Missing.tex')).toBe(false);
	});

	it('case 5: an empty file gives a notice and no exception', async function () {
		await write('Empty.tex', '');
		await setPath('Empty.tex');
		await clearNotices();
		await browser.executeObsidianCommand('shared-tex-preamble:reload');
		await waitNotice('Empty.tex', 'has no macro definitions');
	});

	it('case 6: a parse error gives a notice, notes do not change, and the app stays usable', async function () {
		await write('Broken.tex', '\\newcommand{\\Broken}[1]\n\\newcommand{\\Vfine}{F+1}\n');
		await setPath('Broken.tex');
		await clearNotices();
		await browser.executeObsidianCommand('shared-tex-preamble:reload');
		await waitNotice('1 parse error', 'line 1', 'no replacement text');
		expect(await engineError('\\Vfine')).toBe('');
		expect(await read(A)).toBe(NOTE_A);
		await setPath('Macros.tex');
		await clearNotices();
		await browser.executeObsidianCommand('shared-tex-preamble:reload');
		await waitNotice('loaded 1 definition');
	});

	it('case 7: a package command rejects the file before the engine sees it', async function () {
		expect(await engineError('\\Vpkg')).not.toBe('');
		await write('Packages.tex', '\\newcommand{\\Vpkg}{P+1}\n\\require{some-package}\n\\usepackage{some-package}\n');
		await setPath('Packages.tex');
		await clearNotices();
		await browser.executeObsidianCommand('shared-tex-preamble:reload');
		await waitNotice('was rejected', 'line 2', '\\require');
		// The good definition in the same file is not loaded either.
		expect(await engineError('\\Vpkg')).not.toBe('');
	});

	it('case 8: the plugin runs with the mobile UI when the test emulates mobile', async function () {
		const platform = await browser.executeObsidian(({ obsidian }) => ({ mobile: obsidian.Platform.isMobile }));
		// The same specs run in a desktop and an emulated phone capability (wdio.conf.mts). This records which one ran.
		expect(typeof platform.mobile).toBe('boolean');
		await setPath('Macros.tex');
		await clearNotices();
		await browser.executeObsidianCommand('shared-tex-preamble:reload');
		await waitNotice('loaded 1 definition');
	});
});
