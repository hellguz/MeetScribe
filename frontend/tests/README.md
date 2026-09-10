# Browser checks

`browser.mjs` drives the running dev server in a real browser. It exists for
the handful of things that only appear there, each of which shipped as a bug
first:

- the record page fetching ~700 MB of models before anyone had pressed record;
- the top-bar dial keeping a previous page's "Loading model" after a
  client-side route change, because the new badge read the shared slot before
  the old page's cleanup cleared it and then missed the broadcast;
- the padlock and the link mark opening the same panel.

No framework and no browser download. It needs `playwright-core` — which ships
no binaries — and any installed Chrome or Edge:

```
npm install --no-save playwright-core
npm run dev                                   # in another terminal
node tests/browser.mjs
```

`BASE` overrides the server URL (default `http://localhost:5173`), `CHROME` the
browser path, `OUT` where the two screenshots are written. It seeds its own
meeting into IndexedDB and localStorage, so it never touches real data beyond
the origin it is pointed at.
