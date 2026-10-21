import { browser, expect } from '@wdio/globals';

describe('Public renderer bridge', () => {
 it('runs a dynamic command through the public Markdown renderer', async () => {
  const result = await browser.executeObsidian(async ({ app, obsidian }) => {
   const path = 'Renderer probe.md';
   const file = app.vault.getFileByPath(path) ?? await app.vault.create(path, '<%+ 1 + 1 %>');
   const component = new obsidian.Component();
   component.load();
   const el = document.createElement('div');
   document.body.append(el);
   try {
    await obsidian.MarkdownRenderer.render(app, '<%+ 1 + 1 %>', el, file.path, component);
    return { text: el.textContent?.trim(), source: await app.vault.read(file) };
   } finally { component.unload(); el.remove(); }
  });
  expect(result).toEqual({ text: '2', source: '<%+ 1 + 1 %>' });
 });
});
