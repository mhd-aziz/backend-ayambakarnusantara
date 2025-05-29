// src/config/firebaseConfig.js
const admin = require("firebase-admin");
const { initializeApp: initializeClientApp } = require("firebase/app");
const { getAuth: getClientAuth } = require("firebase/auth");
require("dotenv").config();

let adminAuth, firestoreDb, adminStorage, adminInstance;
try {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH;
  if (!serviceAccountPath) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY_PATH environment variable is not set."
    );
  }

  const serviceAccount = require(serviceAccountPath);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET, 
  });

  adminAuth = admin.auth();
  firestoreDb = admin.firestore();
  adminStorage = admin.storage(); 
  adminInstance = admin;
  console.log(
    "Firebase Admin SDK initialized successfully (Auth, Firestore, Storage)."
  );
} catch (error) {
  console.error("Error initializing Firebase Admin SDK:", error);
  process.exit(1); 
}

let clientAuth;
try {
  const clientFirebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET, 
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID, 
  };

  if (
    !clientFirebaseConfig.apiKey ||
    !clientFirebaseConfig.authDomain ||
    !clientFirebaseConfig.projectId
  ) {
    throw new Error(
      "Missing essential Firebase client configuration (apiKey, authDomain, projectId) in .env file."
    );
  }

  const firebaseClientApp = initializeClientApp(clientFirebaseConfig);
  clientAuth = getClientAuth(firebaseClientApp);
  console.log(
    "Firebase Client SDK initialized successfully for backend use (Auth)."
  );
} catch (error) {
  console.error(
    "Error initializing Firebase Client SDK for backend use:",
    error
  );
  clientAuth = null;
}

module.exports = {
  auth: adminAuth,
  firestore: firestoreDb,
  storage: adminStorage,
  admin: adminInstance, 
  clientAuth: clientAuth, 
};
