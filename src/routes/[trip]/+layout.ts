import { error } from '@sveltejs/kit';

export async function load({ params, parent }) {
	const { trips } = await parent();
	const trip = trips.find((t) => t.slug === params.trip);
	if (!trip) error(404, 'Trip not found');
	return { trip };
}
