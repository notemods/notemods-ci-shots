// esbuild loads .css imports as text (esbuild.config.mjs loader).
declare module '*.css' {
	const text: string;
	export default text;
}
