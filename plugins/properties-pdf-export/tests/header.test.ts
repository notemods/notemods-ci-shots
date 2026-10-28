import { describe, expect, it } from 'vitest';
import vectors from './vectors/properties-pdf-export.json';
import { DEFAULT_SETTINGS, formatValue, layoutFor, names, normalizeSettings, propertyRows, sectionRows } from '../src/header';
import { renderHeader } from '../src/render';

describe('acceptance vectors', () => {
	for (const c of vectors.cases) it(c.name, () => {
		const args = c.args as unknown[];
		let result: unknown;
		if ('function' in c && c.function === 'layoutFor') result = layoutFor(args[0] as string, args[1] as typeof DEFAULT_SETTINGS, args[2] as boolean);
		else if ('function' in c && c.function === 'sectionRows') result = sectionRows(args[0], args[1] as typeof DEFAULT_SETTINGS, args[2] as number | null);
		else if ('function' in c && c.function === 'normalizeSettings') result = normalizeSettings(args[0]);
		else result = propertyRows(args[0], { ...DEFAULT_SETTINGS, ...args[1] as object });
		expect(result).toEqual(c.expected);
	});
});
describe('edge cases', () => {
	it('does not mutate frontmatter', () => { const fm = Object.freeze({ a: Object.freeze(['A','B']) }); propertyRows(fm); expect(fm.a).toEqual(['A','B']); });
	it('handles cycles', () => { const v: unknown[] = []; v.push(v); expect(formatValue(v)).toBe('[nested value]'); });
	it('formats dates', () => expect(formatValue(new Date('2026-10-21T00:00:00Z'))).toBe('2026-10-21'));
	it('handles invalid dates', () => expect(formatValue(new Date('invalid'))).toBe(''));
	it('rejects arrays as frontmatter', () => expect(propertyRows(['a'])).toEqual([]));
	it('deduplicates names', () => expect(names(' a, a\nb, ')).toEqual(['a','b']));
	it('hides exact names only', () => expect(propertyRows({ Author:'Ada', author:'B' }, {...DEFAULT_SETTINGS,hidden:'author'})).toEqual([{key:'Author',value:'Ada'}]));
	it('normalizes broken settings', () => expect(normalizeSettings({enabled:'no', layout:3, hidden:null, order:4, skipEmpty:0, folderLayouts:[],preview:'yes'})).toEqual(DEFAULT_SETTINGS));
	it('normalizes null', () => expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS));
	it('retains valid settings', () => expect(normalizeSettings({...DEFAULT_SETTINGS, layout:'compact',preview:true})).toMatchObject({layout:'compact',preview:true}));
	it('ignores rules without pro', () => expect(layoutFor('Work/a.md',{...DEFAULT_SETTINGS, folderLayouts:'Work = compact'},false)).toBe('table'));
	it('applies pro folder rule', () => expect(layoutFor('Work/a.md',{...DEFAULT_SETTINGS, folderLayouts:'Work = compact'},true)).toBe('compact'));
	it('uses deepest folder', () => expect(layoutFor('Work/Team/a.md',{...DEFAULT_SETTINGS, folderLayouts:'Work = compact\nWork/Team = table'},true)).toBe('table'));
	it('does not match a folder prefix', () => expect(layoutFor('Workers/a.md',{...DEFAULT_SETTINGS, folderLayouts:'Work = compact'},true)).toBe('table'));
	it('ignores invalid rules', () => expect(layoutFor('Work/a.md',{...DEFAULT_SETTINGS, folderLayouts:'Work = banana\nWork'},true)).toBe('table'));
	it('normalizes folder separators', () => expect(layoutFor('Work/Team/a.md',{...DEFAULT_SETTINGS, folderLayouts:' /Work\\Team/ = compact'},true)).toBe('compact'));
	it('keeps duplicate preferred names stable', () => expect(propertyRows({ a:1,b:2 }, {...DEFAULT_SETTINGS,order:'b,b,missing'}).map(r=>r.key)).toEqual(['b','a']));
	it('keeps multiline unicode', () => expect(formatValue('日本語\nTiếng Việt')).toBe('日本語\nTiếng Việt'));
	it('never interprets html', () => { const h = renderHeader(document.body,[{key:'<b>Key</b>',value:'<img src=x onerror=alert(1)>'}],'table',false); expect(h.querySelector('img')).toBeNull(); expect(h.querySelector('dt')?.textContent).toBe('<b>Key</b>'); });
	it('renders compact accessible header', () => { const h = renderHeader(document.body,[{key:'a',value:'A'}],'compact',true); expect(h.classList.contains('ppe-compact')).toBe(true); expect(h.classList.contains('ppe-preview')).toBe(true); expect(h.getAttribute('aria-label')).toBe('Note properties'); });
});
