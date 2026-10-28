# Agent instructions

## Browser

When you need a browser (checking the local dev server, screenshots, clicking through pages),
use Orca's built-in browser via the `orca-cli` skill (`orca tab create`, `orca screenshot`, …).
Don't use Claude in Chrome or other browser tools unless explicitly asked.

Orca's built-in browser aborts view transitions (`document.startViewTransition` always fails
there), so it can't verify page-transition animations. For motion, ask the user to check in a
real browser.
