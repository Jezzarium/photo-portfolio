import { error } from '@sveltejs/kit';

export async function load({ params, parent }) {
	const { trip } = await parent();
	const index = trip.photos.findIndex((p) => p.id === params.photo);
	if (index === -1) error(404, 'Photo not found');
	return {
		photo: trip.photos[index],
		index,
		prev: trip.photos[index - 1],
		next: trip.photos[index + 1]
	};
}
