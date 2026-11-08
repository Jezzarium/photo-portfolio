<script lang="ts">
	import { onNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import font from '#lib/fonts/google-sans-latin.woff2?url';
	import { cameFrom, trackHistory } from '#lib/history.ts';
	import { springCSS } from '#lib/springs.ts';
	import '../app.css';

	let { children } = $props();

	let main: HTMLElement;
	let up = $derived(page.params.photo ? `/${page.params.trip}` : '/');

	trackHistory();

	// Moving between trips (or to and from the catalogue) fades the page out and the new one in.
	// Within a trip, photos fly between the grid and the viewer instead (see the photo route).
	// Plain Web Animations (quadratic in, then out), so pages without the viewer don't need anime.js.
	onNavigate(async (navigation) => {
		if (navigation.from?.params?.trip === navigation.to?.params?.trip) return;
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		// Holds at transparent until the new page fades in over it.
		const out = main.animate({ opacity: [1, 0] }, { duration: 120, easing: 'cubic-bezier(0.11, 0, 0.5, 0)', fill: 'forwards' });
		await out.finished.catch(() => {});
		navigation.complete
			.then(() => main.animate({ opacity: [0, 1] }, { duration: 240, easing: 'cubic-bezier(0.5, 1, 0.89, 1)' }).finished)
			.catch(() => {})
			.finally(() => out.cancel());
	});
</script>

<svelte:head>
	<!-- Fetched alongside the page's CSS rather than after it, so text usually renders in it from
	     the first paint instead of swapping in (and reflowing) later. -->
	<link rel="preload" href={font} as="font" type="font/woff2" crossorigin="anonymous" />
	{@html `<style>${springCSS}</style>`}
</svelte:head>

<!-- Firefox ignores -webkit-user-drag, so stop image and link drags here too. iOS Safari only
     shows :active (pressed buttons) when something listens for touches. -->
<svelte:document ondragstart={(e) => e.preventDefault()} ontouchstart={() => {}} />

<!-- One back button for every level: an open photo goes back to its trip, a trip to the catalogue. -->
{#if page.params.trip}
	<a
		class="round-button back"
		href={up}
		data-sveltekit-reset={page.params.photo ? 'false' : null}
		onclick={(e) => {
			// Step back rather than adding an entry, so the browser's back doesn't reopen this page.
			if (!cameFrom(up)) return;
			e.preventDefault();
			history.back();
		}}
		aria-label={page.params.photo ? 'Close' : 'All trips'}
	>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
	</a>
{/if}

<main bind:this={main}>
	{@render children()}
</main>

<footer>
	<p>Photographs © {new Date().getFullYear()} <a href="https://jabourjailibilodeau.ca">Justin Abourjaili-Bilodeau</a>. All rights reserved.</p>
</footer>

<style>
	main {
		flex: 1;
		padding: 24px var(--gutter) 0;
	}

	.back {
		position: fixed;
		top: 16px;
		left: var(--gutter);
		z-index: 20; /* above the photo viewer */
		animation: pop-in var(--spring-pop-duration) var(--spring-pop);
	}

	@keyframes pop-in {
		from {
			opacity: 0;
			transform: scale(0.5);
		}
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
