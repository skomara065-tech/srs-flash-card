import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDocFromServer, updateDoc } from 'firebase/firestore';
import { getAnalytics, logEvent, isSupported } from 'firebase/analytics';
import { getMessaging, getToken } from 'firebase/messaging';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const messaging = getMessaging(app);

export async function setupPushNotifications(userId: string) {
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const fcmToken = await getToken(messaging, { 
        vapidKey: "BLNWc1w4srI6Wq5LTrPQyJG6ueN2zoj3fUIvyO0M3nevpDoT96CkiHkv96JzQzbTCMutEyjeuVA_fSf4Ae3EAo4"
      });
      if (fcmToken) {
        await updateDoc(doc(db, "users", userId), {
          fcmToken,
          lastTokenUpdate: new Date().toISOString()
        });
      }
    }
  } catch (error) {
    console.error("Failed to setup push notifications", error);
  }
}

export const db = initializeFirestore(
  app, 
  { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) },
  firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)' ? firebaseConfig.firestoreDatabaseId : undefined
);

let analytics: ReturnType<typeof getAnalytics> | null = null;
isSupported().then((supported) => {
  if (supported) {
    try {
      analytics = getAnalytics(app);
    } catch (e) {
      // Silently ignore analytics initialization failures (e.g. adblockers)
    }
  }
}).catch(() => {
  // Ignore
});

export { getAnalytics, logEvent };

export function logAnalyticsEvent(name: string, params?: Record<string, any>) {
  if (analytics) {
    try {
      logEvent(analytics, name, params);
    } catch (e) {
      console.error("Analytics error", e);
    }
  }
}


export const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = () => signInWithPopup(auth, googleProvider);
export const signOut = () => auth.signOut();

// Connection test as per critical constraint
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration or internet connection.");
    }
  }
}

testConnection();

// Error handling helper
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
