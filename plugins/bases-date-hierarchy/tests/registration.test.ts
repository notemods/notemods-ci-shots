import { afterEach, expect, it, vi } from 'vitest';
const harness = vi.hoisted(() => ({ registered: vi.fn(() => false), notice: vi.fn() }));
vi.mock('obsidian', () => ({
 Notice: harness.notice,
 Plugin: class {
  app = { ['workspace']: { onLayoutReady: vi.fn() } }; manifest = { id: 'bases-date-hierarchy' };
  register = vi.fn(); addSettingTab = vi.fn(); registerHoverLinkSource = vi.fn(); registerBasesView = harness.registered;
 },
}));
vi.mock('../src/view', () => ({ VIEW_ID: 'bases-date-hierarchy', DateHierarchyView: class {}, viewOptions: () => [] }));
vi.mock('../src/settings', () => ({ DateHierarchySettingTab: class { update() {} } }));
vi.mock('../src/license/github-obsidian', () => ({ createGitHubSponsors: () => ({ init() {}, onChange: () => () => {}, isPro: () => false }) }));
import Plugin from '../src/main';
import { resetPro } from '../src/pro';
afterEach(() => { resetPro(); vi.clearAllMocks(); });
it('explains how to recover when Bases refuses registration', () => {
 harness.registered.mockReturnValue(false); new Plugin().onload();
 expect(harness.notice).toHaveBeenCalledWith(expect.stringContaining('Enable the bases core plugin'));
});
it('loads silently when Bases accepts registration', () => {
 harness.registered.mockReturnValue(true); new Plugin().onload(); expect(harness.notice).not.toHaveBeenCalled();
});
