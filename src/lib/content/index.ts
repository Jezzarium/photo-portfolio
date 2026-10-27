import { trips } from './mock.ts';
import type { Trip } from './types.ts';

export type { Photo, Trip } from './types.ts';

// TODO: read photos/manifest.json from R2 instead of the mock data.
export async function getTrips(): Promise<Trip[]> {
	return trips;
}
