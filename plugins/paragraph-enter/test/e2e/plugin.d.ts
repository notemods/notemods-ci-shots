import type ParagraphEnterPlugin from '../../src/main';
declare module 'wdio-obsidian-service' { interface InstalledPlugins { paragraphEnter: ParagraphEnterPlugin } }
