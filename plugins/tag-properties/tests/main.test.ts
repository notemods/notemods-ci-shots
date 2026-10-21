import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import TagPropertiesPlugin from '../src/main';
import { bindPro } from '../src/pro';
import manifest from '../manifest.json';

afterEach(() => bindPro(null));

describe('plugin data and lifecycle', () => {
 it('unlocks multiple properties and core merging only with Pro', () => {
  const app = App.createConfigured__({ files: {} });
  const plugin = new TagPropertiesPlugin(app as never, manifest as never);
  plugin.settings = { properties: 'topics,company', includeCore: true };
  bindPro({ isPro: () => true } as never);
  expect(plugin.properties()).toEqual(['topics', 'company']);
  expect(plugin.includeCore()).toBe(true);
  bindPro(null);
  expect(plugin.properties()).toEqual(['topics']);
  expect(plugin.includeCore()).toBe(false);
  expect(plugin.settings.includeCore).toBe(true);
 });
 it('keeps additional properties saved when free access is active', () => {
  const app = App.createConfigured__({ files: {} });
  const plugin = new TagPropertiesPlugin(app as never, manifest as never);
  plugin.settings = { properties: 'topics,company', includeCore: true };
  bindPro(null);
  expect(plugin.properties()).toEqual(['topics']);
  expect(plugin.includeCore()).toBe(false);
  expect(plugin.settings.properties).toBe('topics,company');
 });
 it('refreshes an existing view instead of opening new panes', () => {
  const app = App.createConfigured__({ files: {} });
  const plugin = new TagPropertiesPlugin(app as never, manifest as never);
  const getLeaves = vi.fn(() => []);
  app.workspace.getLeavesOfType = getLeaves as never;
  plugin.refresh();
  expect(getLeaves).toHaveBeenCalledWith('tag-properties-view');
 });
});
