<script lang="ts">
	import type { HTMLImgAttributes } from 'svelte/elements';
	import { blurred, fallback, srcset } from './images.ts';
	import type { Photo, Trip } from './content/index.ts';

	/**
	 * A photo that shows its blurred placeholder (with a soft light sweep) until the
	 * real image has loaded, then fades the image in over it. The wrapper is the box:
	 * size it from the parent with `class`, and the image fills it. `preview` is an image that has
	 * already loaded (like the grid thumbnail of a photo being opened) to show instead of the blur.
	 *
	 * Loading is tracked in CSS, not component state: a listener in app.html sets `data-loaded` on
	 * every image as it arrives, so each one fades in by itself, even before the page's script has
	 * started, and a grid of them loading never makes Svelte do any work.
	 */
	let {
		trip,
		photo,
		sizes,
		class: className = '',
		style = '',
		eager = false,
		preview,
		...rest
	}: {
		trip: Trip;
		photo: Photo;
		sizes: string;
		class?: string;
		style?: string;
		eager?: boolean;
		preview?: string;
	} & Omit<HTMLImgAttributes, 'src' | 'srcset' | 'sizes' | 'class' | 'style'> = $props();

	let img: HTMLImageElement;

	// In case an image somehow finished before the listener could see it.
	$effect(() => {
		if (img.complete && img.naturalWidth) img.setAttribute('data-loaded', '');
	});
</script>

<span
	class="photo {className}"
	{style}
	style:background-color={photo.color}
	style:background-image={preview ? `url("${preview}")` : blurred(photo)}
>
	<img
		bind:this={img}
		src={fallback(trip, photo)}
		srcset={srcset(trip, photo)}
		{sizes}
		width={photo.width}
		height={photo.height}
		loading={eager ? 'eager' : 'lazy'}
		decoding="async"
		draggable="false"
		alt={photo.title}
		{...rest}
	/>
	{#if !preview}
		<span class="sweep"></span>
	{/if}
</span>

<style>
	.photo {
		position: relative;
		display: block;
		overflow: hidden;
		background-size: cover;
		background-position: center;
	}

	img {
		position: relative;
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: opacity 500ms ease;
	}

	/* Without JS the image is simply shown; with JS it waits to fade in over the placeholder. */
	:global(.js) img:not([data-loaded]) {
		opacity: 0;
	}

	/* A soft band of light drifting across the placeholder while the image loads. Only
	   `transform` animates, so it stays on the compositor. Staggered by the grid's --i. */
	.sweep {
		position: absolute;
		inset: 0;
		background: linear-gradient(100deg, transparent 30%, rgb(255 255 255 / 0.16) 50%, transparent 70%);
		transform: translateX(-100%);
		animation: sweep 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
		animation-delay: calc(var(--i, 0) * 70ms);
		pointer-events: none;
	}

	/* Once the image is in, the sweep fades out and then goes for good (display: none stops its
	   animation and drops its layer). Without JS there's no fade-in to wait for, so no sweep. */
	img[data-loaded] + .sweep {
		opacity: 0;
		display: none;
		transition:
			opacity 300ms ease,
			display 300ms allow-discrete;
	}

	:global(html:not(.js)) .sweep {
		display: none;
	}

	@keyframes sweep {
		to {
			transform: translateX(100%);
		}
	}
</style>
