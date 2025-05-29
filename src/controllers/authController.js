// src/controllers/authController.js
const { auth, firestore, clientAuth } = require("../config/firebaseConfig");
const { handleSuccess, handleError } = require("../utils/responseHandler");
const axios = require("axios");
require("dotenv").config();
const { sendPasswordResetEmail } = require("firebase/auth");

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "None",
  maxAge: 24 * 60 * 60 * 1000,
  path: "/",
};

exports.register = async (req, res) => {
  const { email, password, displayName, phoneNumber, address } = req.body;

  if (!email || !password || !displayName) {
    return handleError(res, {
      statusCode: 400,
      message: "Email, password, dan nama lengkap wajib diisi.",
    });
  }
  if (password.length < 6) {
    return handleError(res, {
      statusCode: 400,
      message: "Password minimal 6 karakter.",
    });
  }

  const firebaseWebApiKey = process.env.FIREBASE_API_KEY;
  if (!firebaseWebApiKey) {
    console.error("FIREBASE_API_KEY tidak ditemukan untuk registrasi.");
    return handleError(res, {
      statusCode: 500,
      message: "Kesalahan konfigurasi server.",
    });
  }

  try {
    const createUserPayload = { email, password, displayName };
    if (phoneNumber && phoneNumber.trim() !== "") {
      if (!phoneNumber.startsWith("+")) {
        return handleError(res, {
          statusCode: 400,
          message: "Nomor telepon harus diawali dengan kode negara.",
        });
      }
      createUserPayload.phoneNumber = phoneNumber;
    }
    const userRecord = await auth.createUser(createUserPayload);

    const userDataForFirestore = {
      uid: userRecord.uid,
      email: userRecord.email,
      displayName: userRecord.displayName,
      photoURL: null,
      phoneNumber:
        phoneNumber && phoneNumber.trim() !== "" ? phoneNumber : null,
      address: address || null,
      createdAt: new Date().toISOString(),
      role: "customer",
    };
    await firestore
      .collection("users")
      .doc(userRecord.uid)
      .set(userDataForFirestore);

    const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseWebApiKey}`;
    let idToken;
    try {
      const signInResponse = await axios.post(signInUrl, {
        email: email,
        password: password,
        returnSecureToken: true,
      });
      idToken = signInResponse.data.idToken;
    } catch (signInError) {
      console.error(
        "Gagal mendapatkan ID Token setelah registrasi:",
        userRecord.uid,
        signInError.response?.data || signInError.message
      );
      await auth
        .deleteUser(userRecord.uid)
        .catch((delErr) =>
          console.error("Gagal menghapus user setelah sign-in gagal:", delErr)
        );
      await firestore
        .collection("users")
        .doc(userRecord.uid)
        .delete()
        .catch((delErr) =>
          console.error(
            "Gagal menghapus data firestore setelah sign-in gagal:",
            delErr
          )
        );
      return handleError(
        res,
        signInError,
        "Registrasi berhasil, namun gagal mendapatkan sesi. Silakan coba login."
      );
    }

    res.cookie("authToken", idToken, cookieOptions);

    return handleSuccess(
      res,
      201,
      "Pendaftaran berhasil. Sesi Anda telah dibuat.",
      {
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName,
      }
    );
  } catch (error) {
    console.error("Registration Process Error:", error);
    if (error.code === "auth/email-already-exists") {
      return handleError(res, {
        statusCode: 400,
        message: "Email sudah terdaftar.",
      });
    }
    if (error.code === "auth/phone-number-already-exists") {
      return handleError(res, {
        statusCode: 400,
        message: "Nomor telepon sudah digunakan.",
      });
    }
    if (
      error.code === "auth/invalid-photo-url" ||
      (error.message && error.message.includes("photoURL"))
    ) {
      return handleError(res, {
        statusCode: 400,
        message: `Masalah dengan photoURL: ${error.message}`,
      });
    }
    return handleError(
      res,
      error,
      "Pendaftaran gagal. Terjadi kesalahan internal."
    );
  }
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return handleError(res, {
      statusCode: 400,
      message: "Email dan password wajib diisi.",
    });
  }

  const firebaseWebApiKey = process.env.FIREBASE_API_KEY;
  if (!firebaseWebApiKey) {
    console.error("FIREBASE_API_KEY tidak ditemukan.");
    return handleError(res, {
      statusCode: 500,
      message: "Kesalahan konfigurasi server.",
    });
  }

  const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseWebApiKey}`;
  try {
    const firebaseResponse = await axios.post(signInUrl, {
      email: email,
      password: password,
      returnSecureToken: true,
    });
    const uid = firebaseResponse.data.localId;
    const idToken = firebaseResponse.data.idToken;

    const userDoc = await firestore.collection("users").doc(uid).get();
    if (!userDoc.exists) {
      console.warn(
        `Data pengguna tidak ditemukan di Firestore untuk UID: ${uid}`
      );
      return handleError(res, {
        statusCode: 401,
        message: "Email atau password salah, atau data pengguna tidak lengkap.",
      });
    }
    const userData = userDoc.data();

    res.cookie("authToken", idToken, cookieOptions);

    return handleSuccess(res, 200, "Login berhasil! Sesi Anda telah dibuat.", {
      user: {
        uid: userData.uid,
        email: userData.email,
        displayName: userData.displayName,
        phoneNumber: userData.phoneNumber,
        address: userData.address,
        photoURL: userData.photoURL,
        role: userData.role,
        createdAt: userData.createdAt,
      },
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data?.error) {
      const firebaseError = error.response.data.error;
      console.error("Auth Service Error (Login):", firebaseError.message);
      let clientMessage = "Email atau password salah.";
      if (firebaseError.message === "USER_DISABLED")
        clientMessage = "Akun ini telah dinonaktifkan.";
      else if (firebaseError.message === "INVALID_LOGIN_CREDENTIALS")
        clientMessage = "Email atau password salah.";
      return handleError(res, { statusCode: 401, message: clientMessage });
    }
    console.error("Login Error:", error);
    return handleError(res, error, "Login gagal.");
  }
};

exports.logout = (req, res) => {
  try {
    res.cookie("authToken", "", {
      ...cookieOptions,
      expires: new Date(0),
    });
    return handleSuccess(res, 200, "Logout berhasil.");
  } catch (error) {
    console.error("Logout Error:", error);
    return handleError(res, error, "Logout gagal. Terjadi kesalahan server.");
  }
};

exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return handleError(res, { statusCode: 400, message: "Email wajib diisi." });
  }
  if (!clientAuth) {
    console.error("Firebase Client Auth (clientAuth) tidak terinisialisasi.");
    return handleError(res, {
      statusCode: 500,
      message: "Layanan reset password tidak tersedia.",
    });
  }

  try {
    await auth.getUserByEmail(email);
    await sendPasswordResetEmail(clientAuth, email);
    console.log(`Email reset password untuk ${email} telah dikirim.`);
    return handleSuccess(
      res,
      200,
      `Tautan reset password telah dikirim ke ${email}.`
    );
  } catch (error) {
    if (error.code === "auth/user-not-found") {
      console.log(
        `Permintaan reset password untuk email tidak terdaftar: ${email}`
      );
      return handleSuccess(
        res,
        200,
        `Jika email ${email} terdaftar, tautan reset password telah dikirim.`
      );
    }
    if (error.code === "auth/invalid-email") {
      console.error(
        "Error sending password reset email (Client SDK - invalid email):",
        error.message
      );
      return handleError(res, {
        statusCode: 400,
        message: "Format email tidak valid.",
      });
    }
    console.error(
      "Error in forgotPassword process:",
      error.code,
      error.message
    );
    return handleError(
      res,
      error,
      "Gagal memproses permintaan reset password."
    );
  }
};

exports.deleteUser = async (req, res) => {
  const uid = req.user?.uid;
  if (!uid) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan untuk menghapus akun.",
    });
  }

  try {
    await auth.deleteUser(uid);
    const userDocRef = firestore.collection("users").doc(uid);
    await userDocRef.delete();

    res.cookie("authToken", "", {
      ...cookieOptions,
      expires: new Date(0),
    });

    console.log(`Akun dengan UID: ${uid} berhasil dihapus.`);
    return handleSuccess(res, 200, "Akun Anda berhasil dihapus.");
  } catch (error) {
    console.error(`Error deleting account UID: ${uid}:`, error);
    if (error.code === "auth/user-not-found") {
      const userDocRef = firestore.collection("users").doc(uid);
      try {
        await userDocRef.delete();
        console.log(
          `Dokumen Firestore untuk UID: ${uid} dihapus setelah error auth/user-not-found.`
        );
      } catch (firestoreDeleteError) {
        console.error(
          `Gagal menghapus dokumen Firestore untuk UID: ${uid} setelah error:`,
          firestoreDeleteError
        );
      }
      return handleError(res, {
        statusCode: 404,
        message: "Akun tidak ditemukan.",
      });
    }
    return handleError(res, error, "Gagal menghapus akun.");
  }
};
