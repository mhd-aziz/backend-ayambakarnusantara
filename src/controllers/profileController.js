const {
  firestore,
  auth,
  storage,
  FieldValue,
} = require("../config/firebaseConfig");
const { handleSuccess, handleError } = require("../utils/responseHandler");
const { v4: uuidv4 } = require("uuid");

exports.getProfile = async (req, res) => {
  const uid = req.user?.uid;

  if (!uid) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan untuk melihat profil.",
    });
  }

  try {
    const userDocRef = firestore.collection("users").doc(uid);
    const doc = await userDocRef.get();

    if (!doc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Profil pengguna tidak ditemukan.",
      });
    }
    return handleSuccess(res, 200, "Profil berhasil diambil.", doc.data());
  } catch (error) {
    console.error("Error getting user profile:", error);
    return handleError(res, error, "Gagal mengambil profil pengguna.");
  }
};

async function deleteOldStorageFile(photoURL, bucket) {
  if (!photoURL || !bucket) {
    return;
  }

  try {
    const match = photoURL.match(
      /(?:%2F(profile-images%2F.*?)\?|profile-images\/(.*?)$)/
    );
    let filePath = match ? match[1] || match[2] : null;

    if (!filePath) {
      console.warn(
        "Format URL foto lama tidak dikenali, tidak dapat menghapus:",
        photoURL
      );
      return;
    }

    const decodedFilePath = decodeURIComponent(filePath);
    console.log(`Mencoba menghapus file di Storage: ${decodedFilePath}`);
    await bucket.file(decodedFilePath).delete();
    console.log(`Berhasil menghapus file dari Storage: ${decodedFilePath}`);
  } catch (error) {
    if (error.code === 404) {
      console.warn(
        `File tidak ditemukan di Storage (mungkin sudah dihapus): ${error.message}`
      );
    } else {
      console.error("Gagal menghapus file lama dari Storage:", error.message);
    }
  }
}

async function performUpdates(uid, updatesForFirestore, updatesForAuth) {
  if (Object.keys(updatesForAuth).length > 0) {
    await auth.updateUser(uid, updatesForAuth);
  }

  const userDocRef = firestore.collection("users").doc(uid);

  if (Object.keys(updatesForFirestore).length > 0) {
    updatesForFirestore.updatedAt = new Date().toISOString();
    await userDocRef.update(updatesForFirestore);
  }

  const updatedDoc = await userDocRef.get();
  return updatedDoc.data();
}

exports.updateProfile = async (req, res) => {
  const uid = req.user?.uid;

  if (!uid) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan untuk memperbarui profil.",
    });
  }

  try {
    const userDocRef = firestore.collection("users").doc(uid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Profil pengguna tidak ditemukan.",
      });
    }

    const currentData = userDoc.data();
    const updatesForFirestore = {};
    const updatesForAuth = {};

    const { displayName, phoneNumber, address, removeProfilePhoto } = req.body;
    if (displayName) updatesForFirestore.displayName = displayName;
    if (phoneNumber) updatesForFirestore.phoneNumber = phoneNumber;
    if (address) updatesForFirestore.address = address;

    if (displayName) updatesForAuth.displayName = displayName;
    if (phoneNumber) updatesForAuth.phoneNumber = phoneNumber;

    if (req.file) {
      const oldPhotoURL = currentData.photoURL;
      if (oldPhotoURL) {
        await deleteOldStorageFile(oldPhotoURL, storage.bucket());
      }

      const fileExtension = req.file.originalname.split(".").pop();
      const fileName = `profile-images/${uid}/${uuidv4()}.${fileExtension}`;
      const fileUpload = storage.bucket().file(fileName);

      await fileUpload.save(req.file.buffer, {
        metadata: { contentType: req.file.mimetype },
      });

      const [signedUrl] = await fileUpload.getSignedUrl({
        action: "read",
        expires: "03-09-2491",
      });

      updatesForFirestore.photoURL = signedUrl;
      updatesForAuth.photoURL = signedUrl;
    } else if (removeProfilePhoto === "true") {
      const oldPhotoURL = currentData.photoURL;
      if (oldPhotoURL) {
        await deleteOldStorageFile(oldPhotoURL, storage.bucket());
      }
      updatesForFirestore.photoURL = null;
      updatesForAuth.photoURL = null;
    }

    if (
      Object.keys(updatesForFirestore).length === 0 &&
      !req.file &&
      removeProfilePhoto !== "true"
    ) {
      return handleError(res, {
        statusCode: 400,
        message: "Tidak ada data yang dikirim untuk diperbarui.",
      });
    }

    const updatedData = await performUpdates(
      uid,
      updatesForFirestore,
      updatesForAuth
    );
    return handleSuccess(res, 200, "Profil berhasil diperbarui.", updatedData);
  } catch (error) {
    console.error("Error in updateProfile:", error);
    if (error.code?.startsWith("storage/")) {
      return handleError(
        res,
        { statusCode: 500, message: "Gagal memproses file gambar." },
        "Kesalahan pada storage."
      );
    }
    if (error.code?.startsWith("auth/")) {
      return handleError(res, {
        statusCode: 400,
        message: `Update otentikasi gagal: ${error.message}`,
      });
    }
    return handleError(res, error, "Gagal memperbarui profil.");
  }
};

exports.addFcmToken = async (req, res) => {
  const uid = req.user?.uid;
  const { token } = req.body;

  if (!uid) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }

  if (!token || typeof token !== "string" || token.trim() === "") {
    return handleError(res, {
      statusCode: 400,
      message: "FCM token diperlukan dan harus berupa string.",
    });
  }

  try {
    const userDocRef = firestore.collection("users").doc(uid);
    await userDocRef.update({
      fcmTokens: FieldValue.arrayUnion(token.trim()),
      updatedAt: new Date().toISOString(),
    });

    return handleSuccess(res, 200, "Token FCM berhasil didaftarkan.");
  } catch (error) {
    if (error.code === 5) {
      try {
        const userDocRef = firestore.collection("users").doc(uid);
        await userDocRef.set({ fcmTokens: [token.trim()] }, { merge: true });
        return handleSuccess(
          res,
          200,
          "Token FCM berhasil didaftarkan untuk pengguna baru."
        );
      } catch (setError) {
        return handleError(
          res,
          setError,
          "Gagal membuat dokumen pengguna untuk token FCM."
        );
      }
    }
    console.error(`Error adding FCM token for user ${uid}:`, error);
    return handleError(res, error, "Gagal mendaftarkan token FCM.");
  }
};

exports.deleteProfilePhoto = async (req, res) => {
  const uid = req.user?.uid;

  if (!uid) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan untuk menghapus foto profil.",
    });
  }

  try {
    const userDocRef = firestore.collection("users").doc(uid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Profil pengguna tidak ditemukan.",
      });
    }

    const userData = userDoc.data();
    const currentPhotoURL = userData.photoURL;

    if (!currentPhotoURL) {
      return handleSuccess(res, 200, "Tidak ada foto profil untuk dihapus.");
    }

    const bucket = storage.bucket();
    await deleteOldStorageFile(currentPhotoURL, bucket);

    await performUpdates(uid, { photoURL: null }, { photoURL: null });

    const updatedUserDoc = await userDocRef.get();

    return handleSuccess(
      res,
      200,
      "Foto profil berhasil dihapus.",
      updatedUserDoc.data()
    );
  } catch (error) {
    console.error("Error deleting profile photo:", error);
    if (error.code && error.code.startsWith("auth/")) {
      return handleError(res, {
        statusCode: 400,
        message: `Gagal memperbarui autentikasi: ${error.message}`,
      });
    }
    return handleError(res, error, "Gagal menghapus foto profil.");
  }
};
