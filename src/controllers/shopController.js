const { firestore, auth, storage } = require("../config/firebaseConfig");
const { FieldValue } = require("firebase-admin/firestore");
const { handleSuccess, handleError } = require("../utils/responseHandler");
const { v4: uuidv4 } = require("uuid");

async function deleteShopBannerFromStorage(bannerURL, bucket) {
  if (!bannerURL || !bucket) {
    console.log(
      "Tidak ada bannerURL atau bucket yang disediakan untuk deleteShopBannerFromStorage."
    );
    return;
  }
  try {
    const prefixPattern1 = `https://storage.googleapis.com/${bucket.name}/`;
    const prefixPattern2 = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/`;
    let filePath;

    if (bannerURL.startsWith(prefixPattern1)) {
      filePath = bannerURL.substring(prefixPattern1.length);
    } else if (bannerURL.startsWith(prefixPattern2)) {
      filePath = bannerURL.substring(prefixPattern2.length);
      filePath = filePath.split("?")[0];
    } else {
      console.warn(
        "Format URL banner lama tidak dikenali (shop banner), tidak dapat menghapus:",
        bannerURL
      );
      return;
    }
    filePath = decodeURIComponent(filePath.split("?")[0]);
    if (filePath) {
      console.log(`Mencoba menghapus file banner toko di Storage: ${filePath}`);
      await bucket.file(filePath).delete();
      console.log(
        `Berhasil menghapus file banner toko dari Storage: ${filePath}`
      );
    }
  } catch (error) {
    if (error.code === 404 || error.message.includes("No such object")) {
      console.warn(
        `File banner toko tidak ditemukan di Storage (mungkin sudah dihapus atau path salah): ${error.message}`
      );
    } else {
      console.warn(
        "Gagal menghapus file banner toko dari Storage:",
        error.message
      );
    }
  }
}

async function deleteUserProfilePhotoFromStorage(photoURL, bucket) {
  if (!photoURL || !bucket) {
    console.log(
      "Tidak ada photoURL atau bucket yang disediakan untuk deleteUserProfilePhotoFromStorage."
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
        "Format URL foto profil pengguna tidak dikenali, tidak dapat menghapus:",
        photoURL
      );
      return;
    }
    filePath = decodeURIComponent(filePath.split("?")[0]);
    if (filePath) {
      console.log(
        `Mencoba menghapus file foto profil pengguna di Storage: ${filePath}`
      );
      await bucket.file(filePath).delete();
      console.log(
        `Berhasil menghapus file foto profil pengguna dari Storage: ${filePath}`
      );
    }
  } catch (error) {
    if (error.code === 404 || error.message.includes("No such object")) {
      console.warn(
        `File foto profil pengguna tidak ditemukan di Storage (mungkin sudah dihapus atau path salah): ${error.message}`
      );
    } else {
      console.warn(
        "Gagal menghapus file foto profil pengguna dari Storage:",
        error.message
      );
    }
  }
}

exports.createShop = async (req, res) => {
  const uid = req.user?.uid;
  const { description } = req.body;

  if (!uid) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }

  if (!description) {
    return handleError(res, {
      statusCode: 400,
      message: "Deskripsi toko harus diisi.",
    });
  }

  try {
    const userDocRef = firestore.collection("users").doc(uid);
    const shopQuery = firestore
      .collection("shops")
      .where("ownerUID", "==", uid)
      .limit(1);

    const [userDocSnapshot, shopSnapshot] = await Promise.all([
      userDocRef.get(),
      shopQuery.get(),
    ]);

    if (!userDocSnapshot.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Data pengguna tidak ditemukan.",
      });
    }

    if (!shopSnapshot.empty) {
      return handleError(res, {
        statusCode: 400,
        message: "Anda sudah memiliki toko. Silakan kelola toko yang ada.",
      });
    }

    const userData = userDocSnapshot.data();

    const shopNameFromProfile =
      userData.displayName || "Toko Milik " + userData.email.split("@")[0];
    const shopAddressFromProfile = userData.address || null;
    let initialBannerImageURL = userData.photoURL || null;

    const bucket = storage.bucket();

    if (req.file) {
      const fileExtension = req.file.originalname.split(".").pop();
      const fileName = `shop-banners/${uid}/${uuidv4()}.${fileExtension}`;
      const fileUpload = bucket.file(fileName);
      const blobStream = fileUpload.createWriteStream({
        metadata: { contentType: req.file.mimetype },
      });

      await new Promise((resolve, reject) => {
        blobStream.on("error", (uploadError) => {
          console.error("Upload error banner toko:", uploadError);
          reject(uploadError);
        });
        blobStream.on("finish", async () => {
          try {
            await fileUpload.makePublic();
            initialBannerImageURL = fileUpload.publicUrl();
            resolve();
          } catch (publicError) {
            console.error(
              "Error making banner public or getting URL:",
              publicError
            );
            reject(publicError);
          }
        });
        blobStream.end(req.file.buffer);
      }).catch((uploadError) => {
        return handleError(res, {
          statusCode: 500,
          message: `Gagal mengunggah banner toko: ${uploadError.message}`,
        });
      });
      if (res.headersSent) return;
    }

    const newShopRef = firestore.collection("shops").doc();
    const newShopData = {
      _id: newShopRef.id,
      ownerUID: uid,
      shopName: shopNameFromProfile,
      shopName_lowercase: shopNameFromProfile.toLowerCase(),
      description,
      shopAddress: shopAddressFromProfile,
      bannerImageURL: initialBannerImageURL,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await newShopRef.set(newShopData);
    await userDocRef.update({ role: "seller", shopId: newShopRef.id });

    return handleSuccess(
      res,
      201,
      "Toko berhasil dibuat berdasarkan profil Anda.",
      newShopData
    );
  } catch (error) {
    console.error("Error creating shop:", error);
    return handleError(res, error, "Gagal membuat toko.");
  }
};

exports.updateShop = async (req, res) => {
  const uid = req.user?.uid;
  const { shopName, description, shopAddress, removeBannerImage } = req.body;

  if (!uid) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }

  try {
    const userDocRef = firestore.collection("users").doc(uid);
    const userSnapshot = await userDocRef.get();

    if (!userSnapshot.exists || userSnapshot.data().role !== "seller") {
      return handleError(res, {
        statusCode: 403,
        message: "Hanya seller yang dapat memperbarui toko.",
      });
    }

    const shopQuery = firestore
      .collection("shops")
      .where("ownerUID", "==", uid)
      .limit(1);
    const shopSnapshot = await shopQuery.get();

    if (shopSnapshot.empty) {
      return handleError(res, {
        statusCode: 404,
        message: "Toko tidak ditemukan untuk diperbarui.",
      });
    }

    const shopDocRef = shopSnapshot.docs[0].ref;
    const currentShopData = shopSnapshot.docs[0].data();
    const currentUserData = userSnapshot.data();

    const fieldsToUpdateShop = {};
    const fieldsToUpdateUser = {};
    const authUpdates = {};

    const bucket = storage.bucket();

    if (req.file) {
      if (currentShopData.bannerImageURL) {
        await deleteShopBannerFromStorage(
          currentShopData.bannerImageURL,
          bucket
        );
      }
      const fileExtension = req.file.originalname.split(".").pop();
      const fileName = `shop-banners/${uid}/${uuidv4()}.${fileExtension}`;
      const fileUpload = bucket.file(fileName);
      const blobStream = fileUpload.createWriteStream({
        metadata: { contentType: req.file.mimetype },
      });

      let newBannerImageURL;
      await new Promise((resolve, reject) => {
        blobStream.on("error", reject);
        blobStream.on("finish", async () => {
          try {
            await fileUpload.makePublic();
            newBannerImageURL = fileUpload.publicUrl();
            resolve();
          } catch (publicError) {
            reject(publicError);
          }
        });
        blobStream.end(req.file.buffer);
      }).catch((uploadError) => {
        console.error("Upload error banner toko:", uploadError);
        return handleError(res, {
          statusCode: 500,
          message: `Gagal mengunggah banner toko baru: ${uploadError.message}`,
        });
      });
      if (res.headersSent) return;
      fieldsToUpdateShop.bannerImageURL = newBannerImageURL;
      if (newBannerImageURL !== currentUserData.photoURL) {
        fieldsToUpdateUser.photoURL = newBannerImageURL;
        authUpdates.photoURL = newBannerImageURL;
        if (
          currentUserData.photoURL &&
          currentUserData.photoURL !== currentShopData.bannerImageURL
        ) {
          await deleteUserProfilePhotoFromStorage(
            currentUserData.photoURL,
            bucket
          );
        }
      }
    } else if (removeBannerImage === "true" || removeBannerImage === true) {
      if (currentShopData.bannerImageURL) {
        await deleteShopBannerFromStorage(
          currentShopData.bannerImageURL,
          bucket
        );
      }
      fieldsToUpdateShop.bannerImageURL = null;
      if (currentUserData.photoURL) {
        if (currentUserData.photoURL === currentShopData.bannerImageURL) {
          await deleteUserProfilePhotoFromStorage(
            currentUserData.photoURL,
            bucket
          );
          fieldsToUpdateUser.photoURL = null;
          authUpdates.photoURL = null;
        } else if (
          currentUserData.photoURL &&
          !currentShopData.bannerImageURL
        ) {
        }
      }
    }

    if (shopName !== undefined) {
      const trimmedShopName = shopName.trim();
      if (trimmedShopName === "") {
        return handleError(res, {
          statusCode: 400,
          message: "Nama toko tidak boleh kosong.",
        });
      }
      if (trimmedShopName !== currentShopData.shopName) {
        fieldsToUpdateShop.shopName = trimmedShopName;
        fieldsToUpdateShop.shopName_lowercase = trimmedShopName.toLowerCase();

        if (trimmedShopName !== currentUserData.displayName) {
          fieldsToUpdateUser.displayName = trimmedShopName;
          authUpdates.displayName = trimmedShopName;
        }
      }
    }

    if (
      description !== undefined &&
      description.trim() !== currentShopData.description
    ) {
      fieldsToUpdateShop.description = description.trim();
    }

    if (
      shopAddress !== undefined &&
      shopAddress !== currentShopData.shopAddress
    ) {
      fieldsToUpdateShop.shopAddress = shopAddress;
      if (shopAddress !== currentUserData.address) {
        fieldsToUpdateUser.address = shopAddress;
      }
    }
    if (
      Object.keys(fieldsToUpdateShop).length === 0 &&
      Object.keys(fieldsToUpdateUser).length === 0 &&
      Object.keys(authUpdates).length === 0
    ) {
      return handleError(res, {
        statusCode: 400,
        message:
          "Tidak ada data yang dikirim untuk diperbarui atau data sama dengan yang sekarang.",
      });
    }

    if (Object.keys(fieldsToUpdateShop).length > 0) {
      fieldsToUpdateShop.updatedAt = new Date().toISOString();
    }
    if (Object.keys(fieldsToUpdateUser).length > 0) {
      fieldsToUpdateUser.updatedAt = new Date().toISOString();
    }

    const batch = firestore.batch();
    if (Object.keys(fieldsToUpdateShop).length > 0) {
      batch.update(shopDocRef, fieldsToUpdateShop);
    }
    if (Object.keys(fieldsToUpdateUser).length > 0) {
      batch.update(userDocRef, fieldsToUpdateUser);
    }

    await batch.commit();

    if (Object.keys(authUpdates).length > 0) {
      try {
        await auth.updateUser(uid, authUpdates);
      } catch (authError) {
        console.warn(
          "Gagal memperbarui data di Firebase Auth (sebagian atau seluruhnya):",
          authError
        );
      }
    }

    const updatedShopDoc = await shopDocRef.get();
    const formattedShop = {
      shopId: updatedShopDoc.data()._id,
      shopName: updatedShopDoc.data().shopName,
      description: updatedShopDoc.data().description,
      shopAddress: updatedShopDoc.data().shopAddress,
      bannerImageURL: updatedShopDoc.data().bannerImageURL,
      createdAt: updatedShopDoc.data().createdAt,
      updatedAt: updatedShopDoc.data().updatedAt,
      shopName_lowercase: updatedShopDoc.data().shopName_lowercase,
    };

    let message = "Toko berhasil diperbarui.";
    if (
      Object.keys(fieldsToUpdateUser).length > 0 ||
      Object.keys(authUpdates).length > 0
    ) {
      message = "Toko dan profil pengguna terkait berhasil diperbarui.";
    }
    if (
      removeBannerImage === "true" &&
      authUpdates.photoURL === null &&
      fieldsToUpdateUser.photoURL === null
    ) {
      message +=
        " Banner toko dan foto profil pengguna (jika sebelumnya sinkron) telah dihapus.";
    }

    return handleSuccess(res, 200, message, formattedShop);
  } catch (error) {
    console.error("Error updating shop and user profile:", error);
    return handleError(
      res,
      error,
      "Gagal memperbarui toko dan profil terkait."
    );
  }
};

exports.getMyShop = async (req, res) => {
  const uid = req.user?.uid;

  if (!uid) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }

  try {
    const userDoc = await firestore.collection("users").doc(uid).get();
    if (!userDoc.exists || userDoc.data().role !== "seller") {
      return handleError(res, {
        statusCode: 403,
        message: "Akses ditolak. Hanya untuk seller.",
      });
    }

    const shopQuery = firestore
      .collection("shops")
      .where("ownerUID", "==", uid)
      .limit(1);
    const shopSnapshot = await shopQuery.get();

    if (shopSnapshot.empty) {
      return handleError(res, {
        statusCode: 404,
        message: "Toko tidak ditemukan. Anda mungkin belum membuat toko.",
      });
    }

    const shopData = shopSnapshot.docs[0].data();
    const formattedShop = {
      shopId: shopData._id,
      shopName: shopData.shopName,
      description: shopData.description,
      shopAddress: shopData.shopAddress,
      bannerImageURL: shopData.bannerImageURL,
      createdAt: shopData.createdAt,
      updatedAt: shopData.updatedAt,
      shopName_lowercase: shopData.shopName_lowercase,
      ownerUID: shopData.ownerUID,
    };
    return handleSuccess(
      res,
      200,
      "Data toko berhasil diambil.",
      formattedShop
    );
  } catch (error) {
    console.error("Error getting my shop:", error);
    return handleError(res, error, "Gagal mengambil data toko.");
  }
};

exports.deleteShop = async (req, res) => {
  const uid = req.user?.uid;

  if (!uid) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }

  try {
    console.log(`[deleteShop] UID: ${uid} - Memulai proses penghapusan toko.`);
    const userSnapshot = await firestore.collection("users").doc(uid).get();
    if (!userSnapshot.exists || userSnapshot.data().role !== "seller") {
      console.log(
        `[deleteShop] UID: ${uid} - Pengguna bukan seller atau tidak ditemukan.`
      );
      return handleError(res, {
        statusCode: 403,
        message: "Hanya seller yang dapat menghapus toko.",
      });
    }
    console.log(
      `[deleteShop] UID: ${uid} - Pengguna terverifikasi sebagai seller. Mencari toko...`
    );

    const shopQuery = firestore
      .collection("shops")
      .where("ownerUID", "==", uid)
      .limit(1);
    const shopSnapshot = await shopQuery.get();

    if (shopSnapshot.empty) {
      console.log(
        `[deleteShop] UID: ${uid} - Tidak ada toko yang ditemukan untuk pengguna ini.`
      );
      return handleError(res, {
        statusCode: 404,
        message: "Toko tidak ditemukan untuk dihapus.",
      });
    }
    console.log(
      `[deleteShop] UID: ${uid} - Toko ditemukan. Jumlah dokumen: ${shopSnapshot.docs.length}`
    );

    const shopDocumentInstance = shopSnapshot.docs[0];
    if (!shopDocumentInstance) {
      console.error(
        `[deleteShop] UID: ${uid} - shopSnapshot.docs[0] adalah null atau undefined.`
      );
      return handleError(res, {
        statusCode: 500,
        message: "Kesalahan internal server (dokumen toko tidak valid).",
      });
    }

    const shopDocRef = shopDocumentInstance.ref;
    if (!shopDocRef || typeof shopDocRef.delete !== "function") {
      console.error(
        `[deleteShop] UID: ${uid} - shopDocRef tidak valid atau tidak memiliki metode .delete(). Tipe shopDocRef: ${typeof shopDocRef}`,
        shopDocRef
      );
      return handleError(res, {
        statusCode: 500,
        message: "Referensi dokumen toko tidak valid atau korup.",
      });
    }

    const shopData = shopDocumentInstance.data();
    if (!shopData) {
      console.error(
        `[deleteShop] UID: ${uid} - Gagal mendapatkan data dari shopDocumentInstance.`
      );
      return handleError(res, {
        statusCode: 500,
        message: "Kesalahan internal server (gagal membaca data toko).",
      });
    }

    const productsQuery = firestore
      .collection("products")
      .where("shopId", "==", shopDocRef.id);
    const productsSnapshot = await productsQuery.get();
    if (!productsSnapshot.empty) {
      console.log(
        `[deleteShop] UID: ${uid} - Menemukan ${productsSnapshot.size} produk untuk dihapus dari toko ${shopDocRef.id}.`
      );
      const productDeletionPromises = [];
      const bucket = storage.bucket();

      productsSnapshot.forEach((doc) => {
        const productData = doc.data();
        console.log(
          `[deleteShop] UID: ${uid} - Menjadwalkan penghapusan produk ${doc.id}.`
        );
        productDeletionPromises.push(doc.ref.delete());
      });
      await Promise.all(productDeletionPromises);
      console.log(
        `[deleteShop] UID: ${uid} - Semua produk dari toko ${shopDocRef.id} berhasil dihapus.`
      );
    } else {
      console.log(
        `[deleteShop] UID: ${uid} - Tidak ada produk yang ditemukan untuk toko ${shopDocRef.id}.`
      );
    }

    if (shopData.bannerImageURL) {
      console.log(
        `[deleteShop] UID: ${uid} - Menghapus banner toko: ${shopData.bannerImageURL}`
      );
      const bucket = storage.bucket();
      if (!bucket || typeof bucket.file !== "function") {
        console.error(
          "[deleteShop] UID: " +
            uid +
            " - Firebase Storage bucket tidak terkonfigurasi dengan benar."
        );
      } else {
        await deleteShopBannerFromStorage(shopData.bannerImageURL, bucket);
        console.log(
          `[deleteShop] UID: ${uid} - Proses penghapusan banner toko selesai.`
        );
      }
    }

    console.log(
      `[deleteShop] UID: ${uid} - Menghapus dokumen toko: ${shopDocRef.path}`
    );
    await shopDocRef.delete();
    console.log(
      `[deleteShop] UID: ${uid} - Dokumen toko berhasil dihapus. Memperbarui peran pengguna di Firestore...`
    );

    const userDocRefToUpdate = firestore.collection("users").doc(uid);

    const userDataToUpdate = {
      role: "customer",
      shopId: FieldValue.delete(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await userDocRefToUpdate.update(userDataToUpdate);
      console.log(
        `[deleteShop] UID: ${uid} - Peran pengguna di Firestore BERHASIL diperbarui ke 'customer'.`
      );
    } catch (userUpdateDbError) {
      console.error(
        `[deleteShop] UID: ${uid} - GAGAL memperbarui peran pengguna di Firestore:`,
        userUpdateDbError
      );
      return handleError(
        res,
        userUpdateDbError,
        "Toko dan produk berhasil dihapus, namun terjadi kesalahan saat memperbarui status akhir pengguna."
      );
    }

    return handleSuccess(
      res,
      200,
      "Toko dan semua produk terkait berhasil dihapus. Status Anda telah diubah kembali menjadi customer."
    );
  } catch (error) {
    console.error(
      `[deleteShop] UID: ${uid} - Terjadi error umum selama proses deleteShop:`,
      error
    );
    return handleError(
      res,
      error,
      "Gagal menghapus toko karena kesalahan tak terduga."
    );
  }
};

function formatShopObject(shopData, ownerName) {
  if (!shopData) return null;
  return {
    shopId: shopData._id,
    shopName: shopData.shopName,
    description: shopData.description,
    shopAddress: shopData.shopAddress,
    bannerImageURL: shopData.bannerImageURL,
    createdAt: shopData.createdAt,
    updatedAt: shopData.updatedAt,
    ownerName: ownerName || "Nama Pemilik Tidak Tersedia",
    ownerUID: shopData.ownerUID,
  };
}

exports.listShops = async (req, res) => {
  try {
    const {
      searchById,
      searchByShopName,
      sortBy,
      order = "asc",
      page = 1,
      limit = 10,
      shopNameCaseInsensitive = "true",
    } = req.query;

    let shopsQuery = firestore.collection("shops");
    let isSearchingById = false;
    let allShopsData = [];

    const isShopNameSearchCaseInsensitive = shopNameCaseInsensitive === "true";

    if (searchById) {
      shopsQuery = shopsQuery.where("_id", "==", searchById);
      isSearchingById = true;
    } else {
      if (
        sortBy &&
        sortBy !== "shopName" &&
        sortBy !== "shopName_lowercase" &&
        sortBy !== "createdAt"
      ) {
        shopsQuery = shopsQuery.orderBy(sortBy, order);
      } else if (!sortBy) {
        shopsQuery = shopsQuery.orderBy("createdAt", "desc");
      }
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    let formattedShops = [];
    let totalShops = 0;

    if (isSearchingById) {
      const shopSnapshot = await shopsQuery.get();
      if (!shopSnapshot.empty) {
        const shopData = shopSnapshot.docs[0].data();
        let ownerName = "Nama Pemilik Tidak Tersedia";
        if (shopData.ownerUID) {
          try {
            const userDoc = await firestore
              .collection("users")
              .doc(shopData.ownerUID)
              .get();
            if (userDoc.exists) {
              ownerName = userDoc.data().displayName || ownerName;
            }
          } catch (userError) {
            console.warn(
              `Gagal mengambil data pemilik untuk toko ${shopData._id}: ${userError.message}`
            );
          }
        }
        formattedShops.push(formatShopObject(shopData, ownerName));
        totalShops = 1;
      }
    } else {
      const allMatchingDocsSnapshot = await shopsQuery.get();
      allShopsData = allMatchingDocsSnapshot.docs.map((doc) => doc.data());

      if (searchByShopName) {
        const searchTerm = isShopNameSearchCaseInsensitive
          ? searchByShopName.toLowerCase()
          : searchByShopName;
        allShopsData = allShopsData.filter((shop) => {
          if (!shop.shopName) return false;
          const shopNameForFilter = isShopNameSearchCaseInsensitive
            ? shop.shopName_lowercase || shop.shopName.toLowerCase()
            : shop.shopName;
          return shopNameForFilter.includes(searchTerm);
        });
      }

      if (sortBy) {
        allShopsData.sort((a, b) => {
          let valA, valB;
          if (sortBy === "shopName" || sortBy === "shopName_lowercase") {
            valA = isShopNameSearchCaseInsensitive
              ? a.shopName_lowercase || (a.shopName || "").toLowerCase()
              : a.shopName || "";
            valB = isShopNameSearchCaseInsensitive
              ? b.shopName_lowercase || (b.shopName || "").toLowerCase()
              : b.shopName || "";
          } else {
            valA = a[sortBy];
            valB = b[sortBy];
          }

          if (valA === undefined || valA === null) valA = "";
          if (valB === undefined || valB === null) valB = "";

          if (typeof valA === "string" && typeof valB === "string") {
            return order === "asc"
              ? valA.localeCompare(valB)
              : valB.localeCompare(valA);
          } else {
            if (valA < valB) return order === "asc" ? -1 : 1;
            if (valA > valB) return order === "asc" ? 1 : -1;
            return 0;
          }
        });
      }

      totalShops = allShopsData.length;
      const paginatedShopsData = allShopsData.slice(offset, offset + limitNum);

      const shopsWithOwnersPromises = paginatedShopsData.map(
        async (shopData) => {
          let ownerName = "Nama Pemilik Tidak Tersedia";
          if (shopData.ownerUID) {
            try {
              const userDoc = await firestore
                .collection("users")
                .doc(shopData.ownerUID)
                .get();
              if (userDoc.exists) {
                ownerName = userDoc.data().displayName || ownerName;
              }
            } catch (userError) {
              console.warn(
                `Gagal mengambil data pemilik untuk toko ${shopData._id}: ${userError.message}`
              );
            }
          }
          return formatShopObject(shopData, ownerName);
        }
      );
      formattedShops = await Promise.all(shopsWithOwnersPromises);
    }

    const totalPages = Math.ceil(totalShops / limitNum);

    if (formattedShops.length === 0) {
      let message = "Belum ada toko yang sesuai dengan kriteria pencarian.";
      if (isSearchingById) {
        message = "Toko dengan ID yang dicari tidak ditemukan.";
      }
      return handleSuccess(res, 200, message, {
        shops: [],
        currentPage: pageNum,
        totalPages: 0,
        totalShops: 0,
      });
    }

    return handleSuccess(res, 200, "Daftar toko berhasil diambil.", {
      shops: formattedShops,
      currentPage: pageNum,
      totalPages,
      totalShops,
    });
  } catch (error) {
    console.error("Error listing shops:", error);
    if (
      error.message &&
      error.message.includes("INVALID_ARGUMENT") &&
      (error.message.includes("orderBy") ||
        error.message.includes("inequality"))
    ) {
      return handleError(
        res,
        {
          statusCode: 400,
          message: `Kombinasi filter dan urutan tidak valid di Firestore. Error: ${error.message}`,
        },
        "Gagal mengambil daftar toko."
      );
    }
    return handleError(res, error, "Gagal mengambil daftar toko.");
  }
};

exports.getShopDetails = async (req, res) => {
  const { shopId } = req.params;

  if (!shopId) {
    return handleError(res, {
      statusCode: 400,
      message: "Shop ID diperlukan.",
    });
  }

  try {
    const shopDocRef = firestore.collection("shops").doc(shopId);
    const shopDoc = await shopDocRef.get();

    if (!shopDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Toko tidak ditemukan.",
      });
    }
    const shopData = shopDoc.data();

    let ownerProfile = null;
    let ownerName = "Nama Pemilik Tidak Tersedia";
    if (shopData.ownerUID) {
      const userDocRef = firestore.collection("users").doc(shopData.ownerUID);
      const userDoc = await userDocRef.get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        ownerName = userData.displayName || ownerName;
        ownerProfile = {
          uid: userDoc.id,
          displayName: userData.displayName,
          photoURL: userData.photoURL,
        };
      } else {
        console.warn(
          `Profil pemilik dengan UID: ${shopData.ownerUID} untuk toko ${shopId} tidak ditemukan.`
        );
      }
    }

    const productsQuery = firestore
      .collection("products")
      .where("shopId", "==", shopId)
      .orderBy("createdAt", "desc")
      .limit(20);

    const productsSnapshot = await productsQuery.get();
    const products = productsSnapshot.docs.map((doc) => {
      const productData = doc.data();
      return {
        productId: doc.id,
        name: productData.name,
        description: productData.description,
        price: productData.price,
        stock: productData.stock,
        imageUrl: productData.productImageURL,
        category: productData.category,
        createdAt: productData.createdAt,
      };
    });

    const formattedShopData = formatShopObject(shopData, ownerName);

    const responseData = {
      shop: formattedShopData,
      owner: ownerProfile,
      products: products,
    };

    return handleSuccess(
      res,
      200,
      "Detail toko berhasil diambil.",
      responseData
    );
  } catch (error) {
    console.error(`Error getting shop details for shopId ${shopId}:`, error);
    return handleError(res, error, "Gagal mengambil detail toko.");
  }
};

exports.getShopStatistics = async (req, res) => {
  const uid = req.user?.uid;
  const { period = "all_time" } = req.query;

  if (!uid) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }

  try {
    const userDoc = await firestore.collection("users").doc(uid).get();
    if (!userDoc.exists || userDoc.data().role !== "seller") {
      return handleError(res, {
        statusCode: 403,
        message: "Hanya seller yang dapat mengakses statistik toko.",
      });
    }

    const shopId = userDoc.data().shopId;
    if (!shopId) {
      return handleError(res, {
        statusCode: 404,
        message: "Toko tidak ditemukan untuk seller ini.",
      });
    }

    const productsSnapshot = await firestore
      .collection("products")
      .where("shopId", "==", shopId)
      .get();
    const totalProducts = productsSnapshot.size;

    let ordersQuery = firestore.collection("orders");

    const now = new Date();
    let startDate;

    if (period === "daily") {
      startDate = new Date(now.setHours(0, 0, 0, 0));
    } else if (period === "weekly") {
      startDate = new Date(now.setDate(now.getDate() - 7));
    } else if (period === "monthly") {
      startDate = new Date(now.setDate(now.getDate() - 30));
    }

    if (startDate) {
      ordersQuery = ordersQuery.where(
        "createdAt",
        ">=",
        startDate.toISOString()
      );
    }

    const ordersSnapshot = await ordersQuery.get();
    let totalRevenue = 0;
    let newOrdersCount = 0;
    let completedOrdersCount = 0;

    ordersSnapshot.forEach((doc) => {
      const orderData = doc.data();
      if (
        orderData.items &&
        orderData.items.some((item) => item.shopId === shopId)
      ) {
        newOrdersCount++; 

        if (orderData.orderStatus === "COMPLETED") {
          completedOrdersCount++;
          totalRevenue += orderData.totalPrice;
        }
      }
    });

    const statistics = {
      period,
      totalProducts,
      newOrders: {
        count: newOrdersCount,
        description: `Total pesanan yang masuk dalam periode ini.`,
      },
      completedOrders: {
        count: completedOrdersCount,
        description: `Pesanan yang telah selesai dalam periode ini.`,
      },
      revenue: {
        amount: totalRevenue,
        formatted: new Intl.NumberFormat("id-ID", {
          style: "currency",
          currency: "IDR",
        }).format(totalRevenue),
        description: "Total pendapatan dari pesanan yang telah selesai.",
      },
    };

    return handleSuccess(
      res,
      200,
      "Statistik toko berhasil diambil.",
      statistics
    );
  } catch (error) {
    console.error("Error getting shop statistics:", error);
    return handleError(res, error, "Gagal mengambil statistik toko.");
  }
};
