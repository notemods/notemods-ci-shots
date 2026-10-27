import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import ParagraphSpellFocusPlugin from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings, focusPolicy, parseRules } from '../src/policy';
import manifest from '../manifest.json';

describe('spelling focus policy', () => {
 it('loads safe defaults in a mocked vault', async () => {
  const app = App.createConfigured__({ files: { 'notes/a.md': '# Draft' } });
  const plugin = new ParagraphSpellFocusPlugin(app as never, manifest as never);
  await plugin.loadSettings();
  expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
 });
 it('does not apply saved Pro choices while signed out', () => {
  const settings = normalizeSettings({ scope: 'section', rules: [{ folder: 'Drafts', scope: 'off' }] });
  expect(focusPolicy(settings, 'Drafts/a.md', false)).toBe('paragraph');
  expect(focusPolicy(settings, 'Other/a.md', false)).toBe('paragraph');
  expect(focusPolicy(settings, 'Drafts/a.md', true)).toBe('off');
  expect(focusPolicy(settings, 'Other/a.md', true)).toBe('section');
 });
 it('uses the longest folder boundary and preserves explicit off', () => {
  const s = normalizeSettings({ rules: [{ folder: 'Work', scope: 'off' }, { folder: 'Work/Drafts', scope: 'section' }] });
  expect(focusPolicy(s, 'Work/Drafts/a.md', true)).toBe('section');
  expect(focusPolicy(s, 'Work/Notes/a.md', true)).toBe('off');
  expect(focusPolicy(s, 'Workshop/a.md', true)).toBe('paragraph');
 });
 it('turns focus off without a Pro check', () => {
  expect(focusPolicy({ ...DEFAULT_SETTINGS, enabled: false }, 'Drafts/a.md', false)).toBe('off');
 });
 it('rejects malformed rules and path traversal', () => {
  expect(parseRules('Drafts=section\nCode=off\n../Outside=section\nDrafts=off\nBad=maybe')).toEqual([{ folder: 'Drafts', scope: 'section' }, { folder: 'Code', scope: 'off' }]);
  expect(normalizeSettings({ enabled: 'false', highlight: 0, scope: 'bad', rules: [null] })).toEqual(DEFAULT_SETTINGS);
 });
});
