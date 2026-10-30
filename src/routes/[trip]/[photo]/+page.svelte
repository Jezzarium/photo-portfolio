<script lang="ts">
	import { untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import { waapi, type WAAPIAnimation } from 'animejs';
	import { goto, onNavigate } from '$app/navigation';
	import { SpringValue, VelocityTracker, rubberBand } from '#lib/gestures.ts';
	import Photo from '#lib/Photo.svelte';
	import { center, hero, landing, onto, opened, placement, thumb, transform, type Placement } from '#lib/hero.svelte.ts';
	import { up } from '#lib/history.ts';
	import { preload, ratio, sizes, srcset } from '#lib/images.ts';
	import { launch } from '#lib/springs.ts';

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
	/** Furthest a photo zooms in, and how far a double-tap takes it. */
	const MAX_ZOOM = 4;
	const TAP_ZOOM = 2.5;

	const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

	let viewer: HTMLElement;
	let stage: HTMLElement;
	let track: HTMLElement;
	let backdrop: HTMLElement;
	let aside: HTMLElement;

	const root = typeof document === 'object' ? document.documentElement : undefined;

	// Where the page is scrolled to, which the viewer covers. The page is locked while it's open,
	// so this only moves when closing brings a thumbnail into view.
	const top = typeof scrollY === 'number' ? scrollY : 0;
	const pin = () => (viewer.style.top = `${scrollY}px`);

	$effect(() => {
		root!.classList.add('locked');
		return () => {
			root!.classList.remove('locked');
			root!.style.removeProperty('--tint');
			root!.style.removeProperty('--veil');
			root!.style.transition = '';
			hero.hidden = undefined;
		};
	});

	// The root paints the scrollbar gutter, so it follows the backdrop's colour.
	$effect(() => root!.style.setProperty('--tint', photo.color));

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
		clip();
		if (zoomed) unzoom();
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

	/* Opening and closing. The photo flies between its grid thumbnail and the viewer on a spring
	   that animates only its transform, so it runs on the compositor. Closing starts from wherever
	   the photo is right now, so it can cut into an opening or carry on from a drag down. */

	const current = () => track.querySelector<HTMLElement>('[data-current] .shot') ?? undefined;

	// Opened from the grid, rather than landed on: fly in from the thumbnail.
	const from = untrack(() => (opened.id === data.photo.id ? { ...opened } : undefined));
	opened.id = opened.preview = undefined;

	/** Bumped by every flight, so one that was cut off doesn't clean up after the next. */
	let flight = 0;
	/** The opening flight while it's in the air, and its flight number. */
	let opening: { fly: WAAPIAnimation; flight: number } | undefined;
	/** Release velocity (px/s) of the drag or swipe that closed the viewer, if any. */
	let flick = { x: 0, y: 0 };
	/** Set as soon as a drag or swipe lets go to close, before the navigation gets going. */
	let leaving = false;
	let closing: Promise<void> | undefined;

	/** The photo may leave the stage (for the grid or a finger), and its thumbnail hides until it lands. */
	function takeOff(id: string) {
		clearTimeout(unclipTimer);
		hero.hidden = id;
		stage.classList.add('flying');
		return ++flight;
	}

	function land() {
		hero.hidden = undefined;
		stage.classList.remove('flying');
	}

	/** Paging while the photo is still flying in: it carries on into place, but the stage clips
	    again so the pages sliding in stay on it. */
	function clip() {
		if (opening?.flight === flight) stage.classList.remove('flying');
	}

	$effect(() =>
		untrack(() => {
			const box = from && !reduced() ? thumb(from.id!)?.getBoundingClientRect() : undefined;
			const shot = current();
			if (!box || !shot) return;
			const id = takeOff(photo.id);
			const fly = waapi.animate(shot, { transform: [transform(onto(shot, box)), 'none'], ease: launch('hero') });
			opening = { fly, flight: id };
			fly.then(() => {
				// Hand the transform back to the stylesheet (and the drag code).
				fly.revert();
				if (opening?.fly === fly) opening = undefined;
				if (id === flight) land();
			});
		})
	);

	// Closing (the back button, Escape, a drag down, or history) holds the navigation until the
	// photo has landed on its thumbnail.
	onNavigate(({ to }) => {
		if (to?.params?.photo || to?.params?.trip !== trip.slug || reduced()) return;
		return (closing ??= flyOut());
	});

	function flyOut() {
		const p = trip.photos[target];
		const shot = current();
		const el = thumb(p.id);
		if (!shot || !el) return;

		let box = el.getBoundingClientRect();
		// Paged past what the grid shows: bring the thumbnail into view to land on.
		if (box.bottom < 0 || box.top > innerHeight) {
			el.scrollIntoView({ block: 'center', behavior: 'instant' });
			pin();
			box = el.getBoundingClientRect();
		}

		const start = hold(shot);
		const end = onto(shot, box);
		const ease = toward(start, end, flick);

		takeOff(p.id);
		root!.style.transition = '';
		root!.style.setProperty('--veil', '0');
		waapi.animate(shot, { transform: [transform(start), transform(end)], ease });
		waapi.animate(backdrop, { opacity: [getComputedStyle(backdrop).opacity, 0], duration: 250, ease: 'out(2)' });
		waapi.animate(aside, { opacity: [getComputedStyle(aside).opacity, 0], duration: 120, ease: 'out(2)' });

		return new Promise<void>((resolve) =>
			setTimeout(() => {
				hero.hidden = undefined;
				resolve();
			}, landing(ease, shot, start, end))
		);
	}

	/** The hero spring from `a` to `b`, launched at `v` px/s: its speed along the way, as a share of the distance per second. */
	function toward(a: Placement, b: Placement, v: Point) {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const d2 = dx * dx + dy * dy;
		return launch('hero', d2 > 1 ? clamp((v.x * dx + v.y * dy) / d2, -2, 6) : 0);
	}

	/** Stops whatever is moving photo `img` (flying in, or settling a zoom) where it is, and says where that is. */
	function hold(img: HTMLElement): Placement {
		const at = placement(img);
		if (settling?.targets[0] === img) settling.cancel();
		if (opening?.fly.targets[0] === img) {
			opening.fly.cancel();
			opening = undefined;
			land();
		}
		return at;
	}

	/* Pulling the photo away to close it, by dragging it down or swiping two fingers up or down. */

	type Pull = { img?: HTMLElement; h: number; base: Placement };

	/** Starts pulling the current photo from wherever it is, catching it if it's still flying in. */
	function startPull(): Pull {
		const img = current();
		const base = img ? hold(img) : REST;
		takeOff(trip.photos[target].id);
		for (const el of [img, backdrop, aside, root]) if (el) el.style.transition = 'none';
		return { img, h: stage.clientHeight, base };
	}

	/** Moves the photo `dx`, `dy` from where it was caught, shrinking it a little and letting the
	    grid show through as it gets `away` px off. */
	function pull({ img, h, base }: Pull, dx: number, dy: number, away: number) {
		const scale = 1 - Math.min(away / h, 1) * 0.3;
		if (img) img.style.transform = transform({ x: base.x + dx, y: base.y + dy, sx: base.sx * scale, sy: base.sy * scale });
		root!.style.setProperty('--veil', `${1 - Math.min(away / (h * 0.6), 1)}`);
		aside.style.opacity = `${1 - Math.min(away / (h * 0.25), 1)}`;
	}

	/* Zoom. Pinching takes a closer look, over everything, until the fingers let go. Double-tap
	   (or double-click), or a trackpad pinch, zooms in and stays: dragging and two-finger swipes
	   then pan the photo instead of paging or closing it, and paging zooms back out. */

	type Point = { x: number; y: number };
	const REST: Placement = { x: 0, y: 0, sx: 1, sy: 1 };

	/** The zoomed-in photo, if any. Its slide loads the largest image there is. */
	let zoomed = $state<string>();
	/** A zoomed photo springing back within bounds. */
	let settling: WAAPIAnimation | undefined;

	/** The box a zoomed photo shows within: its slide, inside the padding. */
	function frame(img: HTMLElement) {
		const slide = img.offsetParent as HTMLElement;
		const r = slide.getBoundingClientRect();
		const pad = getComputedStyle(slide);
		const [t, rt, b, l] = [pad.paddingTop, pad.paddingRight, pad.paddingBottom, pad.paddingLeft].map(parseFloat);
		return { left: r.left + l, top: r.top + t, width: r.width - l - rt, height: r.height - t - b };
	}

	/**
	 * How far photo `img` zoomed to `s` can move: up to its edges where it's bigger than its
	 * frame, and not at all where it's smaller (drifting from where it rests to the middle of the
	 * frame as it grows).
	 */
	function bounds(img: HTMLElement, s: number) {
		const box = frame(img);
		const c = center(img);
		const axis = (middle: number, size: number, room: number): [number, number] => {
			const over = (s * size - room) / 2;
			if (over > 0) return [middle - over, middle + over];
			const p = room > size ? middle * clamp(((s - 1) * size) / (room - size), 0, 1) : middle;
			return [p, p];
		};
		return {
			x: axis(box.left + box.width / 2 - c.x, img.offsetWidth, box.width),
			y: axis(box.top + box.height / 2 - c.y, img.offsetHeight, box.height)
		};
	}

	/** `z` moved within bounds, or rubber-banding past them when given room to `give` (px). */
	function within(img: HTMLElement, z: Placement, give = 0): Placement {
		const b = bounds(img, z.sx);
		const fit = (v: number, [lo, hi]: [number, number]) => {
			if (v < lo) return lo - (give ? rubberBand(lo - v, give) : 0);
			if (v > hi) return hi + (give ? rubberBand(v - hi, give) : 0);
			return v;
		};
		return { ...z, x: fit(z.x, b.x), y: fit(z.y, b.y) };
	}

	/** `img` zoomed from `z` to `s` around the point at `m`, which ends up at `to`. */
	function around(img: HTMLElement, z: Placement, s: number, m: Point, to = m): Placement {
		const c = center(img);
		const k = s / z.sx;
		return { x: to.x - c.x - k * (m.x - c.x - z.x), y: to.y - c.y - k * (m.y - c.y - z.y), sx: s, sy: s };
	}

	/** Springs the current photo `img` to `z`, launched at `v` px/s. */
	function settle(img: HTMLElement, z: Placement, v: Point = { x: 0, y: 0 }) {
		const at = placement(img);
		zoomed = z.sx > 1 ? trip.photos[target].id : undefined;
		const anim = (settling = waapi.animate(img, { transform: [transform(at), transform(z)], ease: toward(at, z, v) }));
		anim.then(() => {
			if (settling === anim) settling = undefined;
			// Back at rest: hand the transform back to the stylesheet.
			if (z === REST) img.style.removeProperty('transform');
		});
	}

	/** Lets go of a zoomed photo at `z`, moving at `v` px/s: back within limits, after coasting a little. */
	function letGo(img: HTMLElement, z: Placement, v: Point) {
		const s = clamp(z.sx, 1, MAX_ZOOM);
		if (s < 1.05) return settle(img, REST, v);
		const k = s / z.sx;
		settle(img, within(img, { x: z.x * k + v.x * 0.3, y: z.y * k + v.y * 0.3, sx: s, sy: s }), v);
	}

	function unzoom() {
		const img = current();
		if (!img) return;
		hold(img);
		settle(img, REST);
	}

	let lastTap = { t: 0, x: 0, y: 0 };

	/** A second tap in the same spot zooms in around it, or back out. */
	function tap(e: PointerEvent) {
		const double = e.timeStamp - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30;
		lastTap = double ? { t: 0, x: 0, y: 0 } : { t: e.timeStamp, x: e.clientX, y: e.clientY };
		const img = current();
		if (!double || !img) return;
		const z = hold(img);
		settle(img, z.sx > 1.01 ? REST : within(img, around(img, z, TAP_ZOOM, { x: e.clientX, y: e.clientY })));
	}

	/** Fingers on the stage. A second one starts a pinch. */
	const fingers = new Map<number, Point>();
	let pinch: { img: HTMLElement; ids: number[]; d0: number; m0: Point; base: Placement; at: Placement; tracker: VelocityTracker } | null = null;

	const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

	function startPinch() {
		// Whatever the first finger was doing gives way to the pinch; paging settles on its page.
		if (drag?.axis === 'x' || drag?.heading) go(target);
		drag = null;
		const img = current();
		if (!img) return;
		const ids = [...fingers.keys()];
		const [a, b] = ids.map((id) => fingers.get(id)!);
		const base = hold(img);
		pinch = { img, ids, d0: Math.hypot(b.x - a.x, b.y - a.y) || 1, m0: mid(a, b), base, at: base, tracker: new VelocityTracker() };
	}

	function movePinch(e: PointerEvent) {
		const p = pinch!;
		const [a, b] = p.ids.map((id) => fingers.get(id)!);
		const m = mid(a, b);
		let s = (p.base.sx * Math.hypot(b.x - a.x, b.y - a.y)) / p.d0;
		// Resists zooming out past fitting the stage, or in past the most.
		if (s < 1) s = 1 - rubberBand(1 - s, 0.5);
		else if (s > MAX_ZOOM) s = MAX_ZOOM + rubberBand(s - MAX_ZOOM, MAX_ZOOM);
		p.at = around(p.img, p.base, s, p.m0, m);
		p.tracker.add(e.timeStamp, m.x, m.y);
		p.img.style.transform = transform(p.at);
	}

	/* Pointer drags: sideways pages, down dismisses (or pans, zoomed in). */

	type Drag = {
		id: number;
		x0: number;
		y0: number;
		axis?: 'x' | 'y' | 'pan';
		/** Pager position when grabbed, and where it was heading (0 if at rest). */
		start: number;
		heading: number;
		w: number;
		h: number;
		pull?: Pull;
		pan?: { img: HTMLElement; base: Placement; at: Placement };
		tracker: VelocityTracker;
	};
	let drag: Drag | null = null;

	function onpointerdown(e: PointerEvent) {
		if (e.button !== 0 || leaving || closing) return;
		fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		stage.setPointerCapture(e.pointerId);
		if (fingers.size === 2 && !pinch && drag?.axis !== 'y' && !wheel && !toss) startPinch();
		if (drag || pinch || wheel || toss || !e.isPrimary) return;
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
	}

	function onpointermove(e: PointerEvent) {
		if (fingers.has(e.pointerId)) fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (pinch) return movePinch(e);
		if (e.pointerId !== drag?.id) return;
		let dx = e.clientX - drag.x0;
		let dy = e.clientY - drag.y0;

		if (!drag.axis) {
			if (Math.hypot(dx, dy) < SLOP) return;
			// Caught mid-flight: keep paging whichever way the finger goes.
			drag.axis = zoomed ? 'pan' : drag.heading || Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
			// Start from here rather than jumping by the slop.
			drag.x0 = e.clientX;
			drag.y0 = e.clientY;
			dx = dy = 0;
			if (drag.axis === 'y') drag.pull = startPull();
			else if (drag.axis === 'pan') {
				const img = current()!;
				const base = hold(img);
				drag.pan = { img, base, at: base };
			} else clip();
		}
		drag.tracker.add(e.timeStamp, dx, dy);

		if (drag.axis === 'x') pager.set(band(drag.start - dx / drag.w, drag.start));
		else if (drag.axis === 'pan') {
			const p = drag.pan!;
			p.at = within(p.img, { ...p.base, x: p.base.x + dx, y: p.base.y + dy }, drag.w);
			p.img.style.transform = transform(p.at);
		}
		// Follows the finger, resisting upwards.
		else pull(drag.pull!, dx, dy < 0 ? -rubberBand(-dy, drag.h) : dy, Math.max(dy, 0));
	}

	function onpointerup(e: PointerEvent) {
		fingers.delete(e.pointerId);
		// A pinch is a closer look: letting go springs the photo back into place.
		if (pinch?.ids.includes(e.pointerId)) {
			const p = pinch;
			pinch = null;
			settle(p.img, REST, e.type === 'pointercancel' ? { x: 0, y: 0 } : p.tracker.velocity(e.timeStamp));
			return;
		}
		if (e.pointerId !== drag?.id) return;
		const d = drag;
		drag = null;
		const v = e.type === 'pointercancel' ? { x: 0, y: 0 } : d.tracker.velocity(e.timeStamp);

		if (d.axis === 'y') {
			const dy = e.clientY - d.y0;
			if (e.type !== 'pointercancel' && (v.y > 500 || (dy > d.h * 0.15 && v.y > -100))) dismiss(v);
			else unDismiss(d.pull?.img);
		} else if (d.axis === 'x') release(v.x, d.w, d.heading);
		else if (d.axis === 'pan') letGo(d.pan!.img, d.pan!.at, v);
		// A tap that caught the pager mid-flight lets it carry on.
		else if (d.heading) go(target);
		else if (e.type !== 'pointercancel') tap(e);
	}

	/** Closes the viewer from wherever the photo was pulled to, carrying on at the release velocity `v`. */
	function dismiss(v: { x: number; y: number }) {
		flick = v;
		leaving = true;
		up(close);
	}

	let unclipTimer: ReturnType<typeof setTimeout>;

	function unDismiss(img?: HTMLElement) {
		const spring = 'var(--spring-hero-duration) var(--spring-hero)';
		if (img) img.style.transition = `transform ${spring}`;
		backdrop.style.transition = aside.style.transition = `opacity ${spring}`;
		root!.style.transition = `background-color ${spring}`;
		root!.style.removeProperty('--veil');
		for (const el of [img, aside]) if (el) el.style.transform = el.style.opacity = '';
		unclipTimer = setTimeout(() => {
			land();
			// Hand transitions back to the stylesheet (the backdrop eases its colour between photos).
			for (const el of [img, backdrop, aside, root]) if (el) el.style.transition = '';
		}, parseFloat(getComputedStyle(stage).getPropertyValue('--spring-hero-duration')));
	}

	/* Two-finger trackpad swipes. A swipe pages as soon as it has gone far enough, then the rest
	   of it (including its momentum) is ignored so one swipe is one page. A fresh swipe during
	   that momentum is let through, so quick repeated swipes keep paging. */

	let wheel: { start: number; heading: number; delta: number; w: number; timer: ReturnType<typeof setTimeout>; tracker: VelocityTracker } | null = null;
	/** Momentum being ignored: until when, its biggest delta, and its smallest since it started fading. */
	let momentum = { until: 0, peak: 0, low: Infinity };

	function onwheel(e: WheelEvent) {
		if (drag || pinch) return;
		e.preventDefault(); // also stops the browser's swipe-to-go-back, and zooming the page
		if (leaving || closing) return;
		const px = e.deltaMode === 1 ? 16 : 1;
		const dx = e.deltaX * px;
		const dy = e.deltaY * px;
		// Trackpad pinches arrive as wheel events with ctrl held.
		if (e.ctrlKey) {
			if (!wheel && !toss) zoomWheel(e, dy);
		} else if (zoomed) panWheel(dx, dy);
		else if (toss) tossWheel(e, dx, dy);
		else if (Math.abs(dx) > Math.abs(dy)) pageWheel(e, dx);
		// Not while a sideways swipe or its momentum is still going.
		else if (!wheel && e.timeStamp >= momentum.until) tossWheel(e, dx, dy);
	}

	function pageWheel(e: WheelEvent, dx: number) {
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
			clip();
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

	/** Trackpad pinches zoom around the pointer. */
	function zoomWheel(e: WheelEvent, dy: number) {
		const img = current();
		if (!img) return;
		const z = hold(img);
		const s = clamp(z.sx * Math.exp(-dy / 100), 1, MAX_ZOOM);
		img.style.transform = transform(within(img, around(img, z, s, { x: e.clientX, y: e.clientY })));
		zoomed = s > 1 ? trip.photos[target].id : undefined;
	}

	function panWheel(dx: number, dy: number) {
		const img = current();
		if (!img) return;
		const z = hold(img);
		img.style.transform = transform(within(img, { ...z, x: z.x - dx, y: z.y - dy }));
	}

	/* Two-finger swipes up or down pull the photo like a drag. Once the swipe (momentum included)
	   stops, it closes if it went far enough, or springs back. A hard flick closes as soon as it
	   has gone a good way, rather than letting the momentum carry it off. */

	let toss: { pull: Pull; x: number; y: number; v: { x: number; y: number }; timer: ReturnType<typeof setTimeout>; tracker: VelocityTracker } | null = null;

	function tossWheel(e: WheelEvent, dx: number, dy: number) {
		toss ??= { pull: startPull(), x: 0, y: 0, v: { x: 0, y: 0 }, timer: setTimeout(() => {}), tracker: new VelocityTracker() };
		const t = toss;
		clearTimeout(t.timer);
		// Scrolling moves the page against the deltas, so this goes the way the fingers do.
		t.x -= dx;
		t.y -= dy;
		t.tracker.add(e.timeStamp, t.x, t.y);
		t.v = t.tracker.velocity(e.timeStamp);
		pull(t.pull, t.x, t.y, Math.abs(t.y));

		const end = (close: boolean) => {
			toss = null;
			if (close) dismiss(t.v);
			else unDismiss(t.pull.img);
		};
		if (Math.abs(t.y) > t.pull.h * 0.4) end(true);
		else t.timer = setTimeout(() => end(Math.abs(t.y) > t.pull.h * 0.15 && t.v.y * Math.sign(t.y) > -100), 120);
	}

	$effect(() => {
		viewer.addEventListener('wheel', onwheel, { passive: false });
		return () => viewer.removeEventListener('wheel', onwheel);
	});

	function onkeydown(e: KeyboardEvent) {
		if (drag || toss || pinch) return;
		if (e.key === 'Escape') up(close);
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

<svelte:window {onkeydown} onscroll={pin} />

<svelte:head>
	<title>{photo.title} — {trip.name}</title>
</svelte:head>

<div class="viewer" class:opening={from} style:top="{top}px" role="dialog" aria-modal="true" aria-label={photo.title} bind:this={viewer}>
	<div class="backdrop" bind:this={backdrop} style:--tint={photo.color}></div>

	<!-- Drag sideways to page and down to close, pinch or double-tap to zoom; the buttons and arrow
	     keys cover paging and closing. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="stage"
		class:zoomed
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
					<Photo
						class="shot"
						{trip}
						photo={p}
						sizes={p.id === zoomed ? '400vw' : sizes.viewer}
						eager
						preview={p.id === from?.id ? from.preview : undefined}
						style="--ar: {ratio(p)}"
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
	/* Covers the screen where the page is scrolled to (it's locked while open), absolutely
	   positioned rather than fixed: Safari fills its see-through toolbars with a solid colour
	   while a fixed element covers the screen edges, and only swaps that colour once things have
	   settled, so they'd snap after every open and close. */
	.viewer {
		position: absolute;
		top: 0;
		left: 0;
		width: 100vw; /* also cover the scrollbar gutter */
		height: 100dvh;
		z-index: 10;
		display: grid;
		grid-template-columns: 1fr 360px;
		overscroll-behavior: none;
		touch-action: none; /* nothing scrolls the page out from under it */
	}

	/* Its own layer so swiping down can fade it to reveal the grid underneath. Changing photos
	   shifts its colour (a crossfade would let the grid show through). It reaches under Safari's
	   see-through toolbars, so they show it too. */
	.backdrop {
		position: absolute;
		inset: -50vh 0;
		z-index: -1;
		background: color-mix(in oklab, var(--tint) 14%, var(--bg));
		/* --veil fades it while swiping down to close (set on the root, which shares it). */
		opacity: var(--veil, 1);
		transition: background-color 300ms ease;
	}

	/* Opened from the grid: the backdrop and caption fade in around the photo flying in. In CSS
	   rather than a script animation, so they can't override a drag that starts meanwhile. */
	.opening .backdrop {
		animation: fade-in 250ms cubic-bezier(0.33, 1, 0.68, 1) backwards;
	}

	.opening aside {
		animation: fade-in 250ms 100ms cubic-bezier(0.33, 1, 0.68, 1) backwards;
	}

	@keyframes fade-in {
		from {
			opacity: 0;
		}
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

	/* Zoomed in, the photo stays inside its slide's padding, clear of the caption and the edges
	   (until it flies off to close). */
	.stage.zoomed {
		cursor: grab;
	}

	.stage.zoomed:not(:global(.flying)) .slide[data-current] {
		clip-path: inset(var(--pad));
	}

	/* While opening, closing or dragging down to close, the photo may leave the stage; its
	   neighbours stay put. */
	.stage:global(.flying) {
		overflow: visible;
	}

	.stage:global(.flying) .slide:not([data-current]) {
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
		--pad: 40px;
		padding: var(--pad);
	}

	/* Size the image box to the photo itself (not a letterboxed frame), so it
	   flies between the real photo edges. */
	.slide :global(.shot) {
		width: min(100cqw, 100cqh * var(--ar));
		aspect-ratio: var(--ar);
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

		/* Clear of the back button. */
		.slide {
			--pad: 76px 0 16px;
		}

		aside {
			padding: 0 var(--gutter) 24px;
		}

		nav {
			margin-top: 16px;
		}
	}
</style>
