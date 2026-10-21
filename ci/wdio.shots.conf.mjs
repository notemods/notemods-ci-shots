// wdio config for the screenshot run. One latest Obsidian, the plugin from PLUGIN_DIR, the vault from VAULT_DIR.
import * as path from 'node:path';

const need = (k) => {
	const v = process.env[k];
	if (!v) throw new Error(`${k} is not set`);
	return path.resolve(v);
};

export const config = {
	runner: 'local',
	framework: 'mocha',
	specs: ['./shots.spec.mjs'],
	maxInstances: 1,
	capabilities: [
		{
			browserName: 'obsidian',
			browserVersion: process.env.OBSIDIAN_APP_VERSION ?? 'latest',
			'wdio:obsidianOptions': {
				installerVersion: process.env.OBSIDIAN_INSTALLER_VERSION ?? 'latest',
				plugins: [need('PLUGIN_DIR')],
				vault: need('VAULT_DIR'),
			},
		},
	],
	services: ['obsidian'],
	reporters: ['obsidian'],
	cacheDir: process.env.OBSIDIAN_CACHE ?? path.resolve('.obsidian-cache'),
	mochaOpts: { ui: 'bdd', timeout: 180_000 },
	logLevel: 'warn',
};
