// src/controllers/ratingController.js
const { firestore } = require("../config/firebaseConfig");
const { handleSuccess, handleError } = require("../utils/responseHandler");

/**
 * @desc    Add a rating and review for a product. Updates product and shop aggregates.
 * @route   POST /api/ratings/:productId
 * @access  Private (Authenticated Users)
 */
exports.addRating = async (req, res) => {
  const userId = req.user?.uid;
  const { productId } = req.params;
  const { orderId, ratingValue, reviewText } = req.body;

  if (!userId) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }
  if (!productId || !orderId || ratingValue === undefined) {
    return handleError(res, {
      statusCode: 400,
      message: "ProductId, orderId, dan ratingValue wajib diisi.",
    });
  }

  const numRatingValue = parseInt(ratingValue);
  if (isNaN(numRatingValue) || numRatingValue < 1 || numRatingValue > 5) {
    return handleError(res, {
      statusCode: 400,
      message: "RatingValue harus berupa angka antara 1 dan 5.",
    });
  }

  const orderRef = firestore.collection("orders").doc(orderId);
  const productRef = firestore.collection("products").doc(productId);
  const ratingsCollection = firestore.collection("ratings");
  const userRef = firestore.collection("users").doc(userId);

  try {
    // Validasi di luar transaksi terlebih dahulu
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: `Pesanan dengan ID ${orderId} tidak ditemukan.`,
      });
    }
    const orderData = orderDoc.data();

    if (orderData.userId !== userId) {
      return handleError(res, {
        statusCode: 403,
        message: "Anda tidak berhak memberi rating untuk pesanan ini.",
      });
    }
    if (!orderData.items.some((item) => item.productId === productId)) {
      return handleError(res, {
        statusCode: 400,
        message: `Produk dengan ID ${productId} tidak ditemukan dalam pesanan ini.`,
      });
    }
    const completedOrderStatuses = ["COMPLETED", "DELIVERED"]; // Sesuaikan jika perlu
    if (!completedOrderStatuses.includes(orderData.orderStatus)) {
      return handleError(res, {
        statusCode: 403,
        message: `Anda hanya bisa memberi rating untuk pesanan yang sudah ${completedOrderStatuses.join(
          " atau "
        )}.`,
      });
    }

    const existingRatingQuery = await ratingsCollection
      .where("userId", "==", userId)
      .where("productId", "==", productId)
      .where("orderId", "==", orderId)
      .limit(1)
      .get();
    if (!existingRatingQuery.empty) {
      return handleError(res, {
        statusCode: 400,
        message:
          "Anda sudah memberikan rating untuk produk ini dari pesanan ini.",
      });
    }

    const userDoc = await userRef.get();
    const userDisplayName = userDoc.exists
      ? userDoc.data().displayName
      : "Pengguna Anonim";
    const userPhotoURL = userDoc.exists ? userDoc.data().photoURL : null;

    const tempProductDoc = await productRef.get(); // Baca shopId dari produk di luar transaksi jika hanya untuk validasi awal
    if (!tempProductDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Produk yang ingin dirating tidak ditemukan.",
      });
    }
    const productShopId = tempProductDoc.data().shopId;
    if (!productShopId) {
      return handleError(res, {
        statusCode: 500,
        message: "Produk tidak memiliki informasi toko (shopId).",
      });
    }
    const shopRef = firestore.collection("shops").doc(productShopId); // Definisikan shopRef di sini

    const newRatingRef = ratingsCollection.doc(); // Buat ref untuk rating baru di luar transaksi agar ID-nya bisa disimpan
    const ratingData = {
      ratingId: newRatingRef.id,
      productId: productId,
      shopId: productShopId,
      userId: userId,
      orderId: orderId,
      ratingValue: numRatingValue,
      reviewText: reviewText || null,
      userDisplayName: userDisplayName,
      userPhotoURL: userPhotoURL,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Transaksi Firestore
    await firestore.runTransaction(async (transaction) => {
      // --- TAHAP BACA (SEMUA GET DI AWAL) ---
      const productDocTransaction = await transaction.get(productRef);
      const shopDocTransaction = await transaction.get(shopRef); // Pindahkan GET shop ke sini

      if (!productDocTransaction.exists) {
        throw {
          // Error ini akan ditangkap oleh catch di luar transaksi
          statusCode: 404,
          message: "Produk (dalam transaksi) tidak ditemukan.",
        };
      }
      if (!shopDocTransaction.exists) {
        throw {
          // Error ini akan ditangkap oleh catch di luar transaksi
          statusCode: 404,
          message: "Toko (dalam transaksi) tidak ditemukan.",
        };
      }

      // --- TAHAP PERHITUNGAN & PERSIAPAN WRITE ---
      const productData = productDocTransaction.data();
      const currentProductSum = productData.sumOfRatings || 0;
      const currentProductCount = productData.ratingCount || 0;
      const newProductSum = currentProductSum + numRatingValue;
      const newProductCount = currentProductCount + 1;
      const newProductAverage = newProductSum / newProductCount;

      const shopData = shopDocTransaction.data();
      const currentShopTotalSum = shopData.totalSumOfRatings || 0;
      const currentShopTotalCount = shopData.totalRatingCount || 0;
      const newShopTotalSum = currentShopTotalSum + numRatingValue;
      const newShopTotalCount = currentShopTotalCount + 1;
      const newShopAverage = newShopTotalSum / newShopTotalCount;

      // --- TAHAP WRITE (SEMUA SET/UPDATE/DELETE DI AKHIR) ---
      transaction.update(productRef, {
        sumOfRatings: newProductSum,
        ratingCount: newProductCount,
        averageRating: parseFloat(newProductAverage.toFixed(2)),
      });

      transaction.update(shopRef, {
        totalSumOfRatings: newShopTotalSum,
        totalRatingCount: newShopTotalCount,
        averageShopRating: parseFloat(newShopAverage.toFixed(2)),
      });

      transaction.set(newRatingRef, ratingData); // Gunakan newRatingRef yang sudah didefinisikan di luar
    });

    return handleSuccess(res, 201, "Rating berhasil ditambahkan.", ratingData);
  } catch (error) {
    console.error("Error adding rating:", error);
    if (error.statusCode) {
      return handleError(res, error);
    }
    // Menggunakan error.message jika tersedia, agar lebih informatif
    return handleError(
      res,
      { statusCode: 500 },
      `Gagal menambahkan rating: ${
        error.message || "Terjadi kesalahan tidak diketahui."
      }`
    );
  }
};

/**
 * @desc    Update an existing rating. Updates product and shop aggregates.
 * @route   PUT /api/ratings/:ratingId
 * @access  Private (Owner of the rating)
 */
exports.updateRating = async (req, res) => {
  const userId = req.user?.uid;
  const { ratingId } = req.params;
  const { ratingValue, reviewText } = req.body;

  if (!userId) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }
  if (!ratingId || ratingValue === undefined) {
    return handleError(res, {
      statusCode: 400,
      message: "RatingId dan ratingValue wajib diisi.",
    });
  }

  const numRatingValue = parseInt(ratingValue);
  if (isNaN(numRatingValue) || numRatingValue < 1 || numRatingValue > 5) {
    return handleError(res, {
      statusCode: 400,
      message: "RatingValue harus berupa angka antara 1 dan 5.",
    });
  }

  const ratingRef = firestore.collection("ratings").doc(ratingId);

  try {
    await firestore.runTransaction(async (transaction) => {
      // --- TAHAP BACA (SEMUA GET DI AWAL) ---
      const ratingDocTransaction = await transaction.get(ratingRef);
      if (!ratingDocTransaction.exists) {
        throw { statusCode: 404, message: "Rating tidak ditemukan." };
      }
      const oldRatingData = ratingDocTransaction.data();

      // Otorisasi Pengguna
      if (oldRatingData.userId !== userId) {
        throw {
          statusCode: 403,
          message: "Anda tidak berhak mengubah rating ini.",
        };
      }

      const productId = oldRatingData.productId;
      const shopId = oldRatingData.shopId;
      const oldRatingValue = oldRatingData.ratingValue;

      if (!productId || !shopId) {
        throw {
          statusCode: 500,
          message:
            "Data rating tidak lengkap (productId atau shopId tidak ada).",
        };
      }

      const productRef = firestore.collection("products").doc(productId);
      const shopRef = firestore.collection("shops").doc(shopId);

      // Lanjutkan membaca product dan shop
      const productDocTransaction = await transaction.get(productRef);
      const shopDocTransaction = await transaction.get(shopRef);

      if (!productDocTransaction.exists) {
        throw {
          statusCode: 404,
          message: "Produk terkait rating tidak ditemukan.",
        };
      }
      if (!shopDocTransaction.exists) {
        throw {
          statusCode: 404,
          message: "Toko terkait rating tidak ditemukan.",
        };
      }

      // --- TAHAP PERHITUNGAN & PERSIAPAN WRITE ---
      const productData = productDocTransaction.data();
      const newProductSum =
        (productData.sumOfRatings || 0) - oldRatingValue + numRatingValue;
      // ratingCount tidak berubah saat update rating
      const newProductAverage =
        productData.ratingCount > 0
          ? newProductSum / productData.ratingCount
          : 0;

      const shopData = shopDocTransaction.data();
      const newShopTotalSum =
        (shopData.totalSumOfRatings || 0) - oldRatingValue + numRatingValue;
      // totalRatingCount tidak berubah saat update rating
      const newShopAverage =
        shopData.totalRatingCount > 0
          ? newShopTotalSum / shopData.totalRatingCount
          : 0;

      // --- TAHAP WRITE (SEMUA SET/UPDATE/DELETE DI AKHIR) ---
      transaction.update(productRef, {
        sumOfRatings: newProductSum,
        averageRating: parseFloat(newProductAverage.toFixed(2)),
        // updatedAt: new Date().toISOString(), // Opsional: update timestamp produk
      });

      transaction.update(shopRef, {
        totalSumOfRatings: newShopTotalSum,
        averageShopRating: parseFloat(newShopAverage.toFixed(2)),
        // updatedAt: new Date().toISOString(), // Opsional: update timestamp toko
      });

      transaction.update(ratingRef, {
        ratingValue: numRatingValue,
        reviewText:
          reviewText !== undefined ? reviewText : oldRatingData.reviewText,
        updatedAt: new Date().toISOString(),
      });
    });

    const updatedRatingDoc = await ratingRef.get();
    return handleSuccess(
      res,
      200,
      "Rating berhasil diperbarui.",
      updatedRatingDoc.data()
    );
  } catch (error) {
    console.error("Error updating rating:", error);
    if (error.statusCode) {
      return handleError(res, error);
    }
    return handleError(
      res,
      { statusCode: 500 },
      `Gagal memperbarui rating: ${
        error.message || "Terjadi kesalahan tidak diketahui."
      }`
    );
  }
};

/**
 * @desc    Delete an existing rating. Updates product and shop aggregates.
 * @route   DELETE /api/ratings/:ratingId
 * @access  Private (Owner of the rating)
 */
exports.deleteRating = async (req, res) => {
  const userId = req.user?.uid;
  const { ratingId } = req.params;

  if (!userId) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }
  if (!ratingId) {
    return handleError(res, {
      statusCode: 400,
      message: "RatingId wajib diisi.",
    });
  }

  const ratingRef = firestore.collection("ratings").doc(ratingId);

  try {
    await firestore.runTransaction(async (transaction) => {
      const ratingDocTransaction = await transaction.get(ratingRef);
      if (!ratingDocTransaction.exists) {
        throw { statusCode: 404, message: "Rating tidak ditemukan." };
      }
      const ratingDataToDelete = ratingDocTransaction.data();

      if (ratingDataToDelete.userId !== userId) {
        throw {
          statusCode: 403,
          message: "Anda tidak berhak menghapus rating ini.",
        };
      }

      const deletedRatingValue = ratingDataToDelete.ratingValue;
      const productId = ratingDataToDelete.productId;
      const shopId = ratingDataToDelete.shopId;

      if (!shopId) {
        throw {
          statusCode: 500,
          message:
            "Rating tidak memiliki informasi toko (shopId) untuk update agregat.",
        };
      }

      const productRef = firestore.collection("products").doc(productId);
      const shopRef = firestore.collection("shops").doc(shopId);

      // Update Product
      const productDocTransaction = await transaction.get(productRef);
      if (productDocTransaction.exists) {
        // Produk mungkin sudah dihapus, tangani dengan baik
        const productData = productDocTransaction.data();
        const newProductSum =
          (productData.sumOfRatings || 0) - deletedRatingValue;
        const newProductCount = (productData.ratingCount || 0) - 1;
        const newProductAverage =
          newProductCount > 0 ? newProductSum / newProductCount : 0;
        transaction.update(productRef, {
          sumOfRatings: newProductSum < 0 ? 0 : newProductSum, // pastikan tidak negatif
          ratingCount: newProductCount < 0 ? 0 : newProductCount, // pastikan tidak negatif
          averageRating: parseFloat(newProductAverage.toFixed(2)),
        });
      }

      // Update Shop
      const shopDocTransaction = await transaction.get(shopRef);
      if (shopDocTransaction.exists) {
        // Toko mungkin sudah dihapus
        const shopData = shopDocTransaction.data();
        const newShopTotalSum =
          (shopData.totalSumOfRatings || 0) - deletedRatingValue;
        const newShopTotalCount = (shopData.totalRatingCount || 0) - 1;
        const newShopAverage =
          newShopTotalCount > 0 ? newShopTotalSum / newShopTotalCount : 0;
        transaction.update(shopRef, {
          totalSumOfRatings: newShopTotalSum < 0 ? 0 : newShopTotalSum,
          totalRatingCount: newShopTotalCount < 0 ? 0 : newShopTotalCount,
          averageShopRating: parseFloat(newShopAverage.toFixed(2)),
        });
      }

      // Delete Rating
      transaction.delete(ratingRef);
    });

    return handleSuccess(res, 200, "Rating berhasil dihapus.");
  } catch (error) {
    console.error("Error deleting rating:", error);
    if (error.statusCode) {
      return handleError(res, error);
    }
    return handleError(
      res,
      { statusCode: 500 },
      `Gagal menghapus rating: ${error.message}`
    );
  }
};

/**
 * @desc    Get all ratings for a specific product.
 * @route   GET /api/ratings/:productId
 * @access  Public
 */
exports.getRatingsForProduct = async (req, res) => {
  const { productId } = req.params;

  if (!productId) {
    return handleError(res, {
      statusCode: 400,
      message: "ProductId wajib diisi.",
    });
  }

  try {
    const productRef = firestore.collection("products").doc(productId);
    const productDoc = await productRef.get();
    if (!productDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Produk tidak ditemukan.",
      });
    }

    const ratingsQuery = await firestore
      .collection("ratings")
      .where("productId", "==", productId)
      .orderBy("createdAt", "desc")
      .get();

    const ratings = ratingsQuery.docs.map((doc) => doc.data());
    // productDetails bisa diambil dari productDoc.data()
    // Jika Anda juga ingin menampilkan info user di tiap rating (dan tidak denormalisasi),
    // Anda perlu melakukan query tambahan di sini. Dengan denormalisasi (userDisplayName, userPhotoURL di doc rating),
    // ini sudah cukup.

    return handleSuccess(res, 200, "Rating produk berhasil diambil.", {
      productDetails: productDoc.data(), // Mengirim juga detail produk (termasuk avgRatingnya)
      ratings: ratings,
    });
  } catch (error) {
    console.error("Error getting ratings for product:", error);
    return handleError(
      res,
      { statusCode: 500 },
      "Gagal mengambil rating produk."
    );
  }
};
