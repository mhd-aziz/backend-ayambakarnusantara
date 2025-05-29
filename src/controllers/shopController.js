const { firestore, auth, storage } = require("../config/firebaseConfig");
const { FieldValue } = require("firebase-admin/firestore");
const { handleSuccess, handleError } = require("../utils/responseHandler");
const { v4: uuidv4 } = require("uuid");

// Helper Function untuk menghapus Banner Toko dari Storage
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

// Helper Function untuk menghapus Foto Profil Pengguna dari Storage
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
      filePath = filePath.split("?")[0]; // Hapus token dan query params
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

// --- Shop Controller Functions ---

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
      description,
      shopAddress: shopAddressFromProfile,
      bannerImageURL: initialBannerImageURL,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // Tambahkan field default lainnya jika perlu, misal:
      // totalProducts: 0,
      // totalSales: 0,
      // rating: 0,
      // isOpen: true, // default status toko
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
    return handleSuccess(res, 200, "Data toko berhasil diambil.", shopData);
  } catch (error) {
    console.error("Error getting my shop:", error);
    return handleError(res, error, "Gagal mengambil data toko.");
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
      // SINKRONISASI BANNER TOKO BARU KE FOTO PROFIL PENGGUNA
      // Ini adalah perilaku yang mungkin diinginkan: jika banner toko diupdate, foto profil pengguna juga ikut.
      // Jika tidak ingin perilaku ini, hapus/komentari blok di bawah
      if (newBannerImageURL !== currentUserData.photoURL) {
        fieldsToUpdateUser.photoURL = newBannerImageURL;
        authUpdates.photoURL = newBannerImageURL;
        // Hapus foto profil pengguna lama jika ada DAN BERBEDA dari banner toko lama
        // Ini penting agar tidak menghapus file yang sama dua kali jika sebelumnya banner dan foto profil identik
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
        // Hanya hapus foto profil pengguna jika SAMA dengan banner toko yang dihapus
        // atau jika ada logika bisnis lain yang mengharuskan penghapusan foto profil juga.
        // Di sini, kita asumsikan jika banner dihapus, foto profil pengguna (jika identik) juga dihapus.
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
          // Jika banner toko memang sudah null, tapi ada permintaan removeBannerImage
          // dan pengguna masih punya photoURL, mungkin ingin disinkronkan juga (opsional)
          // await deleteUserProfilePhotoFromStorage(currentUserData.photoURL, bucket);
          // fieldsToUpdateUser.photoURL = null;
          // authUpdates.photoURL = null;
        }
      }
    }

    if (
      shopName !== undefined &&
      shopName.trim() !== currentShopData.shopName
    ) {
      const trimmedShopName = shopName.trim();
      if (trimmedShopName === "") {
        return handleError(res, {
          statusCode: 400,
          message: "Nama toko tidak boleh kosong.",
        });
      }
      fieldsToUpdateShop.shopName = trimmedShopName;
      if (trimmedShopName !== currentUserData.displayName) {
        fieldsToUpdateUser.displayName = trimmedShopName;
        authUpdates.displayName = trimmedShopName;
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
        // Pertimbangkan apakah ini error fatal atau hanya warning
        // Jika dianggap fatal, bisa return handleError di sini
      }
    }

    const updatedShopDoc = await shopDocRef.get();
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

    return handleSuccess(res, 200, message, updatedShopDoc.data());
  } catch (error) {
    console.error("Error updating shop and user profile:", error);
    return handleError(
      res,
      error,
      "Gagal memperbarui toko dan profil terkait."
    );
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

    // Hapus produk-produk yang terkait dengan toko ini
    const productsQuery = firestore
      .collection("products")
      .where("shopId", "==", shopDocRef.id); // atau shopData._id
    const productsSnapshot = await productsQuery.get();
    if (!productsSnapshot.empty) {
      console.log(
        `[deleteShop] UID: ${uid} - Menemukan ${productsSnapshot.size} produk untuk dihapus dari toko ${shopDocRef.id}.`
      );
      const productDeletionPromises = [];
      const bucket = storage.bucket(); // Definisikan bucket di sini jika produk memiliki gambar yang perlu dihapus

      productsSnapshot.forEach((doc) => {
        const productData = doc.data();
        console.log(
          `[deleteShop] UID: ${uid} - Menjadwalkan penghapusan produk ${doc.id}.`
        );
        // Jika produk memiliki gambar di storage, tambahkan logika penghapusan gambar di sini
        // Contoh: if (productData.imageUrl) { productDeletionPromises.push(deleteProductImageFromStorage(productData.imageUrl, bucket)); }
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
      // Meskipun gagal update user, toko sudah terhapus.
      // Ini mungkin perlu penanganan khusus, misalnya retry atau logging untuk admin.
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

exports.listShops = async (req, res) => {
  try {
    // Pertimbangkan pagination jika daftar toko sangat banyak
    // const { page = 1, limit = 10 } = req.query;
    // const offset = (page - 1) * limit;

    const shopsSnapshot = await firestore
      .collection("shops")
      // .orderBy("createdAt", "desc") // Contoh pengurutan
      // .limit(parseInt(limit))
      // .offset(offset)
      .get();

    if (shopsSnapshot.empty) {
      return handleSuccess(res, 200, "Belum ada toko yang terdaftar.", []);
    }

    const shopsPromises = shopsSnapshot.docs.map(async (doc) => {
      const data = doc.data();
      let ownerDisplayName = "Nama Pemilik Tidak Tersedia";
      if (data.ownerUID) {
        try {
          const userDoc = await firestore
            .collection("users")
            .doc(data.ownerUID)
            .get();
          if (userDoc.exists) {
            ownerDisplayName = userDoc.data().displayName || ownerDisplayName;
          }
        } catch (userError) {
          console.warn(
            `Gagal mengambil data pemilik untuk toko ${data._id}: ${userError.message}`
          );
        }
      }
      return {
        shopId: data._id,
        shopName: data.shopName,
        description: data.description,
        shopAddress: data.shopAddress,
        bannerImageURL: data.bannerImageURL,
        ownerName: ownerDisplayName, // Menambahkan nama pemilik untuk list
        // Tambahkan field lain yang relevan untuk daftar singkat
        // Misal: createdAt: data.createdAt
      };
    });

    const shops = await Promise.all(shopsPromises);
    // Untuk pagination, Anda mungkin juga ingin mengembalikan total toko
    // const totalShops = (await firestore.collection("shops").count().get()).data().count;

    return handleSuccess(
      res,
      200,
      "Daftar toko berhasil diambil.",
      shops /*, { currentPage: parseInt(page), totalPages: Math.ceil(totalShops / limit), totalShops } */
    );
  } catch (error) {
    console.error("Error listing shops:", error);
    return handleError(res, error, "Gagal mengambil daftar toko.");
  }
};

/**
 * @desc    Get public shop details including owner profile and products
 * @route   GET /api/shops/detail/:shopId  (atau /api/shops/:shopId tergantung preferensi routing Anda)
 * @access  Public
 */
exports.getShopDetails = async (req, res) => {
  const { shopId } = req.params;

  if (!shopId) {
    return handleError(res, {
      statusCode: 400,
      message: "Shop ID diperlukan.",
    });
  }

  try {
    // 1. Ambil data toko
    const shopDocRef = firestore.collection("shops").doc(shopId);
    const shopDoc = await shopDocRef.get();

    if (!shopDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Toko tidak ditemukan.",
      });
    }
    const shopData = shopDoc.data();

    // 2. Ambil data profil pemilik toko (hanya field publik)
    let ownerProfile = null;
    if (shopData.ownerUID) {
      const userDocRef = firestore.collection("users").doc(shopData.ownerUID);
      const userDoc = await userDocRef.get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        ownerProfile = {
          uid: userDoc.id,
          displayName: userData.displayName,
          photoURL: userData.photoURL,
          // Anda bisa menambahkan field publik lainnya dari profil pengguna jika ada
          // misalnya bio, tanggal bergabung, dll.
          // HINDARI mengekspos email atau informasi sensitif lainnya kecuali memang disengaja.
        };
      } else {
        console.warn(
          `Profil pemilik dengan UID: ${shopData.ownerUID} untuk toko ${shopId} tidak ditemukan.`
        );
      }
    }

    // 3. Ambil daftar produk dari toko tersebut
    // Pertimbangkan pagination untuk produk jika jumlahnya bisa sangat banyak
    const productsQuery = firestore
      .collection("products")
      .where("shopId", "==", shopId) // Asumsi produk memiliki field 'shopId'
      .orderBy("createdAt", "desc") // Urutkan produk, misal dari terbaru
      .limit(20); // Batasi jumlah produk yang diambil per halaman (opsional)

    const productsSnapshot = await productsQuery.get();
    const products = productsSnapshot.docs.map((doc) => {
      const productData = doc.data();
      return {
        productId: doc.id,
        name: productData.name,
        description: productData.description,
        price: productData.price,
        stock: productData.stock,
        imageUrl: productData.imageUrl, // atau array images jika ada multiple
        // Tambahkan field produk relevan lainnya
        category: productData.category,
        createdAt: productData.createdAt,
      };
    });

    const responseData = {
      shop: {
        shopId: shopData._id, // atau shopDoc.id
        shopName: shopData.shopName,
        description: shopData.description,
        shopAddress: shopData.shopAddress,
        bannerImageURL: shopData.bannerImageURL,
        createdAt: shopData.createdAt,
        updatedAt: shopData.updatedAt,
        // Tambahkan field toko lain yang relevan
        // isOpen: shopData.isOpen,
        // totalProducts: products.length, // atau dari field terpisah jika ada
      },
      owner: ownerProfile,
      products: products,
      // Anda bisa menambahkan metadata pagination untuk produk di sini jika diimplementasikan
      // productPagination: { limit: 20, hasMore: products.length === 20 }
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
