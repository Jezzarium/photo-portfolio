# Uploading a trip

1. Make a folder for the trip with your photos in it, plus a `trip.json` (copy `example/trip.json`).
   Put it in `trips/` or anywhere else. `trips/` is git-ignored, except for `example/`.
2. Preview it locally: `npm run upload -- trips/japan --dry-run`. This writes the processed files
   to `.upload/` and checks `trip.json`, but uploads nothing.
3. Upload it: `npm run upload -- trips/japan`. The trip is live on the site within a minute.

You need to be signed in to Cloudflare (`cf auth whoami`).

## trip.json

```json
{
	"name": "Japan",
	"year": 2025,
	"cover": "shibuya.jpg",
	"photos": [
		{ "file": "shibuya.jpg", "title": "Shibuya", "description": "Optional, shown when the photo is open." },
		{ "file": "temple.jpg", "title": "Temple" }
	]
}
```

- **name**, **year**: shown on the catalogue card. Trips are sorted newest year first.
- **cover**: the photo on the catalogue card. Defaults to the first photo.
- **photos**: in the order they appear. `title` is required and `description` is optional.
  Photos in the folder that aren't listed here are skipped, with a warning.
- **slug** (optional): the trip's URL, `/japan`. Defaults to the folder name.

Each photo's URL comes from its file name (`Temple Steps.jpg` → `/japan/temple-steps`), so
renaming a file changes its link. Location and camera metadata are stripped from uploaded images.

## Changing or removing a trip

- **Change** (photos, order, titles): edit the folder and upload it again. The trip is replaced,
  and files for photos you removed are deleted from R2.
- **Remove**: `npm run upload -- --remove japan`.
