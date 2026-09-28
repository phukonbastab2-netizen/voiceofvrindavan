// No chat, account, or health information is cached offline.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>new Response('<!doctype html><meta name="viewport" content="width=device-width"><title>Offline</title><body style="background:#0b0b09;color:#dfb96f;font:18px system-ui;padding:32px"><h1>You are offline.</h1><p>Reconnect to open your private chat. This app cannot provide emergency assistance.</p><a href="/app/" style="color:inherit">Try again</a>',{headers:{'Content-Type':'text/html;charset=utf-8'}})));});
