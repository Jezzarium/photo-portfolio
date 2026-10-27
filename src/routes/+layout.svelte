<script lang="ts">
	import { tick } from 'svelte';
	import { onNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { preload, sizes, srcset } from '#lib/images.ts';
	import { morph } from '#lib/morph.svelte.ts';
	import { springCSS } from '#lib/springs.ts';
	import '../app.css';

	let { data, children } = $props();

	onNavigate(async (navigation) => {
		if (!document.startViewTransition) return;
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		const from = navigation.from?.params ?? {};
		const to = navigation.to?.params ?? {};
		if (navigation.from?.url.pathname === navigation.to?.url.pathname) return;
		// Photo -> photo pages inside the viewer itself (see the photo route), so no morph.
		if (from.photo && to.photo && from.trip === to.trip) return;

		// Catalogue <-> trip morphs the cover; trip <-> photo morphs the opened photo.
		const trip = data.trips.find((t) => t.slug === (to.trip ?? from.trip));
		const photoId = to.photo ?? from.photo ?? trip?.cover;
		const photo = trip?.photos.find((p) => p.id === photoId);
		morph.trip = trip?.slug;
		morph.photo = photo?.id;
		await tick();

		// Have the destination image decoded before the browser snapshots it.
		if (trip && photo) {
			const size = to.photo ? sizes.viewer : to.trip ? sizes.thumb(photo) : sizes.card(photo);
			await Promise.race([preload(srcset(trip, photo), size), new Promise((r) => setTimeout(r, 300))]);
		}

		return new Promise((resolve) => {
			const transition = document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
			transition.finished.finally(() => {
				morph.trip = morph.photo = undefined;
			});
		});
	});
</script>

<svelte:head>
	{@html `<style>${springCSS}</style>`}
</svelte:head>

{#if page.params.trip}
	<a class="back" href="/" aria-label="All trips">
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
	</a>
{/if}

<main>
	{@render children()}
</main>

<footer>
	<a href="https://jabourjailibilodeau.ca">Justin Abourjaili-Bilodeau</a>
</footer>

<style>
	main {
		padding: 24px var(--gutter) 0;
	}

	.back {
		position: fixed;
		top: 16px;
		left: var(--gutter);
		z-index: 10;
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: color-mix(in oklab, var(--bg) 72%, transparent);
		backdrop-filter: blur(16px) saturate(1.6);
		-webkit-backdrop-filter: blur(16px) saturate(1.6);
		box-shadow: 0 0 0 0.5px color-mix(in oklab, var(--fg) 14%, transparent);
		view-transition-name: back;
		transition: transform var(--spring-ui-duration) var(--spring-ui);
	}

	/* Transition snapshots are flat rectangles, so a backdrop blur would smear a square behind the button. */
	:global(:root:active-view-transition) .back {
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
		background: color-mix(in oklab, var(--bg) 92%, var(--fg));
	}

	.back:hover {
		transform: scale(1.06);
	}

	.back:active {
		transform: scale(0.92);
	}

	.back svg {
		width: 20px;
		height: 20px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	footer {
		padding: 96px var(--gutter) 32px;
		font-size: 13px;
		color: var(--muted);
	}

	footer a {
		transition: color 150ms ease;
	}

	footer a:hover {
		color: var(--fg);
	}
</style>
