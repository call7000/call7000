import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCn-XlZlrr6exS5gQhXq_2EqcM1cO5Pg1w",
  authDomain: "call7000-a8379.firebaseapp.com",
  databaseURL: "https://call7000-a8379-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "call7000-a8379",
  storageBucket: "call7000-a8379.firebasestorage.app",
  messagingSenderId: "776362543798",
  appId: "1:776362543798:web:1995d4ec21a6abe73ff417"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
