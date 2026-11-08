import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			adapter: adapter(),
			// The stylesheets are all a few kB: inline them into the page, so the first paint doesn't
			// wait on a second round of requests for them.
			inlineStyleThreshold: 8192
		})
	]
});
