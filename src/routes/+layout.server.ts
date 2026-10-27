import { getTrips } from '#lib/content/index.ts';

export async function load() {
	return { trips: await getTrips() };
}
