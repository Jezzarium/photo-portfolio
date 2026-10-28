<script lang="ts">
	import { page } from '$app/state';
</script>

<div class="error">
	<h1>{page.status}</h1>
	<p>{page.error?.message}</p>
	<a href="/">Back to all trips</a>
</div>

<style>
	.error {
		margin-top: 80px;
	}

	h1 {
		font-size: 40px;
	}

	p {
		margin: 8px 0 24px;
		color: var(--muted);
	}

	a {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
</style>
