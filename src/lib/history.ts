import { afterNavigate, goto } from '$app/navigation';

/**
 * The paths of this tab's history entries since the site loaded, and which one we're on. Going
 * up (closing a photo, leaving a trip) steps back through these when the page above is the one
 * we came from, so the browser's own back and forward keep matching the site's back button.
 */
let entries: string[] = [];
let at = -1;

/** Keeps `entries` in step with the browser. Call once, from the root layout. */
export function trackHistory() {
	afterNavigate((nav) => {
		const { from, to, type } = nav;
		if (!to) return;
		const path = to.url.pathname;
		if (nav.type === 'popstate') at += nav.delta;
		// Paging between photos replaces the entry rather than adding one.
		else if (from?.params?.photo && to.params?.photo && from.params.trip === to.params.trip) entries[at] = path;
		else if (type !== 'enter' && path !== entries[at]) {
			entries = entries.slice(0, ++at);
			entries[at] = path;
		}
		// Lost track (the first page, or back past it after a reload): start over from here.
		if (entries[at] !== path) {
			entries = [path];
			at = 0;
		}
	});
}

/** Whether going up to `path` is just going back. */
export const cameFrom = (path: string) => entries[at - 1] === path;

/** Goes up to `path`, back through history if that's where we came from. */
export function up(path: string) {
	if (cameFrom(path)) history.back();
	else goto(path, { reset: false });
}
