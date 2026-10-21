/** Saves run in sequence. A pending snapshot replaces an older pending snapshot. */
export class SaveQueue<T> {
	private pending: T | undefined;
	private running: Promise<void> | null = null;
	error: unknown = null;
	constructor(private readonly write: (snapshot: T) => Promise<void>, private readonly changed: () => void) {}
	get busy(): boolean { return this.running !== null; }
	request(value: T): void {
		this.pending = JSON.parse(JSON.stringify(value)) as T;
		if (!this.running) {
			this.running = this.drain();
			this.changed();
		}
	}
	private async drain(): Promise<void> {
		await Promise.resolve();
		try {
			while (this.pending !== undefined) {
				const snapshot = this.pending;
				this.pending = undefined;
				await this.write(snapshot);
				this.error = null;
			}
		} catch (error) {
			this.error = error;
		} finally {
			this.running = null;
			this.changed();
		}
	}
	async flush(): Promise<boolean> {
		await this.running;
		return this.error === null;
	}
}
