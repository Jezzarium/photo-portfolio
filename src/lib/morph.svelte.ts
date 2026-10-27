/**
 * Which trip and photo are morphing in the current view transition. Only the
 * matching elements get a `view-transition-name`, so the browser snapshots one
 * image instead of the whole grid.
 */
export const morph = $state<{ trip?: string; photo?: string }>({});
