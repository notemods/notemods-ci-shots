import { browser, expect } from '@wdio/globals';
import { openReading, setPath, waitMath, write } from './helpers';

describe('shared-tex-preamble startup', function () {
	it('case 2: the definition is available after a restart without opening the macro file', async function () {
		await write('Start.tex', '\\newcommand{\\Vstart}[1]{#1+5}\n');
		await write('Start note.md', 'After restart $\\Vstart{2}$');
		await setPath('Start.tex');
		await browser.reloadObsidian();
		await browser.waitUntil(
			async () => browser.executeObsidian(({ app }) => {
				const p = (app as unknown as { plugins: { plugins: Record<string, { last: { status: string } | null }> } }).plugins.plugins['shared-tex-preamble'];
				return p?.last?.status === 'ok';
			}),
			{ timeout: 20_000, timeoutMsg: 'The plugin did not load the macro file at startup' },
		);
		const opened = await browser.executeObsidian(({ app }) => app.workspace.getLeavesOfType('markdown').map((l) => (l.view as { file?: { path: string } }).file?.path));
		expect(opened).not.toContain('Start.tex');
		await openReading(['Start note.md']);
		await waitMath('Start note.md', '2+5');
	});
});
