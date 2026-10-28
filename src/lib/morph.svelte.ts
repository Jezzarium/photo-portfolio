/**
 * Which photo is morphing between the grid and the viewer in the current view
 * transition. Only the matching image gets a `view-transition-name`, so the
 * browser snapshots one image instead of the whole grid.
 */
export const morph = $state<{ photo?: string }>({});
