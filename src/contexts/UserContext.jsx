import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';

const UserContext = createContext();

export function useUser() {
  return useContext(UserContext);
}

const PROJECT_ID = 'my-booking-app-3f0e7';

// beforeunload 시 fetch keepalive + Firebase token으로 오프라인 처리
// sendBeacon은 커스텀 헤더 불가 → fetch keepalive 사용
async function setOfflineOnClose(uid) {
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}?updateMask.fieldPaths=isOnline`;
    fetch(url, {
      method: 'PATCH',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ fields: { isOnline: { booleanValue: false } } }),
    }).catch(() => {});
  } catch (e) {}
}

export function UserProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [companyId, setCompanyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const heartbeatRef = useRef(null);
  const uidRef = useRef(null);

  const setOnline = async (uid) => {
    try {
      await updateDoc(doc(db, 'users', uid), {
        isOnline: true,
        lastSeen: serverTimestamp(),
      });
    } catch (e) {}
  };

  const setOffline = async (uid) => {
    try {
      await updateDoc(doc(db, 'users', uid), { isOnline: false });
    } catch (e) {}
  };

  const stopHeartbeat = () => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  };

  const startHeartbeat = (uid) => {
    stopHeartbeat(); // 기존 interval 정리 후 새로 시작 (중복 방지)
    setOnline(uid);
    heartbeatRef.current = setInterval(() => setOnline(uid), 60 * 1000);
  };

  // beforeunload / visibilitychange handlers
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (uidRef.current) setOfflineOnClose(uidRef.current);
    };
    const handleVisibilityChange = () => {
      if (!uidRef.current) return;
      if (document.hidden) {
        stopHeartbeat();
        setOffline(uidRef.current);
      } else {
        startHeartbeat(uidRef.current);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      setUser(authUser);

      if (authUser) {
        uidRef.current = authUser.uid;
        try {
          const userDocRef = doc(db, 'users', authUser.uid);
          const userDocSnap = await getDoc(userDocRef);

          if (userDocSnap.exists()) {
            const data = userDocSnap.data();
            setUserData(data);
            setCompanyId(data.companyId);
            console.log('✅ User loaded:', {
              uid: authUser.uid,
              email: authUser.email,
              companyId: data.companyId
            });
            startHeartbeat(authUser.uid);
          } else {
            console.warn('⚠️ User document not found in Firestore');
            setUserData(null);
            setCompanyId(null);
          }
        } catch (error) {
          console.error('❌ Error fetching user data:', error);
          setUserData(null);
          setCompanyId(null);
        }
      } else {
        if (uidRef.current) setOffline(uidRef.current);
        uidRef.current = null;
        stopHeartbeat();
        setUserData(null);
        setCompanyId(null);
      }

      setLoading(false);
    });

    return () => {
      unsubscribe();
      stopHeartbeat();
    };
  }, []);

  const value = { user, userData, companyId, loading };

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}
