<script lang="ts">
	import { onMount } from 'svelte';
	import { onNavigate, preloadCode } from '$app/navigation';
	import { page } from '$app/state';
	import Photo from '#lib/Photo.svelte';
	import { hero, opened, thumb } from '#lib/hero.svelte.ts';
	import { preload, ratio, sizes, srcset } from '#lib/images.ts';

	let { data, children } = $props();
	let trip = $derived(data.trip);

	// Opening a photo from the grid: tell the viewer to fly it in from its thumbnail.
	onNavigate(({ from, to }) => {
		const id = to?.params?.photo;
		if (!id || from?.params?.photo || to?.params?.trip !== trip.slug) return;
		const img = thumb(id)?.querySelector('img');
		opened.id = id;
		opened.preview = img?.complete && img.naturalWidth ? img.currentSrc : undefined;
	});

	// The viewer's code (and anime.js with it) stays out of the page's first load, but is fetched
	// once the page has finished loading and the browser is idle, so opening a photo never waits on it.
	onMount(() => {
		const fetchViewer = () => preloadCode('/[trip]/[photo]');
		// Safari has no requestIdleCallback.
		const idle = () => ('requestIdleCallback' in window ? requestIdleCallback(fetchViewer) : setTimeout(fetchViewer, 200));
		if (document.readyState === 'complete') idle();
		else addEventListener('load', idle, { once: true });
		return () => removeEventListener('load', idle);
	});

	/* Hovering a thumbnail gets its full-size image ready for opening. With a mouse, only once the
	   pointer settles on it: running it over the grid shouldn't queue up a download for every photo
	   it crosses, while the thumbnails themselves are still loading. A touch goes straight ahead,
	   since it's about to open. */
	let intent: ReturnType<typeof setTimeout> | undefined;

	function hover(e: PointerEvent, photo: (typeof trip.photos)[number]) {
		clearTimeout(intent);
		const go = () => preload(srcset(trip, photo), sizes.viewer(photo));
		if (e.pointerType === 'mouse') intent = setTimeout(go, 80);
		else go();
	}
</script>

<svelte:head>
	<title>{trip.name} — Photographs</title>
</svelte:head>

<header>
	<h1>{trip.name}</h1>
	<p>{trip.year} · {trip.photos.length} photos</p>
</header>

<!-- The grid stays mounted while a photo is open, so closing it keeps the scroll position. The
     first few thumbnails load first, unless a photo is open over them (landing on its link). -->
<ul class="grid">
	{#each trip.photos as photo, i (photo.id)}
		{@const flying = hero.hidden === photo.id}
		<li style:--ar={ratio(photo)} style:--i={Math.min(i, 12)} class="enter" data-thumb={photo.id}>
			<a
				href="/{trip.slug}/{photo.id}"
				data-sveltekit-reset="false"
				onpointerenter={(e) => hover(e, photo)}
				onpointerleave={() => clearTimeout(intent)}
			>
				<Photo
					class="thumb {flying ? 'flying' : ''}"
					{trip}
					{photo}
					sizes={sizes.thumb(photo)}
					eager={i < 6 || flying}
					fetchpriority={i < 4 && !page.params.photo ? 'high' : undefined}
				/>
				<span>{photo.title}</span>
			</a>
		</li>
	{/each}
</ul>

{@render children()}

<style>
	/* Leaves room for the floating back button. */
	header {
		margin: 56px 0 32px;
	}

	h1 {
		font-size: clamp(28px, 4vw, 40px);
		line-height: 1.1;
		letter-spacing: -0.01em;
		width: fit-content;
	}

	header p {
		margin-top: 6px;
		color: var(--muted);
		font-size: 13px;
	}

	/* Justified rows: items grow in proportion to their aspect ratio, so every
	   photo in a row ends up the same height. Pure CSS, no layout script. */
	.grid {
		--row: 300px;
		display: flex;
		flex-wrap: wrap;
		gap: 32px 12px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.grid::after {
		content: '';
		flex: 999 1 0;
	}

	li {
		flex: var(--ar) 1 calc(var(--ar) * var(--row));
		min-width: 0;
	}

	/* Backwards only: hidden until its turn, and nothing left applied once it's done. */
	li.enter {
		animation: rise var(--spring-ui-duration) var(--spring-ui) backwards;
		animation-delay: calc(var(--i) * 30ms);
	}

	.grid :global(.thumb) {
		aspect-ratio: var(--ar);
	}

	/* The photo itself is flying to or from here. */
	.grid :global(.thumb.flying) {
		visibility: hidden;
	}

	span {
		display: block;
		margin-top: 8px;
		font-size: 13px;
		color: var(--muted);
		transition: color 150ms ease;
	}

	a:hover span {
		color: var(--fg);
	}

	@media (max-width: 640px) {
		.grid {
			--row: 180px;
			gap: 24px 8px;
		}
	}
</style>
