// minimal service worker: lets the browser install Eigenyth as an app (own window, own icon).
// The game always loads fresh from the server (multiplayer needs the server anyway).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
