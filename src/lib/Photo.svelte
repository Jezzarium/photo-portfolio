<script lang="ts">
	import type { HTMLImgAttributes } from 'svelte/elements';
	import { fade } from 'svelte/transition';
	import { blurred, fallback, srcset } from './images.ts';
	import type { Photo, Trip } from './content/index.ts';

	/**
	 * A photo that shows its blurred placeholder (with a soft light sweep) until the
	 * real image has loaded, then fades the image in over it. The wrapper is the box:
	 * size it from the parent with `class`, and the image fills it.
	 */
	let {
		trip,
		photo,
		sizes,
		class: className = '',
		style = '',
		eager = false,
		...rest
	}: {
		trip: Trip;
		photo: Photo;
		sizes: string;
		class?: string;
		style?: string;
		eager?: boolean;
	} & Omit<HTMLImgAttributes, 'src' | 'srcset' | 'sizes' | 'class' | 'style'> = $props();

	let img = $state<HTMLImageElement>();
	let loaded = $state(false);

	// Covers images that finished loading before hydration, when `onload` already fired.
	$effect(() => {
		if (img?.complete && img.naturalWidth) loaded = true;
	});
</script>

<span
	class="photo {className}"
	class:loaded
	{style}
	style:background-color={photo.color}
	style:background-image={blurred(photo)}
>
	{#if !loaded}
		<span class="sweep" out:fade={{ duration: 300 }}></span>
	{/if}
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
		onload={() => (loaded = true)}
		{...rest}
	/>
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
	:global(.js) .photo:not(.loaded) img {
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
	}

	@keyframes sweep {
		to {
			transform: translateX(100%);
		}
	}
</style>
