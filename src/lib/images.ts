import type { Photo, Trip } from './content/index.ts';

/** Generated widths for every photo. The upload script will produce the same set. */
const WIDTHS = [480, 960, 1600, 2400];

/** Placeholder images until real photos live in R2. */
const PLACEHOLDERS = true;
const ORIGIN = 'https://r2.jabourjailibilodeau.ca/photos';

export function src(trip: Trip, photo: Photo, width: number) {
	if (PLACEHOLDERS) {
		const height = Math.round((width * photo.height) / photo.width);
		return `https://picsum.photos/seed/${trip.slug}-${photo.id}/${width}/${height}`;
	}
	return `${ORIGIN}/${trip.slug}/${photo.id}-${width}.avif`;
}

export function srcset(trip: Trip, photo: Photo) {
	return WIDTHS.filter((w) => w <= photo.width)
		.map((w) => `${src(trip, photo, w)} ${w}w`)
		.join(', ');
}

export const ratio = (photo: Photo) => photo.width / photo.height;

/** `sizes` for each place a photo appears. Keep these in sync with the CSS layouts. */
export const sizes = {
	/** Catalogue card: 4:5 frame with object-fit: cover, so wide photos need extra width. */
	card(photo: Photo) {
		const f = Math.max(1, ratio(photo) / 0.8).toFixed(2);
		return `(max-width: 700px) calc(100vw * ${f}), (max-width: 1100px) calc(50vw * ${f}), calc(33vw * ${f})`;
	},
	/** Trip grid: justified rows, see --row in the trip layout. */
	thumb(photo: Photo) {
		const r = ratio(photo);
		return `(max-width: 640px) min(100vw, ${Math.round(r * 260)}px), ${Math.round(r * 440)}px`;
	},
	viewer: '(min-width: 900px) calc(100vw - 420px), 100vw'
};

const cache = new Map<string, Promise<void>>();

/** Loads and decodes an image ahead of time so it is ready when shown. */
export function preload(srcset: string, sizes: string): Promise<void> {
	const key = `${sizes}|${srcset}`;
	let promise = cache.get(key);
	if (!promise) {
		const img = new Image();
		img.sizes = sizes;
		img.srcset = srcset;
		promise = img.decode().catch(() => {});
		cache.set(key, promise);
	}
	return promise;
}

/** Fades an image in once loaded (see `img.fade` in app.css). */
export function reveal(img: HTMLImageElement) {
	const done = () => img.classList.add('loaded');
	if (img.complete && img.naturalWidth) done();
	else img.addEventListener('load', done, { once: true });
}
