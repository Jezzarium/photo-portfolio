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

/**
 * A spring stepped once per frame. Unlike a CSS transition it keeps its velocity when it's
 * retargeted or grabbed, so quick swipes and key presses build on each other instead of
 * restarting from rest. `response` and `damping` mean the same as in `spring()` (springs.ts).
 */
export class SpringValue {
	value: number;
	velocity = 0;
	target: number;
	#k: number;
	#c: number;
	#onchange: (value: number) => void;
	#frame = 0;
	#last = 0;

	constructor(value: number, response: number, damping: number, onchange: (value: number) => void) {
		const w0 = (2 * Math.PI) / response;
		this.value = this.target = value;
		this.#k = w0 * w0;
		this.#c = 2 * damping * w0;
		this.#onchange = onchange;
	}

	get moving() {
		return this.#frame !== 0;
	}

	/** Jumps straight to `value` (e.g. following a finger) and stops. */
	set(value: number) {
		this.stop();
		this.value = this.target = value;
		this.velocity = 0;
		this.#onchange(value);
	}

	/** Springs to `target` from wherever it is, keeping its current velocity. */
	to(target: number) {
		this.target = target;
		if (this.#frame) return;
		this.#last = performance.now();
		this.#frame = requestAnimationFrame(this.#tick);
	}

	stop() {
		cancelAnimationFrame(this.#frame);
		this.#frame = 0;
	}

	#tick = (now: number) => {
		// Small fixed substeps keep it stable; a long stall is capped rather than jumped over.
		const dt = Math.min(Math.max(now - this.#last, 0), 64) / 1000;
		this.#last = now;
		const steps = Math.ceil(dt / 0.004);
		for (let i = 0; i < steps; i++) {
			const a = -this.#k * (this.value - this.target) - this.#c * this.velocity;
			this.velocity += (a * dt) / steps;
			this.value += (this.velocity * dt) / steps;
		}
		if (Math.abs(this.value - this.target) < 5e-4 && Math.abs(this.velocity) < 0.01) {
			this.value = this.target;
			this.velocity = 0;
			this.#frame = 0;
		} else this.#frame = requestAnimationFrame(this.#tick);
		this.#onchange(this.value);
	};
}
