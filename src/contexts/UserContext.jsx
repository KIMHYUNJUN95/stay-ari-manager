import React, { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

const UserContext = createContext();

export function useUser() {
  return useContext(UserContext);
}

export function UserProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [companyId, setCompanyId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      setUser(authUser);

      if (authUser) {
        try {
          // Fetch user document from Firestore
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
        setUserData(null);
        setCompanyId(null);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const value = {
    user,
    userData,
    companyId,
    loading
  };

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}
