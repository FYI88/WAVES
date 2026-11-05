# Startup shell

- `index.html` paints a static, neutral app-shaped shell before React. It follows system light/dark preference, contains no animation or fake results, and stacks scene → results → controls on phones.
- `public/startup.js` is deliberately a local **classic script**, not a module. It runs before the deferred entry, including when that entry cannot download. Vite's warning that this script cannot be bundled is expected: Vite copies it unchanged to `dist/startup.js`.
- `src/main.tsx` keeps the bundled fonts and starts the App import after two animation frames. `src/mountApp.tsx` owns React, App/styles imports and the existing crash boundary. This lets the HTML shell paint before App module evaluation, saved-state hydration and synchronous physics/sweeps without restructuring the solver.
- App's layout-effect callback signals an actual commit and removes the shell immediately: no root-child polling, minimum splash time or fade-out overlay. The render-error boundary also releases it when its existing reload/reset fallback commits.
- Eight seconds is a **slow-loading notice**, not a fatal deadline. The shell remains visible, a native Retry button reloads without deleting state, and a later successful commit still wins. Rejected imports and entry/stylesheet resource failures show retry too.
- The first simulation canvas has a separate, pointer-transparent preparing label in its drawing row until a successful draw. It never covers the scene toolbar or app controls. Paused/reduced-motion drawing retries a missing context.

## Checks

Run `npm test -- --maxWorkers=1`, then `npm run build`. Startup tests execute the actual classic bootstrap against DOM mocks; App tests exercise commit/boundary callbacks and scene tests exercise the first successful frame.

For native releases copy/sync **all of `dist`**, including `startup.js`, dynamic App/math chunks, worker and bundled fonts. Relative asset URLs work on subpath/static Capacitor hosts without an external network. This change does not add an offline cache/service worker for the public website.
