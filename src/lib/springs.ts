/**
 * Spring physics baked into CSS `linear()` easings, so animations run on the
 * compositor (no JS per frame) while still feeling springy.
 *
 * Parameters follow SwiftUI's `.spring(response:dampingFraction:)`:
 * `response` is the period of one oscillation in seconds (lower = snappier),
 * `damping` is the damping fraction (1 = no bounce, ~0.7 = a light, clean overshoot).
 */
export function spring(response: number, damping: number) {
	const w0 = (2 * Math.PI) / response;
	const position = (t: number) => {
		if (damping < 1) {
			const wd = w0 * Math.sqrt(1 - damping * damping);
			return 1 - Math.exp(-damping * w0 * t) * (Math.cos(wd * t) + ((damping * w0) / wd) * Math.sin(wd * t));
		}
		return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
	};

	// Treat the spring as settled once it is within 0.2% of its target.
	const duration = Math.log(500) / (Math.min(damping, 1) * w0);
	const steps = 60;
	const points = Array.from({ length: steps + 1 }, (_, i) => +position((duration * i) / steps).toFixed(4));
	points[steps] = 1;

	return { easing: `linear(${points.join(', ')})`, duration: Math.round(duration * 1000) };
}

export const springs = {
	/** Photos moving between views. ~1% overshoot. */
	hero: spring(0.38, 0.82),
	/** Small UI movements: hovers, presses, captions, grid entrance. ~2% overshoot. */
	ui: spring(0.3, 0.78)
};

/** The springs as CSS custom properties, e.g. `var(--spring-hero)` and `var(--spring-hero-duration)`. */
export const springCSS = `:root{${Object.entries(springs)
	.map(([name, s]) => `--spring-${name}:${s.easing};--spring-${name}-duration:${s.duration}ms;`)
	.join('')}}`;
