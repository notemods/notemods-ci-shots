// The Pro features of this plugin, one line each. The "What Pro adds" window, the README Pro section and notemods.com
// use these lines word for word. Each gate is a text of the Pro check in src; tests/what-pro.test.ts checks it.
// No imports with code: tools and tests read this file as plain data.
import type { WhatProFeature } from './license/github-obsidian';

export const PRO_FEATURES: WhatProFeature[] = [
	{
		id: 'columns',
		line: 'Freeze 2 or 3 columns on the left. The free version freezes 1 column.',
		gate: { file: 'src/scope.ts', text: 'columns: pro ? columns : Math.min(columns, FREE_COLUMNS)' },
	},
	{
		id: 'file-view',
		line: 'Set the number of frozen columns for one file or for one view of a base.',
		gate: { file: 'src/main.ts', text: "this.proOnly('Frozen columns for one file'" },
	},
	{
		id: 'last',
		line: 'Keep the last column at the right edge while you scroll sideways.',
		gate: { file: 'src/scope.ts', text: 'last: pro && settings.freezeLast' },
	},
	{
		id: 'pin',
		line: 'Pin a property, so that its column stays next to the frozen columns.',
		gate: { file: 'src/main.ts', text: 'if (!this.settings.enabled || !this.isPro()) return null;' },
	},
];
