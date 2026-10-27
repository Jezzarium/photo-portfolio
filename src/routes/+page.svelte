<script lang="ts">
	import Photo from '#lib/Photo.svelte';
	import { sizes } from '#lib/images.ts';

	let { data } = $props();
</script>

<svelte:head>
	<title>Photographs — Justin Abourjaili-Bilodeau</title>
</svelte:head>

<header>
	<h1>Hey, welcome to my photography portfolio</h1>
	<p>Here's a collection of my favorite pictures that I took. Feel free to explore each portfolio!</p>
</header>

<ul class="trips">
	{#each data.trips as trip, i (trip.slug)}
		{@const cover = trip.photos.find((p) => p.id === trip.cover) ?? trip.photos[0]}
		<li>
			<a href="/{trip.slug}">
				<Photo class="frame" {trip} photo={cover} sizes={sizes.card(cover)} eager={i < 3} alt="" />
				<div class="meta">
					<span class="name">{trip.name}</span>
					<span class="year">{trip.year}</span>
				</div>
			</a>
		</li>
	{/each}
</ul>

<style>
	header {
		margin: 56px 0 32px;
	}

	h1 {
		font-size: clamp(28px, 4vw, 40px);
		line-height: 1.1;
		letter-spacing: -0.01em;
		text-wrap: balance;
	}

	header p {
		max-width: 52ch;
		margin-top: 12px;
		color: var(--muted);
		font-size: 17px;
		text-wrap: pretty;
	}

	.trips {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
		gap: 12px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	a {
		position: relative;
		display: block;
		color: #fff;
		transition: transform var(--spring-ui-duration) var(--spring-ui);
	}

	a:active {
		transform: scale(0.98);
	}

	.trips :global(.frame) {
		aspect-ratio: 4 / 5;
	}

	/* Bottom scrim so the white trip name stays readable on any photo. */
	.trips :global(.frame)::after {
		content: '';
		position: absolute;
		inset: auto 0 0;
		height: 120px;
		background: linear-gradient(transparent, rgb(0 0 0 / 0.4));
	}

	/* Specific enough to beat the Photo component's own opacity-only transition. */
	.trips :global(.frame img) {
		transition:
			transform 700ms cubic-bezier(0.22, 1, 0.36, 1),
			opacity 500ms ease;
	}

	a:hover :global(.frame img) {
		transform: scale(1.04);
	}

	.meta {
		position: absolute;
		inset: auto 0 0;
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		padding: 0 18px 16px;
		pointer-events: none;
	}

	.name {
		font-size: 20px;
	}

	.year {
		font-size: 13px;
		opacity: 0.8;
	}
</style>
