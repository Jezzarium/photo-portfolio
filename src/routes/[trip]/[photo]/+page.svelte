<script lang="ts">
	import { untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { SpringValue, VelocityTracker, rubberBand } from '#lib/gestures.ts';
	import { preload, ratio, sizes, src, srcset } from '#lib/images.ts';

	let { data } = $props();
	let { trip, photo, index, prev, next } = $derived(data);

	const close = $derived(`/${trip.slug}`);
	const href = (id: string) => `/${trip.slug}/${id}`;
	const last = $derived(trip.photos.length - 1);

	/** Space between pages, on top of each photo's own padding. */
	const GAP = 24;
	/** Movement before a press becomes a drag, and its direction is locked in. */
	const SLOP = 8;
	/** Release speed (px/s) that counts as a flick. */
	const FLICK = 400;
	/** Fastest a flick can launch the pager, in pages/s. */
	const MAX_VELOCITY = 8;

	const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

	let viewer: HTMLElement;
	let stage: HTMLElement;
	let track: HTMLElement;
	let backdrop: HTMLElement;
	let aside: HTMLElement;

	$effect(() => {
		document.documentElement.classList.add('locked');
		return () => document.documentElement.classList.remove('locked');
	});

	/* Pager. All photos sit side by side on a track, and a spring moves the track in units of
	   pages. It writes the track's transform directly, so a frame costs one style write. */

	const trackX = (x: number) => `translateX(calc(${-x} * (100% + ${GAP}px)))`;
	const pitch = () => stage.clientWidth + GAP;

	const start = untrack(() => data.index);

	// The page the pager is heading to, and the last page the URL was asked to show.
	let target = $state(start);
	let requested = start;

	// The pages the track currently spans. Those, the target and a neighbour either side stay
	// rendered, so nothing blinks out mid-flight.
	let lo = $state(start);
	let hi = $state(start);
	const slides = $derived.by(() => {
		const from = Math.max(0, Math.min(lo, target) - 1);
		const to = Math.min(last, Math.max(hi, target) + 1);
		return trip.photos.slice(from, to + 1).map((p, k) => ({ p, i: from + k }));
	});

	// Nearly critically damped: a hint of give when it lands, more only after a hard flick.
	const pager = new SpringValue(start, 0.38, 0.88, (x) => {
		track.style.transform = trackX(x);
		lo = Math.floor(x);
		hi = Math.ceil(x);
	});
	$effect(() => () => pager.stop());

	/** Pages to `page`, optionally launching at `velocity` (pages/s), and updates the URL to match. */
	function go(page: number, velocity?: number) {
		target = page;
		if (reduced()) pager.set(page);
		else {
			if (velocity !== undefined) pager.velocity = velocity;
			pager.to(page);
		}
		if (page !== requested) {
			requested = page;
			goto(href(trip.photos[page].id), { reset: false, replace: true });
		}
	}

	// Links and history land here. Our own swipes and keys have already set off by the time the
	// URL catches up, so those (including stale ones from a few swipes ago) are ignored.
	$effect(() => {
		const i = index;
		untrack(() => {
			if (i === requested) return;
			requested = i;
			if (!drag && !wheel) go(i);
		});
	});

	// Decode the neighbours up front so they never pop in mid-swipe.
	$effect(() => {
		for (const p of [trip.photos[target - 1], trip.photos[target + 1]]) if (p) preload(srcset(trip, p), sizes.viewer);
	});

	/** Where the pager sits for a drag `x` pages along: no more than a page past where it started, and resisting past either end. */
	function band(x: number, from: number) {
		x = clamp(x, Math.floor(from) - 1, Math.ceil(from) + 1);
		if (x < 0) return -rubberBand(-x, 1);
		if (x > last) return last + rubberBand(x - last, 1);
		return x;
	}

	/**
	 * Lets go of a sideways drag moving at `vx` px/s: the nearest page, or the next one over on a
	 * flick. `heading` is where the pager was going when grabbed, so flicking again the same way
	 * while it's still settling goes one page further instead of landing on the same one.
	 */
	function release(vx: number, w: number, heading: number) {
		const x = pager.value;
		let page = Math.round(x);
		if (Math.abs(vx) > FLICK) {
			const d = vx < 0 ? 1 : -1;
			page = d > 0 ? Math.floor(x) + 1 : Math.ceil(x) - 1;
			if (d === heading) page = d > 0 ? Math.max(page, target + 1) : Math.min(page, target - 1);
		}
		go(clamp(page, 0, last), clamp(-vx / w, -MAX_VELOCITY, MAX_VELOCITY));
	}

	/** Stops the pager where it is and says which way it was going. */
	function grab() {
		const heading = pager.moving ? Math.sign(pager.target - pager.value) : 0;
		pager.stop();
		return heading;
	}

	/* Pointer drags: sideways pages, down dismisses. */

	type Drag = {
		id: number;
		x0: number;
		y0: number;
		axis?: 'x' | 'y';
		/** Pager position when grabbed, and where it was heading (0 if at rest). */
		start: number;
		heading: number;
		w: number;
		h: number;
		img?: HTMLElement;
		tracker: VelocityTracker;
	};
	let drag: Drag | null = null;

	function onpointerdown(e: PointerEvent) {
		if (drag || wheel || !e.isPrimary || e.button !== 0) return;
		const heading = grab();
		drag = {
			id: e.pointerId,
			x0: e.clientX,
			y0: e.clientY,
			start: pager.value,
			heading,
			w: pitch(),
			h: stage.clientHeight,
			tracker: new VelocityTracker()
		};
		stage.setPointerCapture(e.pointerId);
	}

	function onpointermove(e: PointerEvent) {
		if (e.pointerId !== drag?.id) return;
		let dx = e.clientX - drag.x0;
		let dy = e.clientY - drag.y0;

		if (!drag.axis) {
			if (Math.hypot(dx, dy) < SLOP) return;
			// Caught mid-flight: keep paging whichever way the finger goes.
			drag.axis = drag.heading || Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
			// Start from here rather than jumping by the slop.
			drag.x0 = e.clientX;
			drag.y0 = e.clientY;
			dx = dy = 0;
			if (drag.axis === 'y') {
				drag.img = track.querySelector<HTMLElement>('[data-current] img') ?? undefined;
				clearTimeout(unclipTimer);
				stage.classList.add('dismissing');
				for (const el of [drag.img, backdrop, aside]) if (el) el.style.transition = 'none';
			}
		}
		drag.tracker.add(e.timeStamp, dx, dy);

		if (drag.axis === 'x') pager.set(band(drag.start - dx / drag.w, drag.start));
		else {
			// Follows the finger, shrinking a little and letting the grid show through as it goes down.
			const down = Math.max(dy, 0);
			const y = dy < 0 ? -rubberBand(-dy, drag.h) : dy;
			const scale = 1 - Math.min(down / drag.h, 1) * 0.3;
			if (drag.img) drag.img.style.transform = `translate(${dx}px, ${y}px) scale(${scale})`;
			backdrop.style.opacity = `${1 - Math.min(down / (drag.h * 0.6), 1)}`;
			aside.style.opacity = `${1 - Math.min(down / (drag.h * 0.25), 1)}`;
		}
	}

	function onpointerup(e: PointerEvent) {
		if (e.pointerId !== drag?.id) return;
		const d = drag;
		drag = null;
		const v = e.type === 'pointercancel' ? { x: 0, y: 0 } : d.tracker.velocity(e.timeStamp);

		if (d.axis === 'y') {
			const dy = e.clientY - d.y0;
			if (e.type !== 'pointercancel' && (v.y > 500 || (dy > d.h * 0.15 && v.y > -100))) dismiss();
			else unDismiss(d.img);
		} else if (d.axis === 'x') release(v.x, d.w, d.heading);
		// A tap that caught the pager mid-flight lets it carry on.
		else if (d.heading) go(target);
	}

	/** Closes the viewer from wherever the drag left the photo. */
	function dismiss() {
		// The layout's view transition morphs the photo from here back into its grid cell.
		if ('startViewTransition' in document && !reduced()) {
			goto(close, { reset: false });
			return;
		}
		viewer.style.transition = 'opacity 180ms ease';
		viewer.style.opacity = '0';
		setTimeout(() => goto(close, { reset: false }), reduced() ? 0 : 180);
	}

	let unclipTimer: ReturnType<typeof setTimeout>;

	function unDismiss(img?: HTMLElement) {
		const spring = 'var(--spring-hero-duration) var(--spring-hero)';
		if (img) img.style.transition = `transform ${spring}`;
		backdrop.style.transition = aside.style.transition = `opacity ${spring}`;
		for (const el of [img, backdrop, aside]) if (el) el.style.transform = el.style.opacity = '';
		unclipTimer = setTimeout(() => {
			stage.classList.remove('dismissing');
			// Hand transitions back to the stylesheet (the backdrop eases its colour between photos).
			for (const el of [img, backdrop, aside]) if (el) el.style.transition = '';
		}, parseFloat(getComputedStyle(stage).getPropertyValue('--spring-hero-duration')));
	}

	/* Two-finger trackpad swipes. A swipe pages as soon as it has gone far enough, then the rest
	   of it (including its momentum) is ignored so one swipe is one page. A fresh swipe during
	   that momentum is let through, so quick repeated swipes keep paging. */

	let wheel: { start: number; heading: number; delta: number; w: number; timer: ReturnType<typeof setTimeout>; tracker: VelocityTracker } | null = null;
	/** Momentum being ignored: until when, its biggest delta, and its smallest since it started fading. */
	let momentum = { until: 0, peak: 0, low: Infinity };

	function onwheel(e: WheelEvent) {
		if (e.ctrlKey || drag || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
		e.preventDefault(); // also stops the browser's swipe-to-go-back
		const dx = e.deltaX * (e.deltaMode === 1 ? 16 : 1);
		const size = Math.abs(dx);

		if (e.timeStamp < momentum.until) {
			// Momentum only ever fades out; deltas that pick back up after fading are a new swipe.
			if (size < momentum.peak / 2) momentum.low = Math.min(momentum.low, size);
			momentum.peak = Math.max(momentum.peak, size);
			if (!(size > momentum.low * 2 + 8)) {
				momentum.until = e.timeStamp + 200;
				return;
			}
			momentum.until = 0;
		}

		if (!wheel) {
			const heading = grab();
			wheel = { start: pager.value, heading, delta: 0, w: pitch(), timer: setTimeout(() => {}), tracker: new VelocityTracker() };
		}
		const w = wheel;
		clearTimeout(w.timer);
		w.delta += dx;
		w.tracker.add(e.timeStamp, -w.delta, 0);
		pager.set(band(w.start + w.delta / w.w, w.start));

		const end = (vx: number) => {
			wheel = null;
			release(vx, w.w, w.heading);
		};
		const inBounds = pager.value >= 0 && pager.value <= last;
		if (inBounds && Math.abs(w.delta) > w.w * 0.25) {
			momentum = { until: e.timeStamp + 200, peak: size, low: Infinity };
			end(-Math.sign(w.delta) * Math.max(Math.abs(w.tracker.velocity(e.timeStamp).x), FLICK + 1));
		} else w.timer = setTimeout(() => end(0), 120);
	}

	$effect(() => {
		viewer.addEventListener('wheel', onwheel, { passive: false });
		return () => viewer.removeEventListener('wheel', onwheel);
	});

	function onkeydown(e: KeyboardEvent) {
		if (drag) return;
		if (e.key === 'Escape') goto(close, { reset: false });
		else if (e.key === 'ArrowLeft' && target > 0) go(target - 1);
		else if (e.key === 'ArrowRight' && target < last) go(target + 1);
	}

	// Which way the caption drifts in: with the photos when paging, up when opening.
	let dir = $state(0);
	let prevIndex = start;
	$effect.pre(() => {
		dir = Math.sign(index - prevIndex);
		prevIndex = index;
	});
</script>

<svelte:window {onkeydown} />

<svelte:head>
	<title>{photo.title} — {trip.name}</title>
</svelte:head>

<div class="viewer" role="dialog" aria-modal="true" aria-label={photo.title} bind:this={viewer}>
	<div class="backdrop" bind:this={backdrop} style:--tint={photo.color}></div>

	<!-- Drag sideways to page and down to close; the buttons and arrow keys cover the same actions. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="stage"
		bind:this={stage}
		{onpointerdown}
		{onpointermove}
		{onpointerup}
		onpointercancel={onpointerup}
	>
		<div class="track" bind:this={track} style:transform={trackX(start)}>
			{#each slides as { p, i } (p.id)}
				{@const current = i === target}
				<div
					class="slide"
					style:transform="translateX(calc({i} * (100% + {GAP}px)))"
					data-current={current || null}
					aria-hidden={!current || null}
				>
					<img
						src={src(trip, p, 1600)}
						srcset={srcset(trip, p)}
						sizes={sizes.viewer}
						width={p.width}
						height={p.height}
						alt={p.title}
						draggable="false"
						style:--ar={ratio(p)}
						style:background={p.color}
						style:view-transition-name={p.id === photo.id ? 'hero' : null}
					/>
				</div>
			{/each}
		</div>
	</div>

	<aside bind:this={aside}>
		<div class="captions">
			{#key photo.id}
				<div class="caption" style:--dx="{dir * 12}px" style:--dy="{dir ? 0 : 8}px" out:fade={{ duration: reduced() ? 0 : 120 }}>
					<h2>{photo.title}</h2>
					{#if photo.description}<p>{photo.description}</p>{/if}
				</div>
			{/key}
		</div>

		<nav>
			<span class="count">{index + 1} / {trip.photos.length}</span>
			<span class="arrows">
				{#if prev}
					<a href={href(prev.id)} data-sveltekit-reset="false" data-sveltekit-replacestate aria-label="Previous photo">←</a>
				{:else}
					<span aria-hidden="true">←</span>
				{/if}
				{#if next}
					<a href={href(next.id)} data-sveltekit-reset="false" data-sveltekit-replacestate aria-label="Next photo">→</a>
				{:else}
					<span aria-hidden="true">→</span>
				{/if}
			</span>
		</nav>
	</aside>
</div>

<style>
	.viewer {
		position: fixed;
		inset: 0 auto 0 0;
		width: 100vw; /* also cover the scrollbar gutter */
		z-index: 10;
		display: grid;
		grid-template-columns: 1fr 360px;
		overscroll-behavior: none;
	}

	/* Its own layer so swiping down can fade it to reveal the grid underneath. Changing photos
	   shifts its colour (it stays opaque throughout, a crossfade would let the grid show through). */
	.backdrop {
		position: absolute;
		inset: 0;
		z-index: -1;
		background: color-mix(in oklab, var(--tint) 14%, var(--bg));
		transition: background-color 300ms ease;
	}

	/* Above the aside, so a photo dragged down to close isn't hidden behind the caption. */
	.stage {
		position: relative;
		z-index: 1;
		overflow-x: clip;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
	}

	/* While dragging down to close, the photo may leave the stage; its neighbours stay put. */
	.stage:global(.dismissing) {
		overflow: visible;
	}

	.stage:global(.dismissing) .slide:not([data-current]) {
		visibility: hidden;
	}

	.track {
		position: absolute;
		inset: 0;
		will-change: transform;
	}

	.slide {
		position: absolute;
		inset: 0;
		container-type: size;
		display: grid;
		place-items: center;
		padding: 40px;
	}

	/* Size the image box to the photo itself (not a letterboxed frame), so the
	   morph animates between the real photo edges. */
	img {
		display: block;
		width: min(100cqw, 100cqh * var(--ar));
		height: auto;
		aspect-ratio: var(--ar);
		-webkit-user-drag: none;
	}

	aside {
		display: flex;
		flex-direction: column;
		padding: 40px 40px 40px 0;
	}

	/* The outgoing caption fades out in the same spot the new one drifts into. */
	.captions {
		display: grid;
		margin-top: auto;
	}

	.caption {
		grid-area: 1 / 1;
		align-self: end;
		animation: caption-in var(--spring-ui-duration) var(--spring-ui) both;
	}

	@keyframes caption-in {
		from {
			opacity: 0;
			transform: translate(var(--dx), var(--dy));
		}
	}

	h2 {
		font-size: 20px;
	}

	.caption p {
		margin-top: 10px;
		color: var(--muted);
		max-width: 36ch;
	}

	nav {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: 32px;
		font-size: 13px;
		color: var(--muted);
	}

	.arrows {
		display: flex;
		gap: 4px;
	}

	.arrows > * {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		font-size: 18px;
	}

	.arrows span {
		opacity: 0.3;
	}

	.arrows a {
		color: var(--fg);
	}

	@media (max-width: 899px) {
		.viewer {
			grid-template-columns: 1fr;
			grid-template-rows: 1fr auto;
		}

		.slide {
			padding: 56px 0 16px;
		}

		aside {
			padding: 0 var(--gutter) 24px;
		}

		nav {
			margin-top: 16px;
		}
	}
</style>
