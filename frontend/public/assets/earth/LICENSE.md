# Earth texture assets — provenance & license

These textures are used to render the interactive 3D Earth globe. They are local,
static assets (no runtime external fetch).

| File | Source | License |
|---|---|---|
| `earth_day_2048.jpg` | three.js examples (`examples/textures/planets/earth_atmos_2048.jpg`, tag r170) | three.js is MIT-licensed; the underlying Blue Marble imagery is **NASA — public domain** |
| `earth_night_2048.png` | three.js examples (`earth_lights_2048.png`, r170) | NASA Earth at Night — **public domain** (bundled via MIT-licensed three.js) |
| `earth_specular_2048.jpg` | three.js examples (`earth_specular_2048.jpg`, r170) | NASA-derived land/ocean mask — **public domain** (bundled via MIT-licensed three.js) |

NASA imagery: https://visibleearth.nasa.gov/ (public domain, no permission required).
three.js: https://github.com/mrdoob/three.js (MIT). Downloaded at build/dev time,
served same-origin from `public/assets/earth/`. No API keys, no external runtime
dependency.
