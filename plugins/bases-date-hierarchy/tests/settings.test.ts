import { afterEach, expect, it } from 'vitest';
import type { SponsorsManager } from '../src/license/index';
import { DateHierarchySettingTab } from '../src/settings';
import { bindPro, resetPro } from '../src/pro';
afterEach(() => resetPro());
function definitions(active: boolean) {
 const pro = { isPro: () => active, onChange: () => () => {} } as unknown as SponsorsManager;
 bindPro(pro);
 const tab = Object.assign(Object.create(DateHierarchySettingTab.prototype) as DateHierarchySettingTab, { plugin: { pro } });
 return tab.getSettingDefinitions();
}
it('shows exactly one offer with the requested one-time link when free', () => {
 const items = definitions(false);
 const offers = items.filter((i) => 'name' in i && i.name === 'Optional upgrade'); expect(offers).toHaveLength(1);
 const offer = offers[0]!; if (!('desc' in offer)) throw new Error('Missing offer');
 expect((offer.desc as DocumentFragment).querySelector('a')?.href).toBe('https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=bases-date-hierarchy');
 const accountGroup = items.find((i) => 'items' in i);
 expect(accountGroup && 'items' in accountGroup ? accountGroup.items?.length : 0).toBe(1);
});
it('does not show an upgrade offer to a Pro user', () => expect(definitions(true).some((i) => 'name' in i && i.name === 'Optional upgrade')).toBe(false));
