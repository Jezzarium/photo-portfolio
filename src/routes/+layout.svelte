<script lang="ts">
	import { tick } from 'svelte';
	import { onNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { preload, sizes, srcset } from '#lib/images.ts';
	import { morph } from '#lib/morph.svelte.ts';
	import { springCSS } from '#lib/springs.ts';
	import '../app.css';

	let { data, children } = $props();

	/** Hidden while a view transition runs, so it is never captured in a snapshot: it keeps its live
	 *  blur and the morphing photo can't cover it. It pops out before the snapshot and springs back after. */
	let backHidden = $state(false);
	const BACK_OUT = 80;

	onNavigate(async (navigation) => {
		if (!document.startViewTransition) return;
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		const from = navigation.from?.params ?? {};
		const to = navigation.to?.params ?? {};
		if (navigation.from?.url.pathname === navigation.to?.url.pathname) return;
		// Photo -> photo pages inside the viewer itself (see the photo route), so no morph.
		if (from.photo && to.photo && from.trip === to.trip) return;

		// Trip <-> photo morphs the opened photo; catalogue <-> trip is a plain crossfade.
		const trip = data.trips.find((t) => t.slug === (to.trip ?? from.trip));
		const photo = trip?.photos.find((p) => p.id === (to.photo ?? from.photo));
		morph.photo = photo?.id;
		backHidden = true;
		await tick();

		// Have the destination image decoded, and the back button out of the way, before the browser snapshots.
		const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
		await Promise.all([
			trip && photo
				? Promise.race([preload(srcset(trip, photo), to.photo ? sizes.viewer : sizes.thumb(photo)), wait(300)])
				: null,
			from.trip ? wait(BACK_OUT) : null
		]);

		return new Promise((resolve) => {
			const transition = document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
			transition.finished.finally(() => {
				morph.photo = undefined;
				requestAnimationFrame(() => (backHidden = false));
			});
		});
	});
</script>

<svelte:head>
	{@html `<style>${springCSS}</style>`}
</svelte:head>

<!-- Firefox ignores -webkit-user-drag, so stop image and link drags here too. -->
<svelte:document ondragstart={(e) => e.preventDefault()} />

<!-- One back button for every level: an open photo goes back to its trip, a trip to the catalogue. -->
{#if page.params.trip}
	<a
		class="round-button back"
		class:hidden={backHidden}
		style:--out="{BACK_OUT}ms"
		href={page.params.photo ? `/${page.params.trip}` : '/'}
		data-sveltekit-reset={page.params.photo ? 'false' : null}
		aria-label={page.params.photo ? 'Close' : 'All trips'}
	>
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
		z-index: 20; /* above the photo viewer */
		transition:
			transform var(--spring-pop-duration) var(--spring-pop),
			opacity 200ms ease;
	}

	.back.hidden {
		opacity: 0;
		transform: scale(0.5);
		pointer-events: none;
		transition:
			transform var(--out) ease-in,
			opacity var(--out) ease-in;
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
