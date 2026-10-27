import type { Photo, Trip } from './types.ts';

// Placeholder content until real trips are uploaded to R2.

const RATIOS = [
	[3, 2],
	[2, 3],
	[4, 5],
	[3, 2],
	[16, 9],
	[1, 1],
	[5, 4],
	[3, 2]
];

const TITLES = [
	'Morning light', 'Side street', 'Platform 4', 'Harbour', 'Window seat', 'Crossing',
	'Rooftops', 'Market', 'Late train', 'Shoreline', 'Courtyard', 'Stairs', 'Fog',
	'Neon', 'Bridge', 'Lanterns', 'Corner café', 'Open field', 'Long shadows', 'Rain',
	'Overpass', 'Tram', 'Ridge', 'Dusk', 'Laundry', 'Gate', 'Steam', 'Night bus'
];

const DESCRIPTIONS = [
	'Waited for the crowd to thin out, then the light did the rest.',
	'Shot on the walk back, a few minutes before everything turned blue.',
	'One of those places you only find by taking the wrong turn.',
	'The whole street smelled like rain and grilled corn.'
];

function photos(slug: string, count: number, hue: number): Photo[] {
	return Array.from({ length: count }, (_, i) => {
		const [w, h] = RATIOS[(i * 5 + slug.length) % RATIOS.length];
		return {
			id: String(i + 1).padStart(2, '0'),
			title: TITLES[(i + slug.length * 3) % TITLES.length],
			description: i % 4 === 3 ? undefined : DESCRIPTIONS[i % DESCRIPTIONS.length],
			width: w * 1000,
			height: h * 1000,
			color: `hsl(${hue + ((i * 23) % 40)} 14% 46%)`
		};
	});
}

export const trips: Trip[] = [
	{ slug: 'japan', name: 'Japan', year: 2025, cover: '03', photos: photos('japan', 24, 200) },
	{ slug: 'lyon', name: 'Lyon', year: 2024, cover: '01', photos: photos('lyon', 18, 30) },
	{ slug: 'montreal', name: 'Montréal', year: 2024, cover: '02', photos: photos('montreal', 5, 340) },
	{ slug: 'iceland', name: 'Iceland', year: 2023, cover: '05', photos: photos('iceland', 9, 180) },
	{ slug: 'portugal', name: 'Portugal', year: 2023, cover: '04', photos: photos('portugal', 12, 15) }
];
