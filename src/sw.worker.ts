// super simple service worker to add COEP and COOP headers
// to every request to this origin. This is required so that
// we can use SharedArrayBuffer.

declare let self: ServiceWorkerGlobalScope;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener('fetch', (event) => {
  if (
    event.request.mode !== 'same-origin' &&
    event.request.cache === 'only-if-cached'
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request).then((response) => {
      const headers = new Headers(response.headers);
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');

      return new Response(response.body, { ...response, headers });
    }),
  );
});
