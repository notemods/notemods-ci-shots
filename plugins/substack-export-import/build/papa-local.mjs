import { readFile } from 'node:fs/promises';

export const localCsvOnly = {
		name: 'local-csv-only',
		setup(build) {
			build.onLoad({ filter: /[\\/]papaparse[\\/]papaparse(?:\.min)?\.js$/ }, async (args) => {
				const source = await readFile(args.path.replace(/papaparse\.min\.js$/, 'papaparse.js'), 'utf8');
				const start = source.indexOf('\n\tfunction NetworkStreamer(config)');
				const end = source.indexOf('\n\tNetworkStreamer.prototype', start);
				if (start < 0 || end < start) throw new Error('Papa Parse download function changed. Check the pinned version.');
				// The parser receives local strings. Remove the unused request transport.
				let contents = source.slice(0, start) + '\n\tfunction NetworkStreamer() { throw new Error("Remote CSV is not supported."); }\n' + source.slice(end);
				const nodeStart = contents.indexOf('\n\tfunction DuplexStreamStreamer(_config)');
				const nodeEnd = contents.indexOf('\n\tif (typeof PAPA_BROWSER_CONTEXT', nodeStart);
				if (nodeStart < 0 || nodeEnd < nodeStart) throw new Error('Papa Parse Node stream function changed.');
				contents = contents.slice(0, nodeStart) + '\n\tfunction DuplexStreamStreamer() { throw new Error("Node streams are not supported."); }\n' + contents.slice(nodeEnd);
				return { contents, loader: 'js' };
			});
		},
	};
