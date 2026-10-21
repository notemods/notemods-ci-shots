import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';

describe('Date property alerts', function () {
 it('loads and reloads without errors', async function () { expect(await reloadPlugin(pluginId)).toEqual({ enabled:true, reloaded:true, errors:[] }); });
 it('shows old dates quietly and requires notice acknowledgement', async function () {
  await obsidianPage.write('Due.md', '---\ndue: "2020-01-01"\nstatus: active\n---\nReview this note.');
  await obsidianPage.write('Hidden.md', '---\ndue: "2020-01-01"\nstatus: archived\n---');
  await obsidianPage.write('Future.md', '---\ndue: "2099-01-01"\nstatus: active\n---');
  await obsidianPage.write('Alerts.base', 'filters:\n  and:\n    - status == "active"\nviews:\n  - type: date-property-alerts\n    name: Reviews\n    alertProperty: note.due\n    alertsEnabled: true\n');
  await obsidianPage.openFile('Alerts.base');
  await browser.waitUntil(async () => (await browser.$('.workspace-leaf.mod-active .dpa-summary').getText()).includes('1 due'), { timeout:15000 });
  const text=await browser.$('.workspace-leaf.mod-active .date-property-alerts').getText();
  expect(text).toContain('Future'); expect(text).toContain('Due'); expect(text).not.toContain('Hidden'); expect(text).toContain('Snooze 15 minutes');
  expect(await browser.$$('.notice').length).toBe(0);
  const due = new Date().toISOString();
  await obsidianPage.write('Due.md', `---\ndue: "${due}"\nstatus: active\n---\nReview this note.`);
  await browser.waitUntil(async () => (await browser.$('.notice').getText()).includes('Date alert due'), {timeout:15000});
  const unread=await browser.executeObsidian(({app}) => Object.values(app.loadLocalStorage('date-property-alerts-deliveries') as Record<string,{delivered:boolean}>).every(s=>!s.delivered));
  expect(unread).toBe(true);
  await browser.$('.notice button').click();
  const acknowledged = await browser.executeObsidian(({app}) => app.loadLocalStorage('date-property-alerts-deliveries') as Record<string,{delivered:boolean}>);
  expect(Object.values(acknowledged).some(s=>s.delivered)).toBe(true);
  await obsidianPage.openFile('Alerts.base');
  await browser.waitUntil(async () => (await browser.$('.workspace-leaf.mod-active .date-property-alerts').getText()).includes('Delivered'), {timeout:15000});
  expect(await browser.$('.workspace-leaf.mod-active .dpa-summary').getText()).toContain('0 due');
  const ledger=await browser.executeObsidian(({app}) => app.loadLocalStorage('date-property-alerts-deliveries'));
  expect(await reloadPlugin(pluginId)).toEqual({enabled:true,reloaded:true,errors:[]});
  await obsidianPage.openFile('Future.md'); await obsidianPage.openFile('Alerts.base');
  await browser.waitUntil(async () => (await browser.$('.workspace-leaf.mod-active .date-property-alerts').getText()).includes('Delivered'), {timeout:15000});
  const persisted=await browser.executeObsidian(({app}) => app.loadLocalStorage('date-property-alerts-deliveries'));
  expect(persisted).toEqual(ledger);
  await browser.$('.workspace-leaf.mod-active .dpa-actions button').click();
  await browser.waitUntil(async () => !(await browser.$('.workspace-leaf.mod-active .date-property-alerts').getText()).includes('Delivered'), {timeout:15000});
  expect(await browser.$('.workspace-leaf.mod-active .dpa-summary').getText()).toContain('0 due');
 });
});
