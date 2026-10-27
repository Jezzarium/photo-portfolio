<script lang="ts">
	import { page } from '$app/state';
	import { preload, ratio, reveal, sizes, src, srcset } from '#lib/images.ts';
	import { morph } from '#lib/morph.svelte.ts';

	let { data, children } = $props();
	let trip = $derived(data.trip);
</script>

<svelte:head>
	<title>{trip.name} — Photographs</title>
</svelte:head>

<header>
	<h1>{trip.name}</h1>
	<p>{trip.year} · {trip.photos.length} photos</p>
</header>

<!-- The grid stays mounted while a photo is open, so closing it keeps the scroll position. -->
<ul class="grid">
	{#each trip.photos as photo, i (photo.id)}
		{@const morphing = !page.params.photo && morph.photo === photo.id}
		<li style:--ar={ratio(photo)} style:--i={Math.min(i, 12)} class="enter">
			<a
				href="/{trip.slug}/{photo.id}"
				data-sveltekit-reset="false"
				onpointerenter={() => preload(srcset(trip, photo), sizes.viewer)}
			>
				<img
					class="fade"
					use:reveal
					src={src(trip, photo, 960)}
					srcset={srcset(trip, photo)}
					sizes={sizes.thumb(photo)}
					width={photo.width}
					height={photo.height}
					loading={i < 6 || morphing ? 'eager' : 'lazy'}
					decoding="async"
					alt={photo.title}
					style:background={photo.color}
					style:view-transition-name={morphing ? 'hero' : null}
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

	li.enter {
		animation: rise var(--spring-ui-duration) var(--spring-ui) both;
		animation-delay: calc(var(--i) * 30ms);
	}

	img {
		display: block;
		width: 100%;
		height: auto;
		aspect-ratio: var(--ar);
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
