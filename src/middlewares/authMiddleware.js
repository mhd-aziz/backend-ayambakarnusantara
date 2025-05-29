// src/middlewares/authMiddleware.js
const { auth, firestore } = require("../config/firebaseConfig");
const { handleError } = require("../utils/responseHandler");

exports.authenticateToken = async (req, res, next) => {
  let token = null;

  if (req.cookies && req.cookies.authToken) {
    token = req.cookies.authToken;
  } else {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split("Bearer ")[1];
    }
  }

  if (!token) {
    return handleError(res, {
      statusCode: 401,
      message: "Akses ditolak. Token tidak disertakan.",
    });
  }

  try {
    const decodedToken = await auth.verifyIdToken(token, true);
    req.user = decodedToken;
    next();
  } catch (error) {
    if (
      error.code === "auth/id-token-expired" ||
      error.code === "auth/argument-error" ||
      error.code === "auth/id-token-revoked"
    ) {
      res.cookie("authToken", "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "None",
        expires: new Date(0),
        path: "/", 
      });
    }

    if (error.code === "auth/id-token-expired") {
      return handleError(res, {
        statusCode: 401,
        message: "Akses ditolak. Token telah kedaluwarsa.",
        errorCode: "TOKEN_EXPIRED",
      });
    }
    if (error.code === "auth/id-token-revoked") {
      return handleError(res, {
        statusCode: 401,
        message: "Akses ditolak. Token telah dicabut.",
        errorCode: "TOKEN_REVOKED",
      });
    }
    if (error.code === "auth/argument-error") {
      return handleError(res, {
        statusCode: 401,
        message: "Akses ditolak. Token tidak valid.",
        errorCode: "TOKEN_INVALID_FORMAT",
      });
    }
    console.error("Error verifying ID token:", error.code, error.message);
    return handleError(res, {
      statusCode: 403,
      message: "Akses ditolak. Gagal memverifikasi token.",
      errorCode: "TOKEN_VERIFICATION_FAILED",
    });
  }
};

exports.isSeller = async (req, res, next) => {
  if (!req.user || !req.user.uid) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan untuk verifikasi peran.",
    });
  }

  const uid = req.user.uid;

  try {
    const userDocRef = firestore.collection("users").doc(uid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Data pengguna tidak ditemukan untuk verifikasi peran.",
      });
    }

    const userData = userDoc.data();
    if (userData.role === "seller") {
      next();
    } else {
      return handleError(res, {
        statusCode: 403,
        message: "Akses ditolak. Peran 'seller' diperlukan.",
      });
    }
  } catch (error) {
    console.error("Error in isSeller middleware:", error);
    return handleError(
      res,
      error,
      "Gagal melakukan otorisasi peran seller karena kesalahan server."
    );
  }
};
