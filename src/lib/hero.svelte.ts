import type { Spring } from 'animejs';

/**
 * The open photo flies between its grid thumbnail and the viewer. The viewer's own image does
 * the flying (it's transformed onto the thumbnail's box), and the thumbnail is hidden meanwhile.
 */
export const hero = $state<{ hidden?: string }>({});

/** Handed from the grid to the viewer when it opens a photo: which one, and its thumbnail if that has loaded. */
export const opened: { id?: string; preview?: string } = {};

/** The grid thumbnail for a photo, if the grid is mounted. */
export const thumb = (id: string) =>
	document.querySelector<HTMLElement>(`[data-thumb="${CSS.escape(id)}"] .thumb`) ?? undefined;

export type Placement = { x: number; y: number; sx: number; sy: number };

/** The centre of `el`'s layout box on screen, ignoring any transform it has. */
export function center(el: HTMLElement) {
	const parent = (el.offsetParent as HTMLElement).getBoundingClientRect();
	return { x: parent.left + el.offsetLeft + el.offsetWidth / 2, y: parent.top + el.offsetTop + el.offsetHeight / 2 };
}

/** The transform that puts `el` (transformed from its centre) exactly over `box`. */
export function onto(el: HTMLElement, box: DOMRect): Placement {
	const c = center(el);
	return {
		x: box.left + box.width / 2 - c.x,
		y: box.top + box.height / 2 - c.y,
		sx: box.width / el.offsetWidth,
		sy: box.height / el.offsetHeight
	};
}

/** Where `el`'s transform has it right now, mid-animation or mid-drag included. */
export function placement(el: HTMLElement): Placement {
	const m = new DOMMatrix(getComputedStyle(el).transform);
	return { x: m.e, y: m.f, sx: m.a, sy: m.d };
}

export const transform = ({ x, y, sx, sy }: Placement) => `translate(${x}px, ${y}px) scale(${sx}, ${sy})`;

/** When a flight from `a` to `b` on `ease` gets within half a pixel of landing for good, in ms. */
export function landing(ease: Spring, el: HTMLElement, a: Placement, b: Placement) {
	const distance = Math.hypot(b.x - a.x, b.y - a.y) + Math.abs(b.sx - a.sx) * el.offsetWidth + Math.abs(b.sy - a.sy) * el.offsetHeight;
	let t = ease.solverDuration;
	while (t > 0 && Math.abs(1 - ease.solve(t)) * distance < 0.5) t -= 0.01;
	return (t + 0.01) * 1000;
}
