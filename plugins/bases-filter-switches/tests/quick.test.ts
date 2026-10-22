import { describe, expect, it } from 'vitest';
import {
	activeQuick,
	addQuick,
	clearQuick,
	FREE_QUICK,
	PRO_QUICK,
	propertyRef,
	quickExpression,
	quickProperties,
	quickValues,
	readConfig,
	readDefault,
	readPaused,
	readQuick,
	readSelection,
	removeQuick,
	runOp,
	visibleProperties,
} from '../src/basefile';

// Quick property filter: one plain item of the top-level "and" list, saved under filterSwitches.quick.
const TASKS = `filters:\n  and:\n    - file.inFolder("Tasks")\nviews:\n  - type: table\n    name: All\n`;

describe('quick filter expressions', () => {
	it('criterion 1: status is todo goes to the end of the and list with one saved entry', () => {
		const out = runOp(TASKS, 'quick', ['status', 'is', 'todo', ['todo', 'done'], false]);
		expect(out).toContain('  and:\n    - file.inFolder("Tasks")\n    - status == "todo"\n');
		expect(readQuick(out)).toEqual([{ property: 'status', match: 'is', value: 'todo', filter: 'status == "todo"' }]);
	});

	it('criterion 2: a list property uses list().contains()', () => {
		expect(quickExpression({ property: 'tags', match: 'is', value: 'work' }, [['work', 'home'], ['work']])).toBe('list(tags).contains("work")');
		const out = runOp(TASKS, 'quick', ['tags', 'is', 'work', [['work', 'home']], false]);
		expect(out).toContain('    - list(tags).contains("work")\n');
	});

	it('criterion 3: contains text lowercases the text and uses propertyRef for a name with a space', () => {
		const expr = quickExpression({ property: 'my author', match: 'contains', value: 'Le' }, []);
		expect(expr).toBe('note["my author"].toString().lower().contains("le")');
		expect(expr?.startsWith(propertyRef('my author'))).toBe(true);
		expect(quickExpression({ property: 'Autor·in', match: 'contains', value: 'ÉÉ' }, [])).toBe('note["Autor·in"].toString().lower().contains("éé")');
	});

	it('"is" uses the generator of property switches: numbers and booleans stay typed, mixed values use one expression', () => {
		expect(quickExpression({ property: 'year', match: 'is', value: '2024' }, [2024, 2025])).toBe('year == 2024');
		expect(quickExpression({ property: 'done', match: 'is', value: 'true' }, [true, false])).toBe('done == true');
		expect(quickExpression({ property: 'n', match: 'is', value: '42' }, [42, '42'])).toBe('(n == 42 || n == "42")');
		expect(quickExpression({ property: 'status', match: 'is', value: 'new' }, ['todo'])).toBe('status == "new"');
		expect(quickExpression({ property: 'status', match: 'is', value: '  ' }, ['todo'])).toBeNull();
	});

	it('suggests the values that notes have now, with the collector of property switches', () => {
		expect(quickValues('area', ['work', ['home', 'work'], '', null, 3])).toEqual(['3', 'home', 'work']);
	});
});

describe('remove and clear', () => {
	it('criterion 4: removing the chip gives back the original bytes', () => {
		const withComments = `# board\nfilters:\n  and:\n    - file.inFolder("Tasks") # only tasks\n    - 'priority != "low"'\nviews:\n  - type: table\n    name: All\nfilterSwitches:\n  # mine\n  groups:\n    - name: S\n      switches:\n        - label: A\n          filter: a == 1\n`;
		for (const base of [TASKS, withComments, 'views:\n  - type: table\n    name: All\n']) {
			const on = runOp(base, 'quick', ['my author', 'contains', 'Le', [], false]);
			expect(on).not.toBe(base);
			expect(runOp(on, 'quick-remove', ['note["my author"].toString().lower().contains("le")'])).toBe(base);
			expect(runOp(on, 'quick-clear', [])).toBe(base);
		}
	});

	it('criterion 16: a quick filter edited by hand stays in the base as a hand-typed filter', () => {
		const on = runOp(TASKS, 'quick', ['status', 'is', 'todo', ['todo'], false]);
		const edited = on.replace('    - status == "todo"\n', '    - status == "todo" || status == "doing"\n');
		expect(activeQuick(edited)).toEqual([]);
		const out = removeQuick(edited, 'status == "todo"');
		expect(out).toContain('    - status == "todo" || status == "doing"\n');
		expect(readQuick(out)).toEqual([]);
		expect(clearQuick(edited)).toContain('status == "todo" || status == "doing"');
	});

	it('removes nothing for an unknown filter, and clear on a base without quick filters keeps the same string', () => {
		expect(removeQuick(TASKS, 'x == 1')).toBe(TASKS);
		expect(clearQuick(TASKS)).toBe(TASKS);
	});
});

describe('free and Pro limits', () => {
	it(`criterion 5: free has ${FREE_QUICK} quick filter, a second one replaces the first`, () => {
		const one = runOp(TASKS, 'quick', ['status', 'is', 'todo', ['todo'], false]);
		const two = runOp(one, 'quick', ['area', 'is', 'work', ['work'], false]);
		expect(two).not.toContain('status == "todo"');
		expect(two).toContain('    - file.inFolder("Tasks")\n    - area == "work"\n');
		expect(readQuick(two).map((q) => q.filter)).toEqual(['area == "work"']);
	});

	it(`criterion 5: Pro joins up to ${PRO_QUICK} with and, and refuses the sixth`, () => {
		let t = TASKS;
		for (let i = 1; i <= PRO_QUICK; i++) t = runOp(t, 'quick', [`p${i}`, 'is', 'x', ['x'], true]);
		expect(readQuick(t)).toHaveLength(PRO_QUICK);
		expect(t).toContain('    - p1 == "x"\n    - p2 == "x"\n');
		const groups = readConfig(t).groups;
		const sixth = addQuick(t, groups, { property: 'p6', match: 'is', value: 'x' }, ['x'], PRO_QUICK);
		expect(sixth.text).toBe(t);
		expect(sixth.error).toMatch(/5 quick filters/);
	});

	it('a free user after Pro: the new filter replaces every active quick filter', () => {
		let t = TASKS;
		for (const p of ['a', 'b']) t = runOp(t, 'quick', [p, 'is', 'x', ['x'], true]);
		t = runOp(t, 'quick', ['c', 'is', 'x', ['x'], false]);
		expect(readQuick(t).map((q) => q.property)).toEqual(['c']);
		expect(t).not.toContain('a == "x"');
	});

	it('refuses a filter that the base already has, or that a switch owns', () => {
		const hand = `filters:\n  and:\n    - status == "todo"\n`;
		expect(addQuick(hand, [], { property: 'status', match: 'is', value: 'todo' }, ['todo'], 1).error).toMatch(/already/);
		const sw = `filterSwitches:\n  groups:\n    - name: Status\n      switches:\n        - label: Todo\n          filter: status == "todo"\n`;
		const r = addQuick(sw, readConfig(sw).groups, { property: 'status', match: 'is', value: 'todo' }, ['todo'], 1);
		expect(r.text).toBe(sw);
		expect(r.error).toMatch(/switch Todo/);
		expect(addQuick(TASKS, [], { property: 'status', match: 'is', value: '' }, [], 1).error).toMatch(/type a value/);
	});
});

describe('wrapping and state', () => {
	it('criterion 6: a bare string filter or an or filter gets an and list that keeps the old filter first', () => {
		expect(runOp('filters: file.hasTag("x")\n', 'quick', ['a', 'is', 'b', ['b'], false])).toBe('filters:\n  and:\n    - file.hasTag("x")\n    - a == "b"\nfilterSwitches:\n  quick:\n    - property: a\n      match: is\n      value: b\n      filter: a == "b"\n');
		const or = runOp('filters:\n  or:\n    - a == 1\n    - a == 2\n', 'quick', ['b', 'is', 'c', ['c'], false]);
		expect(or).toContain('filters:\n  and:\n    - or:\n        - a == 1\n        - a == 2\n    - b == "c"\n');
	});

	it('criterion 7 and 18: switches, pauses, presets and the default stay as they are', () => {
		const base = `filters:\n  and:\n    - status == "todo"\nviews:\n  - type: table\n    name: All\n    filters:\n      and:\n        - x == 1\nfilterSwitches:\n  groups:\n    - name: Status\n      switches:\n        - label: Todo\n          filter: status == "todo"\n        - label: Done\n          filter: status == "done"\n    - name: P\n      switches:\n        - label: High\n          filter: priority == "high"\n  presets:\n    - name: Open\n      on: [Status/Todo]\n  default: [Status/Todo]\n  paused:\n    P: [High]\n`;
		const groups = readConfig(base).groups;
		const out = runOp(base, 'quick', ['area', 'is', 'work', ['work'], true]);
		expect(readSelection(out, groups)).toEqual(readSelection(base, groups));
		expect(readPaused(out, 'P')).toEqual(['High']);
		expect(readConfig(out).presets).toEqual(readConfig(base).presets);
		expect(readDefault(out)).toEqual(['Status/Todo']);
		expect(out).toContain('    filters:\n      and:\n        - x == 1\n');
		// A switch click and a preset keep the quick filter; saving a preset or the default never stores it.
		const toggled = runOp(out, 'toggle', ['Status', 'Done']);
		expect(activeQuick(toggled).map((q) => q.filter)).toEqual(['area == "work"']);
		expect(runOp(toggled, 'save-preset', ['Mine'])).toContain('on:\n        - Status/Todo\n        - Status/Done');
		expect(runOp(toggled, 'save-default', [])).not.toMatch(/default:[^\n]*area/);
		expect(activeQuick(runOp(toggled, 'preset', ['Open'])).map((q) => q.filter)).toEqual(['area == "work"']);
	});
});

describe('Property choices', () => {
	const base = `views:\n  - type: table\n    name: All\n    order:\n      - file.name\n      - status\n      - note.area\n      - formula.x\n  - type: table\n    name: Other\n    order:\n      - priority\n`;
	it('lists the visible note properties of the current view in column order', () => {
		expect(visibleProperties(base, 'All')).toEqual(['status', 'area']);
		expect(visibleProperties(base, 'Other')).toEqual(['priority']);
		expect(visibleProperties(base, null)).toEqual(['status', 'area']);
		expect(visibleProperties(base, 'Missing')).toEqual(['status', 'area']);
		expect(visibleProperties('filters: a\n', null)).toEqual([]);
	});
	it('puts the visible properties first, then the others by name', () => {
		expect(quickProperties(['status', 'area', 'gone'], ['zeta', 'area', 'alpha', 'status'])).toEqual(['status', 'area', 'alpha', 'zeta']);
	});
});
