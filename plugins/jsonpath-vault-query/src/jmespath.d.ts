declare module 'jmespath' {
	export function search(data: unknown, expression: string): unknown;
	export function compile(expression: string): unknown;
}
