/** The view calls parse(source) without caching. Do not include the optional LRU module. */
export class Caches {
	constructor() { throw new Error('Parser caching is not enabled in Pocket Markwhen.'); }
}
export { Caches as Cache };
