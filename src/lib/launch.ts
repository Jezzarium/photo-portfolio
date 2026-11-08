import { spring as animeSpring } from 'animejs';
import { params, type Name } from './springs.ts';

// Kept apart from springs.ts, which every page loads for its CSS springs: this pulls in anime.js,
// which only the photo viewer needs.

/**
 * The same spring as an anime.js ease, launched at `velocity`: the share of its distance it
 * covers per second, positive towards the target. anime.js uses SwiftUI's model too, so
 * `duration` is the response and `bounce` is one minus the damping.
 */
export function launch(name: Name, velocity = 0) {
	const [response, damping] = params[name];
	const ease = animeSpring({ duration: response * 1000, bounce: 1 - damping });
	ease.velocity = velocity;
	return ease;
}
