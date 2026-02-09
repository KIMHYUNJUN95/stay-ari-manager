// src/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// 사장님의 프로젝트 설정
const firebaseConfig = {
  apiKey: "AIzaSyBHI6d4mDDBEIB77GVQj5Rz1EbMyPaCjgA",
  authDomain: "my-booking-app-3f0e7.firebaseapp.com",
  projectId: "my-booking-app-3f0e7",
  storageBucket: "my-booking-app-3f0e7.firebasestorage.app",
  messagingSenderId: "1008418095386",
  appId: "1:1008418095386:web:99eddb1ec872d0b1906ca3",
  measurementId: "G-KKNJ5P1KFD"
};

// 여기서 딱 한 번 초기화하고 내보냅니다.
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

export const auth = getAuth(app);