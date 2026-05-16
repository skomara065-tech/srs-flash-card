importScripts('https://www.gstatic.com/firebasejs/10.9.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.9.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAylTF-YL492CYKX-fOQwqamyV1Pp-0Gwk",
  authDomain: "gen-lang-client-0936895099.firebaseapp.com",
  projectId: "gen-lang-client-0936895099",
  storageBucket: "gen-lang-client-0936895099.firebasestorage.app",
  messagingSenderId: "834987385355",
  appId: "1:834987385355:web:3c5af31cf4e06391f6dd0e"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message: ', payload);
  
  const notificationTitle = payload.notification?.title || 'New Notification';
  const notificationOptions = {
    body: payload.notification?.body,
    icon: '/vite.svg'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
