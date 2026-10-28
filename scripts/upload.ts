/**
 * Uploads a trip folder to R2 and adds it to the manifest the site reads.
 *
 *   npm run upload -- trips/japan            process and upload (replaces the trip if it exists)
 *   npm run upload -- trips/japan --dry-run  process locally into .upload/, upload nothing
 *   npm run upload -- --remove japan         delete a trip's files and remove it from the manifest
 *
 * A trip folder holds the photos plus a trip.json (see trips/example). For every photo this
 * makes the AVIF widths the site asks for, a ~12px placeholder and the dominant colour.
 * Metadata (including GPS location) is stripped from everything uploaded.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp, { type Metadata, type Sharp } from 'sharp';
import type { Photo, Trip } from '../src/lib/content/types.ts';
import { ORIGIN, file, widths } from '../src/lib/images.ts';

const BUCKET = 'portfolio';
const PREFIX = 'photos';
const OUT = resolve('.upload');
const IMAGE = /\.(jpe?g|png|webp|avif|heic|heif|tiff?)$/i;
/** Names of the JPEG segments that carry gain map metadata. */
const ISO = Buffer.from('urn:iso:std:iso:ts:21496:-1\0');
const XMP = Buffer.from('http://ns.adobe.com/xap/1.0/\0');

interface Manifest {
	trips: Trip[];
}

interface TripFile {
	slug?: string;
	name: string;
	year: number;
	cover?: string;
	photos: { file: string; title: string; description?: string }[];
}

const run = promisify(execFile);
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const removeIndex = args.indexOf('--remove');

try {
	if (removeIndex !== -1) await remove(args[removeIndex + 1]);
	else await upload(args.find((a) => !a.startsWith('--')));
} catch (error) {
	console.error(`\n✗ ${error instanceof Error ? error.message : error}`);
	process.exit(1);
}

async function upload(folder: string | undefined) {
	if (!folder) throw new Error('Usage: npm run upload -- <trip folder> [--dry-run]');
	const dir = resolve(folder);
	const trip = await readTripFile(dir);
	const slug = trip.slug ?? toId(basename(dir));

	console.log(`${trip.name} (${trip.year}) → /${slug}, ${trip.photos.length} photos${dryRun ? ' [dry run]' : ''}\n`);

	const out = join(OUT, slug);
	await rm(out, { recursive: true, force: true });
	await mkdir(out, { recursive: true });

	const files: { key: string; path: string; type: string }[] = [];
	const photos: Photo[] = [];

	for (const entry of trip.photos) {
		const id = toId(basename(entry.file, extname(entry.file)));
		// .rotate() applies the EXIF orientation; sharp drops all other metadata on output.
		const source = sharp(join(dir, entry.file)).rotate();
		const meta = await source.clone().metadata();
		// EXIF orientations 5–8 are rotated 90°, so the stored width and height swap.
		const [width, height] = (meta.orientation ?? 1) >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
		const { dominant } = await source.clone().stats();

		// Same widths the site's srcset uses.
		const sizes = widths({ width });
		const hdr = !!meta.gainMap;
		for (const w of sizes) {
			const name = file({ id, hdr }, w);
			const path = join(out, name);
			const resized = source.clone().resize({ width: w, withoutEnlargement: true });
			if (hdr) await writeFile(path, await gainMapJpeg(resized, meta, join(dir, entry.file), w / width));
			else await resized.avif({ quality: 60, effort: 5 }).toFile(path);
			files.push({ key: `${PREFIX}/${slug}/${name}`, path, type: hdr ? 'image/jpeg' : 'image/avif' });
		}

		const tiny = await source
			.clone()
			.resize(12, 12, { fit: 'inside' })
			.webp({ quality: 40 })
			.toBuffer();

		photos.push({
			id,
			title: entry.title,
			...(entry.description ? { description: entry.description } : {}),
			width,
			height,
			color: `#${[dominant.r, dominant.g, dominant.b].map((c) => c.toString(16).padStart(2, '0')).join('')}`,
			placeholder: `data:image/webp;base64,${tiny.toString('base64')}`,
			...(hdr ? { hdr } : {})
		});
		console.log(`  ✓ ${entry.file} → ${id} (${width}×${height}, ${sizes.length} sizes, placeholder ${tiny.length} B${hdr ? ', HDR' : ''})`);
	}

	const cover = toId(basename(trip.cover ?? trip.photos[0].file, extname(trip.cover ?? trip.photos[0].file)));
	const entry: Trip = { slug, name: trip.name, year: trip.year, cover, photos };

	const manifest = await readManifest();
	const previous = manifest.trips.find((t) => t.slug === slug);
	manifest.trips = [...manifest.trips.filter((t) => t.slug !== slug), entry].sort((a, b) => b.year - a.year);

	const manifestPath = join(OUT, 'manifest.json');
	await writeFile(manifestPath, JSON.stringify(manifest, null, '\t'));

	if (dryRun) {
		console.log(`\nDry run: files are in ${out}, the new manifest is ${manifestPath}. Nothing was uploaded.`);
		return;
	}

	console.log(`\nUploading ${files.length} files…`);
	let done = 0;
	await pool(files, 6, async (f) => {
		await put(f.key, f.path, f.type);
		process.stdout.write(`\r  ${++done}/${files.length}`);
	});
	// The manifest goes last, so the site never points at files that aren't there yet.
	await put(`${PREFIX}/manifest.json`, manifestPath, 'application/json');

	// Files of photos that were dropped from the trip since its last upload.
	const stale = previous ? keys(previous).filter((k) => !files.some((f) => f.key === k)) : [];
	await pool(stale, 6, del);

	console.log(`\n\n✓ ${trip.name} is live${stale.length ? ` (removed ${stale.length} old files)` : ''}.`);
}

async function remove(slug: string | undefined) {
	if (!slug) throw new Error('Usage: npm run upload -- --remove <trip slug>');
	const manifest = await readManifest();
	const trip = manifest.trips.find((t) => t.slug === slug);
	if (!trip) throw new Error(`No trip "${slug}" in the manifest. Trips: ${manifest.trips.map((t) => t.slug).join(', ') || 'none'}`);

	manifest.trips = manifest.trips.filter((t) => t.slug !== slug);
	await mkdir(OUT, { recursive: true });
	const manifestPath = join(OUT, 'manifest.json');
	await writeFile(manifestPath, JSON.stringify(manifest, null, '\t'));

	if (dryRun) {
		console.log(`Dry run: would remove ${trip.name} and ${keys(trip).length} files.`);
		return;
	}
	// Manifest first, so the site stops linking to the files before they disappear.
	await put(`${PREFIX}/manifest.json`, manifestPath, 'application/json');
	await pool(keys(trip), 6, del);
	console.log(`✓ Removed ${trip.name}.`);
}

async function readTripFile(dir: string): Promise<TripFile> {
	const path = join(dir, 'trip.json');
	if (!existsSync(path)) throw new Error(`No trip.json in ${dir}. See trips/example/trip.json for the format.`);
	const trip = JSON.parse(await readFile(path, 'utf8')) as TripFile;

	const problems: string[] = [];
	if (!trip.name) problems.push('"name" is missing');
	if (!Number.isInteger(trip.year)) problems.push('"year" must be a number like 2025');
	if (!trip.photos?.length) problems.push('"photos" is empty');
	for (const p of trip.photos ?? []) {
		if (!p.file || !existsSync(join(dir, p.file))) problems.push(`photo file not found: ${p.file}`);
		if (!p.title) problems.push(`${p.file} has no "title"`);
	}
	if (trip.cover && !trip.photos?.some((p) => p.file === trip.cover)) problems.push(`cover ${trip.cover} isn't in "photos"`);
	const ids = (trip.photos ?? []).map((p) => toId(basename(p.file, extname(p.file))));
	if (new Set(ids).size !== ids.length) problems.push('two photos have the same file name');
	if (problems.length) throw new Error(`trip.json has problems:\n  - ${problems.join('\n  - ')}`);

	const listed = new Set(trip.photos.map((p) => p.file));
	const unlisted = (await readdir(dir)).filter((f) => IMAGE.test(f) && !listed.has(f));
	if (unlisted.length) console.warn(`! Not in trip.json, skipped: ${unlisted.join(', ')}\n`);

	return trip;
}

async function readManifest(): Promise<Manifest> {
	const res = await fetch(`${ORIGIN}/manifest.json?t=${Date.now()}`);
	if (res.status === 404) return { trips: [] };
	if (!res.ok) throw new Error(`Couldn't read the current manifest (${res.status}).`);
	return res.json();
}

/** Every R2 key a trip's photos use. */
function keys(trip: Trip) {
	return trip.photos.flatMap((p) => widths(p).map((w) => `${PREFIX}/${trip.slug}/${file(p, w)}`));
}

/**
 * An HDR photo as a gain-map JPEG: the SDR image, then a second JPEG of per-pixel brightness
 * boosts that HDR screens apply and others ignore. Sharp reads the gain map but drops it on
 * output, so both are resized separately and reassembled the way Lightroom writes them:
 * ISO 21496-1 and Adobe XMP gain map metadata, with an MPF index pointing at the gain map.
 */
async function gainMapJpeg(resized: Sharp, meta: Metadata, original: string, scale: number) {
	// Keep the source's profile (usually Display P3): the gain map was made against it.
	const base = await resized.keepIccProfile().jpeg({ quality: 82, mozjpeg: true }).toBuffer();

	let map = sharp(meta.gainMap!.image);
	const orientation = meta.orientation ?? 1;
	if (orientation > 1) map = sharp(await map.withMetadata({ orientation }).jpeg({ quality: 100 }).toBuffer()).rotate();
	const mapMeta = await sharp(meta.gainMap!.image).metadata();
	const mapJpeg = await map.resize({ width: Math.round(mapMeta.width * scale) }).jpeg({ quality: 85 }).toBuffer();

	// The gain map's own metadata (how strong each boost is) doesn't depend on its size, so it's copied as is.
	const mapSegments = appSegments(meta.gainMap!.image).filter(
		(s) => startsWith(s, ISO) || (startsWith(s, XMP) && s.includes('hdrgm'))
	);
	const gainMap = Buffer.concat([base.subarray(0, 2), ...mapSegments, mapJpeg.subarray(2)]);

	const xmp = segment(0xe1, Buffer.concat([XMP, Buffer.from(
		'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
		'<rdf:Description xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" hdrgm:Version="1.0"/></rdf:RDF></x:xmpmeta>'
	)]));
	// The primary image's ISO segment only holds the version, so copy it from the original.
	const iso = appSegments(await readFile(original)).find((s) => startsWith(s, ISO));
	const length = base.length + xmp.length + mpfSegment(0, 0, 0).length + (iso?.length ?? 0);
	// MPF offsets count from its TIFF header, which sits after SOI, the XMP and MPF's own marker and name.
	const mpf = mpfSegment(length, gainMap.length, length - (2 + xmp.length + 8));

	return Buffer.concat([base.subarray(0, 2), xmp, mpf, ...(iso ? [iso] : []), base.subarray(2), gainMap]);
}

/** The APPn segments of a JPEG, marker included. */
function appSegments(jpeg: Buffer) {
	const found: Buffer[] = [];
	for (let i = 2; i + 4 <= jpeg.length && jpeg[i] === 0xff && jpeg[i + 1] !== 0xda; ) {
		const end = i + 2 + jpeg.readUInt16BE(i + 2);
		if (jpeg[i + 1] >= 0xe0 && jpeg[i + 1] <= 0xef) found.push(jpeg.subarray(i, end));
		i = end;
	}
	return found;
}

function startsWith(segment: Buffer, name: Buffer) {
	return segment.subarray(4, 4 + name.length).equals(name);
}

function segment(marker: number, payload: Buffer) {
	const header = Buffer.from([0xff, marker, 0, 0]);
	header.writeUInt16BE(payload.length + 2, 2);
	return Buffer.concat([header, payload]);
}

/** A two-image MPF index (CIPA DC-007): the primary image, then the gain map right after it. */
function mpfSegment(primaryLength: number, gainMapLength: number, gainMapOffset: number) {
	const b = Buffer.alloc(86);
	b.write('MPF\0', 0, 'latin1');
	b.write('MM\0*', 4, 'latin1');
	b.writeUInt32BE(8, 8); // first IFD
	b.writeUInt16BE(3, 12);
	// IFD entries (tag, type, count, value): version "0100", 2 images, and the 32-byte image list at offset 50.
	const tag = (at: number, id: number, type: number, count: number) => {
		b.writeUInt16BE(id, at);
		b.writeUInt16BE(type, at + 2);
		b.writeUInt32BE(count, at + 4);
	};
	tag(14, 0xb000, 7, 4);
	b.write('0100', 22, 'latin1');
	tag(26, 0xb001, 4, 1);
	b.writeUInt32BE(2, 34);
	tag(38, 0xb002, 7, 32);
	b.writeUInt32BE(50, 46);
	// Next IFD is 0 (bytes 50–53), then one 16-byte entry per image: attributes, length, offset.
	b.writeUInt32BE(0x20030000, 54); // representative baseline JPEG, at offset 0
	b.writeUInt32BE(primaryLength, 58);
	b.writeUInt32BE(0x00050000, 70); // gain map
	b.writeUInt32BE(gainMapLength, 74);
	b.writeUInt32BE(gainMapOffset, 78);
	return segment(0xe2, b);
}

async function put(key: string, file: string, type: string) {
	await run('cf', ['r2', 'objects', 'put', key, '--bucket-name', BUCKET, '--file', file, '--content-type', type, '--quiet']);
}

async function del(key: string) {
	await run('cf', ['r2', 'objects', 'delete', key, '--bucket-name', BUCKET, '--force', '--quiet']);
}

/** URL-safe id from a file or folder name: "Temple Steps.jpg" → "temple-steps". */
function toId(name: string) {
	return name
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
	const queue = [...items];
	await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
		while (queue.length) await fn(queue.shift()!);
	}));
}
