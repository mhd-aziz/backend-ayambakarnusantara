const { firestore } = require("../config/firebaseConfig");
const { handleSuccess, handleError } = require("../utils/responseHandler");

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
    const completedOrderStatuses = ["COMPLETED", "DELIVERED"];
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

    const tempProductDoc = await productRef.get();
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
    const shopRef = firestore.collection("shops").doc(productShopId);

    const newRatingRef = ratingsCollection.doc();
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

    await firestore.runTransaction(async (transaction) => {
      const productDocTransaction = await transaction.get(productRef);
      const shopDocTransaction = await transaction.get(shopRef);

      if (!productDocTransaction.exists) {
        throw {
          statusCode: 404,
          message: "Produk (dalam transaksi) tidak ditemukan.",
        };
      }
      if (!shopDocTransaction.exists) {
        throw {
          statusCode: 404,
          message: "Toko (dalam transaksi) tidak ditemukan.",
        };
      }

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

      transaction.set(newRatingRef, ratingData);
    });

    return handleSuccess(res, 201, "Rating berhasil ditambahkan.", ratingData);
  } catch (error) {
    console.error("Error adding rating:", error);
    if (error.statusCode) {
      return handleError(res, error);
    }
    return handleError(
      res,
      { statusCode: 500 },
      `Gagal menambahkan rating: ${
        error.message || "Terjadi kesalahan tidak diketahui."
      }`
    );
  }
};

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
      const ratingDocTransaction = await transaction.get(ratingRef);
      if (!ratingDocTransaction.exists) {
        throw { statusCode: 404, message: "Rating tidak ditemukan." };
      }
      const oldRatingData = ratingDocTransaction.data();

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

      const productData = productDocTransaction.data();
      const newProductSum =
        (productData.sumOfRatings || 0) - oldRatingValue + numRatingValue;
      const newProductAverage =
        productData.ratingCount > 0
          ? newProductSum / productData.ratingCount
          : 0;

      const shopData = shopDocTransaction.data();
      const newShopTotalSum =
        (shopData.totalSumOfRatings || 0) - oldRatingValue + numRatingValue;
      const newShopAverage =
        shopData.totalRatingCount > 0
          ? newShopTotalSum / shopData.totalRatingCount
          : 0;

      transaction.update(productRef, {
        sumOfRatings: newProductSum,
        averageRating: parseFloat(newProductAverage.toFixed(2)),
      });

      transaction.update(shopRef, {
        totalSumOfRatings: newShopTotalSum,
        averageShopRating: parseFloat(newShopAverage.toFixed(2)),
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
      const ratingDoc = await transaction.get(ratingRef);
      if (!ratingDoc.exists) {
        throw { statusCode: 404, message: "Rating tidak ditemukan." };
      }
      const ratingData = ratingDoc.data();

      if (ratingData.userId !== userId) {
        throw {
          statusCode: 403,
          message: "Anda tidak berhak menghapus rating ini.",
        };
      }

      const { productId, shopId, ratingValue: deletedRatingValue } = ratingData;

      if (!productId || !shopId) {
        throw {
          statusCode: 500,
          message:
            "Data rating tidak lengkap (productId atau shopId tidak ada).",
        };
      }

      const productRef = firestore.collection("products").doc(productId);
      const shopRef = firestore.collection("shops").doc(shopId);

      const [productDoc, shopDoc] = await Promise.all([
        transaction.get(productRef),
        transaction.get(shopRef),
      ]);

      let newProductData = {};
      if (productDoc.exists) {
        const productData = productDoc.data();
        const newProductSum =
          (productData.sumOfRatings || 0) - deletedRatingValue;
        const newProductCount = (productData.ratingCount || 0) - 1;
        const newProductAverage =
          newProductCount > 0 ? newProductSum / newProductCount : 0;

        newProductData = {
          sumOfRatings: Math.max(0, newProductSum),
          ratingCount: Math.max(0, newProductCount),
          averageRating: parseFloat(newProductAverage.toFixed(2)),
        };
      }

      let newShopData = {};
      if (shopDoc.exists) {
        const shopData = shopDoc.data();
        const newShopTotalSum =
          (shopData.totalSumOfRatings || 0) - deletedRatingValue;
        const newShopTotalCount = (shopData.totalRatingCount || 0) - 1;
        const newShopAverage =
          newShopTotalCount > 0 ? newShopTotalSum / newShopTotalCount : 0;

        newShopData = {
          totalSumOfRatings: Math.max(0, newShopTotalSum),
          totalRatingCount: Math.max(0, newShopTotalCount),
          averageShopRating: parseFloat(newShopAverage.toFixed(2)),
        };
      }

      if (productDoc.exists) {
        transaction.update(productRef, newProductData);
      }

      if (shopDoc.exists) {
        transaction.update(shopRef, newShopData);
      }

      transaction.delete(ratingRef);
    });

    return handleSuccess(res, 200, "Rating berhasil dihapus.");
  } catch (error) {
    console.error("Error deleting rating:", error);
    if (error.statusCode) {
      return handleError(res, error);
    }
    return handleError(res, {
      statusCode: 500,
      message: `Gagal menghapus rating: ${error.message}`,
    });
  }
};

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

    return handleSuccess(res, 200, "Rating produk berhasil diambil.", {
      productDetails: productDoc.data(),
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

exports.getRatings = async (req, res) => {
  try {
    const {
      productId,
      shopId,
      ratingValue,
      limit = "10",
      sortBy = "createdAt",
      sortOrder = "desc",
      lastVisible,
    } = req.query;

    let ratingsQuery = firestore.collection("ratings");

    // Menerapkan filter berdasarkan query params
    if (productId) {
      ratingsQuery = ratingsQuery.where("productId", "==", productId);
    }
    if (shopId) {
      ratingsQuery = ratingsQuery.where("shopId", "==", shopId);
    }
    if (ratingValue) {
      const numRating = parseInt(ratingValue);
      if (!isNaN(numRating) && numRating >= 1 && numRating <= 5) {
        ratingsQuery = ratingsQuery.where("ratingValue", "==", numRating);
      } else {
        return handleError(res, {
          statusCode: 400,
          message: "Parameter ratingValue tidak valid. Gunakan angka 1-5.",
        });
      }
    }

    // Validasi dan terapkan sorting
    const validSortOrder = sortOrder.toLowerCase() === "asc" ? "asc" : "desc";
    ratingsQuery = ratingsQuery.orderBy(sortBy, validSortOrder);

    // Menerapkan paginasi jika 'lastVisible' disediakan
    if (lastVisible) {
      const lastVisibleDoc = await firestore
        .collection("ratings")
        .doc(lastVisible)
        .get();
      if (lastVisibleDoc.exists) {
        ratingsQuery = ratingsQuery.startAfter(lastVisibleDoc);
      }
    }

    // Menerapkan limit
    const numLimit = parseInt(limit, 10);
    ratingsQuery = ratingsQuery.limit(isNaN(numLimit) ? 10 : numLimit);

    const snapshot = await ratingsQuery.get();

    if (snapshot.empty) {
      return handleSuccess(res, 200, "Tidak ada rating yang ditemukan.", {
        ratings: [],
        nextCursor: null,
      });
    }

    const ratings = snapshot.docs.map((doc) => doc.data());

    const lastDocInBatch = snapshot.docs[snapshot.docs.length - 1];
    const nextCursor = lastDocInBatch ? lastDocInBatch.id : null;

    return handleSuccess(res, 200, "Rating berhasil diambil.", {
      ratings,
      nextCursor,
    });
  } catch (error) {
    console.error("Error getting public ratings:", error);
    if (error.code === "failed-precondition") {
      return handleError(res, {
        statusCode: 400,
        message: `Query membutuhkan indeks komposit. Silakan buat indeks di Firebase Console. Pesan error asli: ${error.message}`,
      });
    }
    return handleError(
      res,
      { statusCode: 500 },
      "Gagal mengambil data rating."
    );
  }
};
