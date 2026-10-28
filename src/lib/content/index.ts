import { ORIGIN } from '../images.ts';
import type { Trip } from './types.ts';

export type { Photo, Trip } from './types.ts';

/** How long a server instance reuses the manifest before reading it again. */
const MANIFEST_TTL = 60_000;

let manifest: { at: number; trips: Promise<Trip[]> } | undefined;

/** Every trip, newest first. Written to R2 by scripts/upload.ts. */
export function getTrips(): Promise<Trip[]> {
	if (!manifest || Date.now() - manifest.at > MANIFEST_TTL) {
		const trips = fetch(`${ORIGIN}/manifest.json`).then(async (res) => {
			if (res.status === 404) return [];
			if (!res.ok) throw new Error(`Couldn't load the manifest (${res.status})`);
			return ((await res.json()) as { trips: Trip[] }).trips;
		});
		// Don't keep a failed read around; try again on the next request.
		trips.catch(() => (manifest = undefined));
		manifest = { at: Date.now(), trips };
	}
	return manifest.trips;
}
