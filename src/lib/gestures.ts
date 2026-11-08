/**
 * iOS-style rubber band: the further past the edge, the more it resists.
 * `dimension` is the size of the scrolling area; the result never reaches it.
 */
export function rubberBand(distance: number, dimension: number, c = 0.55) {
	return (1 - 1 / ((distance * c) / dimension + 1)) * dimension;
}

/** Release velocity from the last ~100ms of movement, in px/s. */
export class VelocityTracker {
	#samples: { t: number; x: number; y: number }[] = [];

	add(t: number, x: number, y: number) {
		this.#samples.push({ t, x, y });
		while (this.#samples.length > 2 && this.#samples[0].t < t - 100) this.#samples.shift();
	}

	velocity(now: number) {
		const recent = this.#samples.filter((s) => s.t >= now - 100);
		const first = recent[0];
		const last = recent.at(-1);
		// Held still before letting go: no flick.
		if (!first || !last || last.t - first.t < 1 || now - last.t > 50) return { x: 0, y: 0 };
		const dt = (last.t - first.t) / 1000;
		return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
	}
}
