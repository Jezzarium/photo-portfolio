export interface Photo {
	id: string;
	title: string;
	description?: string;
	/** Original pixel dimensions, used for layout before the image loads. */
	width: number;
	height: number;
	/** Dominant color, shown while the image loads. */
	color: string;
	/** Tiny (~12px) image as a data URI, shown blurred while the real one loads. */
	placeholder?: string;
	/** Has an HDR gain map, so it is served as gain-map JPEGs instead of AVIF. */
	hdr?: boolean;
}

export interface Trip {
	slug: string;
	name: string;
	year: number;
	/** Id of the photo used on the catalogue card. */
	cover: string;
	photos: Photo[];
}
