// HARU Dashboard Service Worker
const CACHE_NAME = 'haru-dashboard-v3';
const urlsToCache = [
  '/',
  '/index.html',
  '/icon-192.svg',
  '/icon-512.svg',
  '/manifest.json'
];

// 설치 이벤트
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('캐시 열림');
        return cache.addAll(urlsToCache);
      })
      .catch(function(err) {
        console.log('캐시 실패:', err);
      })
  );
  // 즉시 활성화
  self.skipWaiting();
});

// 활성화 이벤트
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.filter(function(cacheName) {
          return cacheName !== CACHE_NAME;
        }).map(function(cacheName) {
          return caches.delete(cacheName);
        })
      );
    })
  );
  // 모든 클라이언트 제어
  self.clients.claim();
});

// Fetch 이벤트 - 네트워크 우선 전략
self.addEventListener('fetch', function(event) {
  event.respondWith(
    fetch(event.request)
      .then(function(response) {
        // 유효한 응답이면 캐시에 저장
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then(function(cache) {
              cache.put(event.request, responseToCache);
            });
        }
        return response;
      })
      .catch(function() {
        // 네트워크 실패 시 캐시에서 제공
        return caches.match(event.request);
      })
  );
});