import type { Photo, Trip } from './content/index.ts';

/** Generated widths for every photo. The upload script (scripts/upload.ts) produces this same set. */
export const WIDTHS = [480, 960, 1600, 2400];

export const ORIGIN = 'https://r2.jabourjailibilodeau.ca/photos';

/** The widths that exist for a photo: none wider than the original, but always at least one. */
export function widths(photo: Pick<Photo, 'width'>) {
	const fit = WIDTHS.filter((w) => w <= photo.width);
	return fit.length ? fit : [WIDTHS[0]];
}

/** A photo's file name at one width: AVIF, or a gain-map JPEG for HDR photos. */
export const file = (photo: Pick<Photo, 'id' | 'hdr'>, width: number) =>
	`${photo.id}-${width}.${photo.hdr ? 'jpg' : 'avif'}`;

export function src(trip: Trip, photo: Photo, width: number) {
	return `${ORIGIN}/${trip.slug}/${file(photo, width)}`;
}

/** The plain `src` fallback: 960 wide, or the largest there is below that. */
export const fallback = (trip: Trip, photo: Photo) =>
	src(trip, photo, widths(photo).filter((w) => w <= 960).at(-1)!);

export function srcset(trip: Trip, photo: Photo) {
	return widths(photo)
		.map((w) => `${src(trip, photo, w)} ${w}w`)
		.join(', ');
}

export const ratio = (photo: Photo) => photo.width / photo.height;

/** `sizes` for each place a photo appears. Keep these in sync with the CSS layouts. */
export const sizes = {
	/**
	 * Catalogue card: 4:5 frame with object-fit: cover, so wide photos need extra width. One
	 * column until about 710px (plus the scrollbar), then two, then 3+ columns of 320px or more:
	 * a column is never wider than 432px once there are three (or there'd be room for another).
	 */
	card(photo: Photo) {
		const f = Math.max(1, ratio(photo) / 0.8).toFixed(2);
		return `(max-width: 740px) calc(100vw * ${f}), (max-width: 1100px) calc(50vw * ${f}), calc(432px * ${f})`;
	},
	/** Trip grid: justified rows, see --row in the trip layout. */
	thumb(photo: Photo) {
		const r = ratio(photo);
		return `(max-width: 640px) min(100vw, ${Math.round(r * 260)}px), ${Math.round(r * 440)}px`;
	},
	/**
	 * Viewer: as wide as the stage, unless the screen's height limits it first (tall photos on a
	 * wide screen). The stage is the screen less the caption column and the slide padding, see
	 * the photo route.
	 */
	viewer(photo: Photo) {
		const r = ratio(photo).toFixed(3);
		return `(min-width: 900px) min(calc(100vw - 440px), calc((100vh - 80px) * ${r})), min(100vw, calc((100vh - 92px) * ${r}))`;
	}
};

/**
 * The placeholder as a CSS background: the tiny image blurred by an SVG filter. The browser
 * rasterises it once at the element's size, so the blur costs nothing per frame.
 */
export function blurred(photo: Photo) {
	if (!photo.placeholder) return undefined;
	const svg =
		`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${photo.width} ${photo.height}' preserveAspectRatio='none'>` +
		`<filter id='b' color-interpolation-filters='sRGB'><feGaussianBlur stdDeviation='${Math.max(photo.width, photo.height) / 24}'/>` +
		`<feComponentTransfer><feFuncA type='discrete' tableValues='1 1'/></feComponentTransfer></filter>` +
		`<image width='100%' height='100%' preserveAspectRatio='none' filter='url(%23b)' href='${photo.placeholder}'/></svg>`;
	return `url("data:image/svg+xml;charset=utf-8,${svg}")`;
}

const cache = new Map<string, Promise<void>>();

/**
 * Loads and decodes an image ahead of time so it is ready when shown. At low priority: it's a
 * guess at what's next, so it shouldn't hold up anything already on screen.
 */
export function preload(srcset: string, sizes: string): Promise<void> {
	const key = `${sizes}|${srcset}`;
	let promise = cache.get(key);
	if (!promise) {
		const img = new Image();
		img.fetchPriority = 'low';
		img.sizes = sizes;
		img.srcset = srcset;
		promise = img.decode().catch(() => {});
		cache.set(key, promise);
	}
	return promise;
}
