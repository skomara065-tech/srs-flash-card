import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

export function useAdmin(user: User | null) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminLoading, setAdminLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function checkAdmin() {
      if (!user) {
        if (isMounted) {
          setIsAdmin(false);
          setAdminLoading(false);
        }
        return;
      }

      // Automatically grant admin rights to the app creator
      if (user.email === 'skomara065@gmail.com') {
        if (isMounted) {
          setIsAdmin(true);
          setAdminLoading(false);
        }
        return;
      }

      try {
        const adminDoc = await getDoc(doc(db, 'admin_users', user.uid));
        if (isMounted) {
          setIsAdmin(adminDoc.exists() && adminDoc.data()?.role === 'admin');
        }
      } catch (error) {
        console.error("Error checking admin status:", error);
        if (isMounted) setIsAdmin(false);
      } finally {
        if (isMounted) setAdminLoading(false);
      }
    }

    setAdminLoading(true);
    checkAdmin();

    return () => {
      isMounted = false;
    };
  }, [user]);

  return { isAdmin, adminLoading };
}
