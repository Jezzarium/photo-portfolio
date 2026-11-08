<script lang="ts">
	import { untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import { waapi, type WAAPIAnimation } from 'animejs';
	import { goto, onNavigate } from '$app/navigation';
	import { VelocityTracker, rubberBand } from '#lib/gestures.ts';
	import Photo from '#lib/Photo.svelte';
	import { center, hero, landing, onto, opened, placement, thumb, transform, type Placement } from '#lib/hero.svelte.ts';
	import { up } from '#lib/history.ts';
	import { preload, ratio, sizes, srcset } from '#lib/images.ts';
	import { launch } from '#lib/launch.ts';

	let { data } = $props();
	let { trip, photo, index } = $derived(data);

	const close = $derived(`/${trip.slug}`);
	const href = (id: string) => `/${trip.slug}/${id}`;
	const last = $derived(trip.photos.length - 1);

	/** Space between pages, on top of each photo's own padding. Matches the track's gap. */
	const GAP = 24;
	/** Movement before a press becomes a drag, and its direction is locked in. */
	const SLOP = 8;
	/** Release speed (px/s) that counts as a flick. */
	const FLICK = 400;
	/** How long the pager has to sit still to count as settled, where `scrollend` isn't supported. */
	const SETTLE = 150;
	/** Furthest a photo zooms in, and how far a double-tap takes it. */
	const MAX_ZOOM = 4;
	const TAP_ZOOM = 2.5;

	const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

	let viewer: HTMLElement;
	let scroller: HTMLElement;
	let track: HTMLElement;
	let backdrop: HTMLElement;
	let aside: HTMLElement;
	let air: HTMLElement;

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
			clearTimeout(settleTimer);
			clearTimeout(returnTimer);
		};
	});

	// The root paints the scrollbar gutter, so it follows the backdrop's colour.
	$effect(() => root!.style.setProperty('--tint', photo.color));

	/* Pager. The photos sit side by side in a horizontal scroller that snaps to each one, so a swipe
	   is the browser's own scrolling: it runs off the main thread at the screen's full refresh rate
	   (120Hz on ProMotion, even where Safari holds page rendering to 60fps), carries on smoothly
	   whatever the page is busy with, and has the platform's feel. A mouse drags it by script (see
	   the pointer handlers), and keys and links scroll it. */

	const pitch = () => scroller.clientWidth + GAP;
	const start = untrack(() => data.index);

	/** The page nearest the middle of the stage. Its caption shows, and the URL follows once the pager settles. */
	let current = $state(start);
	/** The page the arrows and keys move on from: where a scroll is heading, or `current` at rest. */
	let heading = start;
	/** The page the URL was last asked to show. */
	let requested = start;
	// The pages the scroller is between. Those and a neighbour either side are rendered.
	let lo = $state(start);
	let hi = $state(start);
	const near = (i: number) => i >= lo - 1 && i <= hi + 1;

	const shown = $derived(trip.photos[current]);

	/** Set while the pager moves, until it settles. */
	let scrolling = false;
	let settleTimer: ReturnType<typeof setTimeout> | undefined;

	function onscroll() {
		const x = scroller.scrollLeft / pitch();
		lo = clamp(Math.floor(x + 0.01), 0, last);
		hi = clamp(Math.ceil(x - 0.01), 0, last);
		current = clamp(Math.round(x), 0, last);
		scrolling = true;
		// A swipe straight after opening cuts the flight short.
		if (opening && Math.abs(x - opening.page) > 0.02) landNow();
		clearTimeout(settleTimer);
		settleTimer = setTimeout(settled, SETTLE);
	}

	function settled() {
		clearTimeout(settleTimer);
		// Still being dragged by the mouse.
		if (drag?.axis === 'x') return;
		scrolling = false;
		heading = current;
		scroller.classList.remove('free');
		commit();
	}

	/**
	 * Brings the URL (and with it the page data) into line with the photo shown, once the pager is
	 * at rest, so none of that work lands mid-swipe. Also lines the grid up under the viewer, ready
	 * for this photo to land on when it closes.
	 */
	function commit() {
		if (leaving || closing || lifted || current === requested) return;
		requested = current;
		reveal(trip.photos[current].id);
		goto(href(trip.photos[current].id), { reset: false, replace: true });
	}

	/** Scrolls to `page`: for the arrows, keys, links and history. */
	function go(page: number) {
		if (zoomed) unzoom();
		heading = page;
		scroller.scrollTo({ left: page * pitch(), behavior: reduced() ? 'instant' : 'smooth' });
		// In case it's already there, and no scroll follows.
		clearTimeout(settleTimer);
		settleTimer = setTimeout(settled, SETTLE);
	}

	/** Moves `by` pages on from where the pager is heading. */
	function step(by: number) {
		const page = clamp(heading + by, 0, last);
		if (page !== heading) go(page);
	}

	// Links and history land here. Our own swipes have already got there by the time the URL
	// catches up (commit() sets `requested` first), so those are ignored.
	$effect(() => {
		const i = index;
		untrack(() => {
			if (i === requested) return;
			requested = i;
			if (!drag && !toss) go(i);
		});
	});

	// Decode the neighbours up front so they never pop in mid-swipe.
	$effect(() => {
		for (const p of [trip.photos[current - 1], trip.photos[current + 1]]) if (p) preload(srcset(trip, p), sizes.viewer(p));
	});

	/** Lets go of a mouse drag moving at `vx` px/s: the nearest page, or the next one over on a flick. */
	function release(vx: number, w: number) {
		const x = scroller.scrollLeft / w;
		let page = Math.round(x);
		if (Math.abs(vx) > FLICK) page = vx < 0 ? Math.floor(x) + 1 : Math.ceil(x) - 1;
		go(clamp(page, 0, last));
	}

	/* The photo in hand. To leave the pager (flying to or from the grid, pulled away to close, or
	   pinched for a closer look), the current photo is swapped for a copy in a layer over the whole
	   viewer, since the scroller clips what's inside it. The copy shows the same, already loaded,
	   image, and the original waits in its slide, hidden, until it's put back. Meanwhile the pager
	   holds still. */

	let lifted: { el: HTMLElement; shot: HTMLElement } | undefined;

	const currentShot = () => scroller.querySelector<HTMLElement>('[data-current] .shot') ?? undefined;

	/**
	 * The photo in hand, lifting the current one out of the pager if it isn't already. The pager
	 * holds still while it's out, unless it's left `free`: while flying in (a swipe lands it), and
	 * while a finger is on it (iOS can drop a touch whose scroller changes under it; the pager
	 * doesn't take up-and-down swipes or pinches anyway). It holds still once the finger lifts.
	 */
	function lift(free = false): HTMLElement | undefined {
		if (!free) scroller.classList.add('held');
		if (lifted) return lifted.el;
		const shot = currentShot();
		if (!shot) return;
		const at = hold(shot);
		const c = center(shot);
		const layer = air.getBoundingClientRect();
		const el = shot.cloneNode(true) as HTMLElement;
		el.classList.add('lifted');
		el.setAttribute('aria-hidden', 'true');
		Object.assign(el.style, {
			left: `${c.x - layer.left - shot.offsetWidth / 2}px`,
			top: `${c.y - layer.top - shot.offsetHeight / 2}px`,
			width: `${shot.offsetWidth}px`,
			height: `${shot.offsetHeight}px`,
			transform: transform(at)
		});
		air.append(el);
		shot.style.removeProperty('transform');
		shot.style.visibility = 'hidden';
		lifted = { el, shot };
		return el;
	}

	/** Puts the photo in hand back in its slide, and catches the URL up if the pager moved meanwhile. */
	function drop() {
		scroller.classList.remove('held');
		if (!lifted) return;
		lifted.shot.style.removeProperty('visibility');
		lifted.el.remove();
		lifted = undefined;
		if (!scrolling) commit();
	}

	/* Opening and closing. The photo flies between its grid thumbnail and the viewer on a spring
	   that animates only its transform, so it runs on the compositor. Closing starts from wherever
	   the photo is right now, so it can cut into an opening or carry on from a drag down. */

	// Opened from the grid, rather than landed on: fly in from the thumbnail.
	const from = untrack(() => (opened.id === data.photo.id ? { ...opened } : undefined));
	opened.id = opened.preview = undefined;

	/** Bumped by every flight, so one that was cut off doesn't clean up after the next. */
	let flights = 0;
	/** The opening flight while it's in the air, its flight number, and the page it's for. */
	let opening: { fly: WAAPIAnimation; flight: number; page: number } | undefined;
	/** Release velocity (px/s) of the drag or swipe that closed the viewer, if any. */
	let flick = { x: 0, y: 0 };
	/** Set as soon as a drag or swipe lets go to close, before the navigation gets going. */
	let leaving = false;
	let closing: Promise<void> | undefined;

	/** The photo is leaving its place (for the grid or a finger), and its thumbnail hides until it lands. */
	function takeOff(id: string) {
		clearTimeout(returnTimer);
		hero.hidden = id;
		return ++flights;
	}

	function land() {
		hero.hidden = undefined;
	}

	/** Lands the opening flight on the spot, for a swipe that comes before it has. */
	function landNow() {
		if (!opening) return;
		opening.fly.cancel();
		opening = undefined;
		land();
		drop();
	}

	$effect(() =>
		untrack(() => {
			// Rendered with the track shifted to the right photo, so that shows before the script
			// runs. From here, the scroll position does it.
			track.style.removeProperty('transform');
			scroller.scrollLeft = start * pitch();

			// Landed straight on the photo: line the grid up under it for when it closes.
			if (!from) reveal(photo.id);
			const box = from && !reduced() ? thumb(from.id!)?.getBoundingClientRect() : undefined;
			// Still free to swipe: that lands it on the spot.
			const shot = box && lift(true);
			if (!box || !shot) return;
			const id = takeOff(photo.id);
			const fly = waapi.animate(shot, { transform: [transform(onto(shot, box)), 'none'], ease: launch('hero') });
			opening = { fly, flight: id, page: start };
			fly.then(() => {
				if (opening?.fly !== fly) return;
				opening = undefined;
				if (id === flights) {
					land();
					drop();
				}
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
		const p = trip.photos[current];
		const el = thumb(p.id);
		if (!el) return;

		// Only scroll when the thumbnail is off screen: scrolling under a photo that's being dragged
		// or let go of makes iOS Safari's viewer jump.
		let box = el.getBoundingClientRect();
		if (box.bottom < 0 || box.top > innerHeight) {
			reveal(p.id);
			box = el.getBoundingClientRect();
		}
		const shot = lift();
		if (!shot) return;
		const a = hold(shot);
		const b = onto(shot, box);
		const ease = toward(a, b, flick);

		takeOff(p.id);
		root!.style.transition = '';
		root!.style.setProperty('--veil', '0');
		waapi.animate(shot, { transform: [transform(a), transform(b)], ease });
		waapi.animate(backdrop, { opacity: [getComputedStyle(backdrop).opacity, 0], duration: 250, ease: 'out(2)' });
		waapi.animate(aside, { opacity: [getComputedStyle(aside).opacity, 0], duration: 120, ease: 'out(2)' });

		return new Promise<void>((resolve) =>
			setTimeout(() => {
				hero.hidden = undefined;
				resolve();
			}, landing(ease, shot, a, b))
		);
	}

	/**
	 * Scrolls the grid under the viewer so photo `id`'s thumbnail is in the middle of the screen
	 * (as near as the page allows), ready for the photo to land on. Done once paging settles (and
	 * again on the way out, if need be), while the backdrop still hides the grid, so it's already in
	 * place when the backdrop fades. The viewer moves with the scroll, so nothing on screen shifts.
	 *
	 * The scroll is kept within the page itself, not the browser's own limit: the viewer (its
	 * backdrop reaches half a screen below it, and so can a photo dragged down) lets the page
	 * scroll further while it's open, and the page would jump back up as soon as it closed.
	 */
	function reveal(id: string) {
		const el = thumb(id);
		if (!el) return;
		const box = el.getBoundingClientRect();
		const max = Math.max(0, document.body.offsetHeight - root!.clientHeight);
		const y = Math.round(clamp(scrollY + box.top + box.height / 2 - innerHeight / 2, 0, max));
		if (y === Math.round(scrollY)) return;
		scrollTo({ top: y, behavior: 'instant' });
		pin();
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
		if (settling?.targets[0] === img) {
			settling.cancel();
			settling = undefined;
		}
		if (opening?.fly.targets[0] === img) {
			opening.fly.cancel();
			opening = undefined;
			land();
		}
		return at;
	}

	/* Pulling the photo away to close it, by dragging it down or swiping two fingers up or down. */

	type Pull = { img?: HTMLElement; h: number; base: Placement };

	/** Starts pulling the current photo from wherever it is, catching it if it's still flying in. `touch`: by a finger. */
	function startPull(touch = false): Pull {
		const img = lift(touch);
		const base = img ? hold(img) : REST;
		takeOff(trip.photos[current].id);
		for (const el of [img, backdrop, aside, root]) if (el) el.style.transition = 'none';
		if (img) img.style.transform = transform(base);
		return { img, h: scroller.clientHeight, base };
	}

	/** Moves the photo `dx`, `dy` from where it was caught, shrinking it a little and letting the
	    grid show through as it gets `away` px off. */
	function pull({ img, h, base }: Pull, dx: number, dy: number, away: number) {
		const scale = 1 - Math.min(away / h, 1) * 0.3;
		if (img) img.style.transform = transform({ x: base.x + dx, y: base.y + dy, sx: base.sx * scale, sy: base.sy * scale });
		// The backdrop fades, and the root's scrollbar gutter with it.
		const veil = `${1 - Math.min(away / (h * 0.6), 1)}`;
		backdrop.style.opacity = veil;
		root!.style.setProperty('--veil', veil);
		aside.style.opacity = `${1 - Math.min(away / (h * 0.25), 1)}`;
	}

	/** Closes the viewer from wherever the photo was pulled to, carrying on at the release velocity `v`. */
	function dismiss(v: { x: number; y: number }) {
		flick = v;
		leaving = true;
		up(close);
	}

	let returnTimer: ReturnType<typeof setTimeout> | undefined;

	/** Springs a photo pulled not quite far enough back into place, and back into the pager. */
	function unDismiss(img?: HTMLElement) {
		const spring = 'var(--spring-hero-duration) var(--spring-hero)';
		scroller.classList.add('held');
		if (img) img.style.transition = `transform ${spring}`;
		backdrop.style.transition = aside.style.transition = `opacity ${spring}`;
		root!.style.transition = `background-color ${spring}`;
		root!.style.removeProperty('--veil');
		for (const el of [img, aside, backdrop]) if (el) el.style.transform = el.style.opacity = '';
		returnTimer = setTimeout(() => {
			land();
			drop();
			// Hand transitions back to the stylesheet (the backdrop eases its colour between photos).
			for (const el of [backdrop, aside, root]) if (el) el.style.transition = '';
		}, parseFloat(getComputedStyle(viewer).getPropertyValue('--spring-hero-duration')));
	}

	/* Zoom. Pinching takes a closer look, over everything, until the fingers let go. Double-tap
	   (or double-click), or a trackpad pinch, zooms in and stays: the pager holds still, dragging and
	   two-finger swipes pan the photo instead, and paging zooms back out. */

	type Point = { x: number; y: number };
	const REST: Placement = { x: 0, y: 0, sx: 1, sy: 1 };

	/** The zoomed-in photo, if any. Its slide loads the largest image there is. */
	let zoomed = $state<string>();
	/** A photo springing back within bounds, or back into place after a pinch. */
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

	/** Springs photo `img` to `z`, launched at `v` px/s. A pinched photo goes back in its slide once it's there. */
	function settle(img: HTMLElement, z: Placement, v: Point = { x: 0, y: 0 }) {
		const at = placement(img);
		zoomed = z.sx > 1 ? trip.photos[current].id : undefined;
		const anim = (settling = waapi.animate(img, { transform: [transform(at), transform(z)], ease: toward(at, z, v) }));
		anim.then(() => {
			if (settling !== anim) return;
			settling = undefined;
			if (z !== REST) return;
			// Back at rest: hand the transform back to the stylesheet.
			img.style.removeProperty('transform');
			if (img === lifted?.el) drop();
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
		const img = currentShot();
		if (!img) return;
		hold(img);
		settle(img, REST);
	}

	let lastTap = { t: 0, x: 0, y: 0 };

	/** A second tap in the same spot zooms in around it, or back out. */
	function tap(e: PointerEvent) {
		const double = e.timeStamp - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30;
		lastTap = double ? { t: 0, x: 0, y: 0 } : { t: e.timeStamp, x: e.clientX, y: e.clientY };
		const img = currentShot();
		if (!double || !img || lifted) return;
		const z = hold(img);
		settle(img, z.sx > 1.01 ? REST : within(img, around(img, z, TAP_ZOOM, { x: e.clientX, y: e.clientY })));
	}

	/** Fingers on the stage. A second one starts a pinch. */
	const fingers = new Map<number, Point>();
	let pinch: { img: HTMLElement; ids: number[]; d0: number; m0: Point; base: Placement; at: Placement; tracker: VelocityTracker } | null = null;

	const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

	function startPinch() {
		// Whatever the first finger was doing gives way to the pinch.
		drag = null;
		const img = lift(true);
		if (!img) return;
		const ids = [...fingers.keys()];
		const [a, b] = ids.map((id) => fingers.get(id)!);
		const base = hold(img);
		img.style.transform = transform(base);
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

	/* Pointer drags. Touches page by native scrolling (the scroller only takes sideways pans, so
	   everything else comes here); a mouse drags the pager by script. Down dismisses, or pans when
	   zoomed in. */

	type Drag = {
		id: number;
		x0: number;
		y0: number;
		axis?: 'x' | 'y' | 'pan';
		mouse: boolean;
		/** Scroll position when the drag set off sideways. */
		start: number;
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
		// Touches stay with where they started anyway.
		if (e.pointerType === 'mouse') scroller.setPointerCapture(e.pointerId);
		if (fingers.size === 2 && !pinch && drag?.axis !== 'y' && !toss) startPinch();
		if (drag || pinch || toss || !e.isPrimary) return;
		drag = {
			id: e.pointerId,
			x0: e.clientX,
			y0: e.clientY,
			mouse: e.pointerType === 'mouse',
			start: 0,
			w: pitch(),
			h: scroller.clientHeight,
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
			const axis = zoomed ? 'pan' : Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
			// Sideways touches are the scroller's. And no pulling the photo away mid-swipe.
			if ((axis === 'x' && !drag.mouse) || (axis === 'y' && scrolling)) {
				drag = null;
				return;
			}
			drag.axis = axis;
			// Start from here rather than jumping by the slop.
			drag.x0 = e.clientX;
			drag.y0 = e.clientY;
			dx = dy = 0;
			if (axis === 'y') drag.pull = startPull(!drag.mouse);
			else if (axis === 'pan') {
				const img = currentShot()!;
				const base = hold(img);
				drag.pan = { img, base, at: base };
			} else {
				drag.start = scroller.scrollLeft;
				scroller.classList.add('free');
			}
		}
		drag.tracker.add(e.timeStamp, dx, dy);

		if (drag.axis === 'x') scroller.scrollLeft = drag.start - dx;
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
			scroller.classList.add('held');
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
		} else if (d.axis === 'x') release(v.x, d.w);
		else if (d.axis === 'pan') letGo(d.pan!.img, d.pan!.at, v);
		// A touch the scroller took over is cancelled; anything else that didn't move is a tap.
		else if (e.type !== 'pointercancel') tap(e);
	}

	/* Wheels and trackpads. Sideways swipes scroll the pager natively. A trackpad pinch (a wheel
	   with ctrl held) zooms, and zoomed in, swipes pan. Swiping up or down pulls the photo like a
	   drag: once the swipe (momentum included) stops, it closes if it went far enough, or springs
	   back. A hard flick closes as soon as it has gone a good way, rather than letting the momentum
	   carry it off. */

	let toss: { pull: Pull; x: number; y: number; v: { x: number; y: number }; timer: ReturnType<typeof setTimeout>; tracker: VelocityTracker } | null = null;

	function onwheel(e: WheelEvent) {
		if (drag || pinch) return;
		const px = e.deltaMode === 1 ? 16 : 1;
		const dx = e.deltaX * px;
		const dy = e.deltaY * px;
		// Sideways, or anything at all while a sideways swipe is still going: the scroller's.
		if (!e.ctrlKey && !zoomed && !toss && (Math.abs(dx) > Math.abs(dy) || scrolling)) return;
		e.preventDefault(); // also stops the browser zooming the page
		if (leaving || closing) return;
		if (e.ctrlKey) {
			if (!toss) zoomWheel(e, dy);
		} else if (zoomed) panWheel(dx, dy);
		else tossWheel(e, dx, dy);
	}

	/** Trackpad pinches zoom around the pointer. */
	function zoomWheel(e: WheelEvent, dy: number) {
		const img = currentShot();
		if (!img || lifted) return;
		const z = hold(img);
		const s = clamp(z.sx * Math.exp(-dy / 100), 1, MAX_ZOOM);
		img.style.transform = transform(within(img, around(img, z, s, { x: e.clientX, y: e.clientY })));
		zoomed = s > 1 ? trip.photos[current].id : undefined;
	}

	function panWheel(dx: number, dy: number) {
		const img = currentShot();
		if (!img) return;
		const z = hold(img);
		img.style.transform = transform(within(img, { ...z, x: z.x - dx, y: z.y - dy }));
	}

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
		else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			e.preventDefault();
			step(e.key === 'ArrowLeft' ? -1 : 1);
		}
	}

	// Which way the caption drifts in: with the photos when paging, up when opening.
	let dir = $state(0);
	let prevCurrent = start;
	$effect.pre(() => {
		dir = Math.sign(current - prevCurrent);
		prevCurrent = current;
	});
</script>

<svelte:window {onkeydown} onscroll={pin} />

<svelte:head>
	<title>{shown.title} — {trip.name}</title>
</svelte:head>

<div class="viewer" class:opening={from} style:top="{top}px" role="dialog" aria-modal="true" aria-label={shown.title} bind:this={viewer}>
	<div class="backdrop" bind:this={backdrop} style:--tint={shown.color}></div>

	<!-- Swipe sideways to page and down to close, pinch or double-tap to zoom; the buttons and arrow
	     keys cover paging and closing. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="scroller"
		class:zoomed
		bind:this={scroller}
		{onscroll}
		onscrollend={settled}
		{onpointerdown}
		{onpointermove}
		{onpointerup}
		onpointercancel={onpointerup}
	>
		<div class="track" bind:this={track} style="transform: translateX(calc({-start} * (100cqw + {GAP}px)))">
			{#each trip.photos as p, i (p.id)}
				{@const here = i === current}
				<div class="slide" data-current={here || null} aria-hidden={!here || null}>
					{#if near(i)}
						<Photo
							class="shot"
							{trip}
							photo={p}
							sizes={p.id === zoomed ? '400vw' : sizes.viewer(p)}
							eager
							fetchpriority={here ? 'high' : 'low'}
							preview={p.id === from?.id ? from.preview : undefined}
							style="--ar: {ratio(p)}"
						/>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	<aside bind:this={aside}>
		<div class="captions">
			{#key shown.id}
				<div class="caption" style:--dx="{dir * 12}px" style:--dy="{dir ? 0 : 8}px" out:fade={{ duration: reduced() ? 0 : 120 }}>
					<h2>{shown.title}</h2>
					{#if shown.description}<p>{shown.description}</p>{/if}
				</div>
			{/key}
		</div>

		<nav>
			<span class="count">{current + 1} / {trip.photos.length}</span>
			<span class="arrows">
				{#if current > 0}
					<a
						href={href(trip.photos[current - 1].id)}
						onclick={(e) => {
							e.preventDefault();
							step(-1);
						}}
						aria-label="Previous photo">←</a
					>
				{:else}
					<span aria-hidden="true">←</span>
				{/if}
				{#if current < last}
					<a
						href={href(trip.photos[current + 1].id)}
						onclick={(e) => {
							e.preventDefault();
							step(1);
						}}
						aria-label="Next photo">→</a
					>
				{:else}
					<span aria-hidden="true">→</span>
				{/if}
			</span>
		</nav>
	</aside>

	<!-- A photo out of the pager (flying, pulled away or pinched) is here, over everything. -->
	<div class="air" bind:this={air}></div>
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

	/* Its own layer so swiping down (which sets its opacity) can fade it to reveal the grid
	   underneath. Changing photos shifts its colour (a crossfade would let the grid show through).
	   It reaches under Safari's see-through toolbars, so they show it too. */
	.backdrop {
		position: absolute;
		inset: -50vh 0;
		z-index: -1;
		background: color-mix(in oklab, var(--tint) 14%, var(--bg));
		transition: background-color 300ms ease;
		will-change: opacity;
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

	/* The pager: a sideways scroller that snaps to one photo at a time, one per swipe however hard
	   it's flicked. It takes sideways pans only; other touches go to the pointer handlers. Its
	   bounce at either end stays its own, rather than swiping the browser back. */
	.scroller {
		overflow-x: auto;
		overflow-y: hidden;
		overscroll-behavior: contain;
		scroll-snap-type: x mandatory;
		scrollbar-width: none;
		touch-action: pan-x;
		container-type: size;
		user-select: none;
		-webkit-user-select: none;
	}

	.scroller::-webkit-scrollbar {
		display: none;
	}

	/* A mouse drag moves it freely; it snaps again once it's let go and has come to rest. */
	.scroller:global(.free) {
		scroll-snap-type: none;
	}

	/* Zoomed in, or with the photo out of it: it holds still, and drags go to the photo. Hidden
	   overflow keeps the scroll position. */
	.scroller.zoomed,
	.scroller:global(.held) {
		overflow-x: hidden;
		touch-action: none;
	}

	.scroller.zoomed {
		cursor: grab;
	}

	/* Zoomed in, the photo stays inside its slide's padding, clear of the caption and the edges. */
	.scroller.zoomed .slide[data-current] {
		clip-path: inset(var(--pad));
	}

	.track {
		display: flex;
		gap: 24px; /* GAP */
		height: 100%;
	}

	.slide {
		position: relative;
		flex: 0 0 100cqw;
		box-sizing: border-box;
		container-type: size;
		display: grid;
		place-items: center;
		--pad: 40px;
		padding: var(--pad);
		scroll-snap-align: center;
		scroll-snap-stop: always;
	}

	/* Size the image box to the photo itself (not a letterboxed frame), so it
	   flies between the real photo edges. */
	.slide :global(.shot) {
		width: min(100cqw, 100cqh * var(--ar));
		aspect-ratio: var(--ar);
	}

	/* Over the stage and the caption alike, so a photo out of the pager can go anywhere. */
	.air {
		position: absolute;
		inset: 0;
		z-index: 2;
		pointer-events: none;
	}

	.air :global(.lifted) {
		position: absolute;
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
		animation: caption-in var(--spring-ui-duration) var(--spring-ui) backwards;
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
