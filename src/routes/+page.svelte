<script lang="ts">
	import { reveal, sizes, src, srcset } from '#lib/images.ts';
	import { morph } from '#lib/morph.svelte.ts';

	let { data } = $props();
</script>

<svelte:head>
	<title>Photographs — Justin Abourjaili-Bilodeau</title>
</svelte:head>

<h1 class="visually-hidden">Trips</h1>

<ul class="trips">
	{#each data.trips as trip, i (trip.slug)}
		{@const cover = trip.photos.find((p) => p.id === trip.cover) ?? trip.photos[0]}
		{@const morphing = morph.trip === trip.slug}
		<li>
			<a href="/{trip.slug}">
				<div class="frame" style:background={cover.color} style:view-transition-name={morphing ? 'hero' : null}>
					<img
						class="fade"
						use:reveal
						src={src(trip, cover, 960)}
						srcset={srcset(trip, cover)}
						sizes={sizes.card(cover)}
						width={cover.width}
						height={cover.height}
						loading={i < 3 ? 'eager' : 'lazy'}
						decoding="async"
						alt=""
					/>
				</div>
				<div class="meta">
					<span class="name">{trip.name}</span>
					<span class="year">{trip.year}</span>
				</div>
			</a>
		</li>
	{/each}
</ul>

<style>
	.trips {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
		gap: 12px;
		margin: 24px 0 0;
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

	.frame {
		aspect-ratio: 4 / 5;
		overflow: hidden;
	}

	/* Specific enough to beat the global `.js img.fade` transition, which only covers opacity. */
	.frame > img.fade {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition:
			transform 700ms cubic-bezier(0.22, 1, 0.36, 1),
			opacity 400ms ease;
	}

	a:hover .frame > img {
		transform: scale(1.04);
	}

	.meta {
		position: absolute;
		inset: auto 0 0;
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		padding: 48px 18px 16px;
		background: linear-gradient(transparent, rgb(0 0 0 / 0.4));
		pointer-events: none;
	}

	.name {
		font-size: 20px;
	}

	.year {
		font-size: 13px;
		opacity: 0.8;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
</style>
