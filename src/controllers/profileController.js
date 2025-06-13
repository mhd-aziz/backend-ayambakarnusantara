// src/controllers/profileController.js
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

// Helper function to safely delete an old photo from Firebase Storage
async function deleteOldStorageFile(photoURL, bucket) {
  if (!photoURL || !bucket) {
    console.log(
      "Tidak ada photoURL atau bucket yang disediakan untuk deleteOldStorageFile."
    );
    return;
  }

  try {
    const prefixPattern1 = `https://storage.googleapis.com/${bucket.name}/`;
    const prefixPattern2 = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/`;

    let filePath;

    if (photoURL.startsWith(prefixPattern1)) {
      filePath = photoURL.substring(prefixPattern1.length);
    } else if (photoURL.startsWith(prefixPattern2)) {
      filePath = photoURL.substring(prefixPattern2.length);
      filePath = filePath.split("?")[0];
    } else {
      console.warn(
        "Format URL foto lama tidak dikenali, tidak dapat menghapus:",
        photoURL
      );
      return;
    }

    filePath = filePath.split("?")[0]; // Hapus query params tambahan

    if (filePath) {
      const decodedFilePath = decodeURIComponent(filePath);
      console.log(`Mencoba menghapus file di Storage: ${decodedFilePath}`);
      await bucket.file(decodedFilePath).delete();
      console.log(`Berhasil menghapus file dari Storage: ${decodedFilePath}`);
    }
  } catch (error) {
    if (error.code === 404 || error.message.includes("No such object")) {
      console.warn(
        `File tidak ditemukan di Storage (mungkin sudah dihapus atau path salah): ${error.message}`
      );
    } else {
      console.warn("Gagal menghapus file dari Storage:", error.message);
    }
  }
}

exports.updateProfile = async (req, res) => {
  const uid = req.user?.uid;
  const { displayName, phoneNumber, address, removeProfilePhoto } = req.body;

  if (!uid) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan untuk memperbarui profil.",
    });
  }

  const fieldsToUpdateFirestore = {};
  const fieldsToUpdateAuth = {};
  let newPhotoURL = undefined;

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
    let oldPhotoURL = currentData.photoURL;
    const bucket = storage.bucket();

    if (req.file) {
      const fileExtension = req.file.originalname.split(".").pop();
      const fileName = `profile-images/${uid}/${uuidv4()}.${fileExtension}`;
      const fileUpload = bucket.file(fileName);

      const blobStream = fileUpload.createWriteStream({
        metadata: {
          contentType: req.file.mimetype,
        },
      });

      blobStream.on("error", (uploadError) => {
        console.error("Upload error:", uploadError);
        return handleError(res, {
          statusCode: 500,
          message: `Gagal mengunggah foto profil: ${uploadError.message}`,
        });
      });

      blobStream.on("finish", async () => {
        try {
          await fileUpload.makePublic();
          newPhotoURL = fileUpload.publicUrl();

          fieldsToUpdateFirestore.photoURL = newPhotoURL;
          fieldsToUpdateAuth.photoURL = newPhotoURL;

          if (oldPhotoURL && oldPhotoURL !== newPhotoURL) {
            await deleteOldStorageFile(oldPhotoURL, bucket);
          }

          await processProfileUpdates(
            req,
            res,
            uid,
            fieldsToUpdateFirestore,
            fieldsToUpdateAuth,
            false
          );
        } catch (publicError) {
          console.error(
            "Error making file public or getting URL:",
            publicError
          );
          await processProfileUpdates(
            req,
            res,
            uid,
            fieldsToUpdateFirestore,
            fieldsToUpdateAuth,
            true,
            true
          );
        }
      });
      blobStream.end(req.file.buffer);
      return;
    } else if (removeProfilePhoto === "true") {
      newPhotoURL = null;
      fieldsToUpdateFirestore.photoURL = null;
      fieldsToUpdateAuth.photoURL = null;
      if (oldPhotoURL) {
        await deleteOldStorageFile(oldPhotoURL, bucket);
      }
    }

    await processProfileUpdates(
      req,
      res,
      uid,
      fieldsToUpdateFirestore,
      fieldsToUpdateAuth,
      newPhotoURL === undefined
    );
  } catch (error) {
    console.error("Error in updateProfile initial phase:", error);
    return handleError(res, error, "Gagal memproses pembaruan profil.");
  }
};

// Fungsi baru untuk menghapus foto profil
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

    // Update Firestore
    await userDocRef.update({
      photoURL: null,
      updatedAt: new Date().toISOString(),
    });

    // Update Firebase Authentication
    await auth.updateUser(uid, { photoURL: null });

    // Ambil data terbaru untuk dikembalikan (opsional, tapi konsisten)
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

// Fungsi helper untuk memproses update field teks dan database
async function processProfileUpdates(
  req,
  res,
  uid,
  fieldsToUpdateFirestore,
  fieldsToUpdateAuth,
  skipPhotoSpecificAuthUpdate,
  errorOnPhotoProcessing = false
) {
  const { displayName, phoneNumber, address } = req.body;

  if (displayName !== undefined) {
    if (typeof displayName !== "string" || displayName.trim() === "") {
      return handleError(res, {
        statusCode: 400,
        message: "Nama lengkap tidak boleh kosong jika diisi.",
      });
    }
    const trimmedDisplayName = displayName.trim();
    fieldsToUpdateFirestore.displayName = trimmedDisplayName;
    if (
      skipPhotoSpecificAuthUpdate ||
      fieldsToUpdateAuth.displayName === undefined
    ) {
      fieldsToUpdateAuth.displayName = trimmedDisplayName;
    }
  }

  if (phoneNumber !== undefined) {
    if (
      phoneNumber === null ||
      (typeof phoneNumber === "string" && phoneNumber.trim() === "")
    ) {
      fieldsToUpdateFirestore.phoneNumber = null;
      if (
        skipPhotoSpecificAuthUpdate ||
        fieldsToUpdateAuth.phoneNumber === undefined
      ) {
        fieldsToUpdateAuth.phoneNumber = null;
      }
    } else if (typeof phoneNumber === "string") {
      if (!phoneNumber.startsWith("+")) {
        return handleError(res, {
          statusCode: 400,
          message:
            "Nomor telepon harus diawali dengan kode negara (misalnya +62).",
        });
      }
      fieldsToUpdateFirestore.phoneNumber = phoneNumber;
      if (
        skipPhotoSpecificAuthUpdate ||
        fieldsToUpdateAuth.phoneNumber === undefined
      ) {
        fieldsToUpdateAuth.phoneNumber = phoneNumber;
      }
    } else {
      return handleError(res, {
        statusCode: 400,
        message: "Format nomor telepon tidak valid.",
      });
    }
  }

  if (address !== undefined) {
    if (
      address === null ||
      (typeof address === "string" && address.trim() === "")
    ) {
      fieldsToUpdateFirestore.address =
        address === null ? null : address.trim() === "" ? null : address.trim();
    } else if (typeof address === "string") {
      fieldsToUpdateFirestore.address = address.trim();
    } else {
      return handleError(res, {
        statusCode: 400,
        message: "Alamat harus berupa teks atau null.",
      });
    }
  }

  if (
    Object.keys(fieldsToUpdateFirestore).length === 0 &&
    Object.keys(fieldsToUpdateAuth).length === 0
  ) {
    if (errorOnPhotoProcessing) {
      return handleError(res, {
        statusCode: 500,
        message:
          "Gagal memproses foto profil dan tidak ada data lain untuk diupdate.",
      });
    }
    if (req.file && !errorOnPhotoProcessing) {
      console.warn(
        "processProfileUpdates dipanggil tanpa data update saat req.file ada dan tidak ada error foto."
      );
      return;
    }

    if (
      !fieldsToUpdateFirestore.hasOwnProperty("photoURL") &&
      !fieldsToUpdateAuth.hasOwnProperty("photoURL")
    ) {
      return handleError(res, {
        statusCode: 400,
        message: "Tidak ada data yang dikirim untuk diperbarui.",
      });
    }
  }

  if (Object.keys(fieldsToUpdateFirestore).length > 0) {
    fieldsToUpdateFirestore.updatedAt = new Date().toISOString();
  }

  try {
    if (Object.keys(fieldsToUpdateAuth).length > 0) {
      await auth.updateUser(uid, fieldsToUpdateAuth);
    }

    if (Object.keys(fieldsToUpdateFirestore).length > 0) {
      const userDocRef = firestore.collection("users").doc(uid);
      await userDocRef.update(fieldsToUpdateFirestore);
    }

    const updatedDoc = await firestore.collection("users").doc(uid).get();
    let message = "Profil berhasil diperbarui.";
    if (errorOnPhotoProcessing) {
      message =
        "Profil berhasil diperbarui, namun terjadi masalah saat memproses foto.";
    }
    return handleSuccess(res, 200, message, updatedDoc.data());
  } catch (error) {
    console.error("Error during final profile update:", error);
    let statusCode = 500;
    let clientMessage = "Gagal memperbarui profil pengguna.";
    if (error.code) {
      switch (error.code) {
        case "auth/phone-number-already-exists":
          statusCode = 400;
          clientMessage = "Nomor telepon sudah digunakan oleh akun lain.";
          break;
        case "auth/invalid-photo-url":
          statusCode = 400;
          clientMessage = "URL foto profil tidak valid menurut Firebase.";
          break;
        case "auth/invalid-phone-number":
          statusCode = 400;
          clientMessage = "Format nomor telepon tidak valid menurut Firebase.";
          break;
        default:
          if (error.code.startsWith("auth/")) {
            statusCode = 400;
            clientMessage = `Gagal memperbarui autentikasi: ${error.message}`;
          }
      }
    }
    return handleError(
      res,
      { statusCode, message: clientMessage },
      "Gagal memperbarui profil pengguna."
    );
  }
}

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
      fcmTokens: FieldValue.arrayUnion(token),
      updatedAt: new Date().toISOString(),
    });

    return handleSuccess(res, 200, "Token FCM berhasil didaftarkan.");
  } catch (error) {
    console.error(`Error adding FCM token for user ${uid}:`, error);
    if (error.code === 5) {
      try {
        await userDocRef.set({ fcmTokens: [token] }, { merge: true });
        return handleSuccess(
          res,
          200,
          "Token FCM berhasil didaftarkan untuk pertama kali."
        );
      } catch (set_error) {
        return handleError(res, set_error, "Gagal mendaftarkan token FCM.");
      }
    }
    return handleError(res, error, "Gagal mendaftarkan token FCM.");
  }
};
