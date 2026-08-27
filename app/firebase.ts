import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCUizd7pG4mO9li7MqxjYUN-xNE5DDksxQ",
  authDomain: "assessment-follow-up.firebaseapp.com",
  projectId: "assessment-follow-up",
  storageBucket: "assessment-follow-up.firebasestorage.app",
  messagingSenderId: "497206656774",
  appId: "1:497206656774:web:666996912fc84a2d76a887",
  measurementId: "G-WP3CVNQ3FG",
};

const app = getApps()[0] ?? initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const coordinatorEmail = "saidah.khwar11@gmail.com";

const diagnosticFirebaseConfig = {apiKey:"AIzaSyAe9rRwly1MvZh889dVq33RGyUbj4FVcQI",authDomain:"online-english-lesson-grade-9.firebaseapp.com",databaseURL:"https://online-english-lesson-grade-9-default-rtdb.firebaseio.com",projectId:"online-english-lesson-grade-9",storageBucket:"online-english-lesson-grade-9.firebasestorage.app",appId:"1:542666648554:web:5190c68ea73b3536dae093"};
const diagnosticApp=getApps().some((a)=>a.name==="diagnostic")?getApp("diagnostic"):initializeApp(diagnosticFirebaseConfig,"diagnostic");
export const diagnosticDb=getDatabase(diagnosticApp);
