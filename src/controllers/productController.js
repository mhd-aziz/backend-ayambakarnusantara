// src/controllers/productController.js
const { firestore, storage } = require("../config/firebaseConfig");
const { FieldValue } = require("firebase-admin/firestore");
const { handleSuccess, handleError } = require("../utils/responseHandler");
const { v4: uuidv4 } = require("uuid");

// Helper Function untuk menghapus Gambar Produk dari Storage
async function deleteProductImageFromStorage(imageURL, bucket) {
  if (!imageURL || !bucket) {
    console.log(
      "Tidak ada imageURL atau bucket yang disediakan untuk deleteProductImageFromStorage."
    );
    return;
  }
  try {
    const prefixPattern1 = `https://storage.googleapis.com/${bucket.name}/`;
    const prefixPattern2 = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/`;
    let filePath;

    if (imageURL.startsWith(prefixPattern1)) {
      filePath = imageURL.substring(prefixPattern1.length);
    } else if (imageURL.startsWith(prefixPattern2)) {
      filePath = imageURL.substring(prefixPattern2.length);
      filePath = filePath.split("?")[0]; // Hapus token dan query params
    } else {
      console.warn(
        "Format URL gambar produk tidak dikenali, tidak dapat menghapus:",
        imageURL
      );
      return;
    }
    filePath = decodeURIComponent(filePath.split("?")[0]);
    if (filePath) {
      console.log(
        `Mencoba menghapus file gambar produk di Storage: ${filePath}`
      );
      await bucket.file(filePath).delete();
      console.log(
        `Berhasil menghapus file gambar produk dari Storage: ${filePath}`
      );
    }
  } catch (error) {
    if (error.code === 404 || error.message.includes("No such object")) {
      console.warn(
        `File gambar produk tidak ditemukan di Storage (mungkin sudah dihapus atau path salah): ${error.message}`
      );
    } else {
      console.warn(
        "Gagal menghapus file gambar produk dari Storage:",
        error.message
      );
    }
  }
}

// 1. Membuat Produk Baru
exports.createProduct = async (req, res) => {
  const uid = req.user?.uid;
  const { name, description, price, stock, category } = req.body;

  if (!uid) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }

  if (!name || !description || !price || stock === undefined || !category) {
    return handleError(res, {
      statusCode: 400,
      message:
        "Semua field wajib diisi: nama, deskripsi, harga, stok, dan kategori.",
    });
  }

  if (isNaN(parseFloat(price)) || parseFloat(price) <= 0) {
    return handleError(res, {
      statusCode: 400,
      message: "Harga harus berupa angka positif.",
    });
  }

  if (isNaN(parseInt(stock)) || parseInt(stock) < 0) {
    return handleError(res, {
      statusCode: 400,
      message: "Stok harus berupa angka non-negatif.",
    });
  }

  try {
    const userDocRef = firestore.collection("users").doc(uid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists || userDoc.data().role !== "seller") {
      return handleError(res, {
        statusCode: 403,
        message: "Hanya seller yang dapat membuat produk.",
      });
    }

    const shopId = userDoc.data().shopId;
    if (!shopId) {
      return handleError(res, {
        statusCode: 400,
        message:
          "Seller tidak memiliki toko terkait. Silakan buat toko terlebih dahulu.",
      });
    }

    const shopDocRef = firestore.collection("shops").doc(shopId);
    const shopDoc = await shopDocRef.get();
    if (!shopDoc.exists || shopDoc.data().ownerUID !== uid) {
      return handleError(res, {
        statusCode: 403,
        message:
          "Anda tidak memiliki akses ke toko ini atau toko tidak ditemukan.",
      });
    }

    let productImageURL = null;
    const bucket = storage.bucket();

    if (req.file) {
      const fileExtension = req.file.originalname.split(".").pop();
      const fileName = `product-images/${shopId}/${uuidv4()}.${fileExtension}`;
      const fileUpload = bucket.file(fileName);
      const blobStream = fileUpload.createWriteStream({
        metadata: { contentType: req.file.mimetype },
      });

      await new Promise((resolve, reject) => {
        blobStream.on("error", (uploadError) => {
          console.error("Upload error gambar produk:", uploadError);
          reject(uploadError);
        });
        blobStream.on("finish", async () => {
          try {
            await fileUpload.makePublic();
            productImageURL = fileUpload.publicUrl();
            resolve();
          } catch (publicError) {
            console.error(
              "Error making product image public or getting URL:",
              publicError
            );
            reject(publicError);
          }
        });
        blobStream.end(req.file.buffer);
      }).catch((uploadError) => {
        return handleError(res, {
          statusCode: 500,
          message: `Gagal mengunggah gambar produk: ${uploadError.message}`,
        });
      });
      if (res.headersSent) return;
    }

    const newProductRef = firestore.collection("products").doc();
    const newProductData = {
      _id: newProductRef.id,
      shopId: shopId,
      ownerUID: uid,
      name,
      description,
      price: parseFloat(price),
      stock: parseInt(stock),
      category,
      productImageURL,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // Tambahan fields jika perlu: ratings, soldCount, etc.
    };

    await newProductRef.set(newProductData);
    return handleSuccess(
      res,
      201,
      "Produk berhasil ditambahkan.",
      newProductData
    );
  } catch (error) {
    console.error("Error creating product:", error);
    return handleError(res, error, "Gagal menambahkan produk.");
  }
};

// 2. Mendapatkan Semua Produk (Publik)
exports.getAllProducts = async (req, res) => {
  try {
    // Tambahkan query parameter untuk filter, sort, pagination jika diperlukan
    const { category, sortBy, order = "asc", page = 1, limit = 10 } = req.query;
    let productsQuery = firestore.collection("products");

    if (category) {
      productsQuery = productsQuery.where("category", "==", category);
    }

    if (sortBy) {
      productsQuery = productsQuery.orderBy(sortBy, order);
    } else {
      productsQuery = productsQuery.orderBy("createdAt", "desc"); // Default sort
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const snapshot = await productsQuery.limit(limitNum).offset(offset).get();

    if (snapshot.empty) {
      return handleSuccess(res, 200, "Belum ada produk yang tersedia.", []);
    }

    const products = snapshot.docs.map((doc) => doc.data());

    // Untuk informasi total produk (opsional, untuk pagination di client)
    const totalProductsSnapshot = await productsQuery.get(); // Ini bisa jadi query yang sama tanpa limit/offset untuk count yang akurat, atau Anda bisa menyimpannya di collection lain
    const totalProducts = totalProductsSnapshot.size;

    return handleSuccess(res, 200, "Daftar produk berhasil diambil.", {
      products,
      currentPage: pageNum,
      totalPages: Math.ceil(totalProducts / limitNum),
      totalProducts,
    });
  } catch (error) {
    console.error("Error getting all products:", error);
    return handleError(res, error, "Gagal mengambil daftar produk.");
  }
};

// 3. Mendapatkan Produk Milik Seller (Private)
exports.getMyProducts = async (req, res) => {
  const uid = req.user?.uid;

  if (!uid) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }

  try {
    const userDoc = await firestore.collection("users").doc(uid).get();
    if (!userDoc.exists || !userDoc.data().shopId) {
      return handleError(res, {
        statusCode: 404,
        message: "Toko seller tidak ditemukan.",
      });
    }
    const shopId = userDoc.data().shopId;

    const productsQuery = firestore
      .collection("products")
      .where("shopId", "==", shopId)
      .orderBy("createdAt", "desc"); // Urutkan berdasarkan terbaru

    const snapshot = await productsQuery.get();

    if (snapshot.empty) {
      return handleSuccess(
        res,
        200,
        "Anda belum memiliki produk di toko Anda.",
        []
      );
    }

    const products = snapshot.docs.map((doc) => doc.data());
    return handleSuccess(
      res,
      200,
      "Daftar produk Anda berhasil diambil.",
      products
    );
  } catch (error) {
    console.error("Error getting my products:", error);
    return handleError(res, error, "Gagal mengambil daftar produk Anda.");
  }
};

// 4. Mendapatkan Detail Produk Berdasarkan ID (Publik)
exports.getProductById = async (req, res) => {
  const { productId } = req.params;

  if (!productId) {
    return handleError(res, {
      statusCode: 400,
      message: "Product ID diperlukan.",
    });
  }

  try {
    const productDocRef = firestore.collection("products").doc(productId);
    const doc = await productDocRef.get();

    if (!doc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Produk tidak ditemukan.",
      });
    }

    return handleSuccess(
      res,
      200,
      "Detail produk berhasil diambil.",
      doc.data()
    );
  } catch (error) {
    console.error("Error getting product by ID:", error);
    return handleError(res, error, "Gagal mengambil detail produk.");
  }
};

// 5. Memperbarui Produk (Hanya Seller Pemilik Produk)
exports.updateProduct = async (req, res) => {
  const uid = req.user?.uid;
  const { productId } = req.params;
  const { name, description, price, stock, category, removeProductImage } =
    req.body;

  if (!uid) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }

  if (!productId) {
    return handleError(res, {
      statusCode: 400,
      message: "Product ID diperlukan.",
    });
  }

  try {
    const productDocRef = firestore.collection("products").doc(productId);
    const productDoc = await productDocRef.get();

    if (!productDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Produk tidak ditemukan untuk diperbarui.",
      });
    }

    const currentProductData = productDoc.data();
    if (currentProductData.ownerUID !== uid) {
      return handleError(res, {
        statusCode: 403,
        message: "Anda tidak berhak memperbarui produk ini.",
      });
    }

    const fieldsToUpdate = {};
    const bucket = storage.bucket();

    if (req.file) {
      // Jika ada file gambar baru diunggah
      if (currentProductData.productImageURL) {
        // Hapus gambar produk lama jika ada
        await deleteProductImageFromStorage(
          currentProductData.productImageURL,
          bucket
        );
      }
      // Unggah gambar produk baru
      const fileExtension = req.file.originalname.split(".").pop();
      const fileName = `product-images/${
        currentProductData.shopId
      }/${uuidv4()}.${fileExtension}`;
      const fileUpload = bucket.file(fileName);
      const blobStream = fileUpload.createWriteStream({
        metadata: { contentType: req.file.mimetype },
      });

      let newProductImageURL;
      await new Promise((resolve, reject) => {
        blobStream.on("error", reject);
        blobStream.on("finish", async () => {
          try {
            await fileUpload.makePublic();
            newProductImageURL = fileUpload.publicUrl();
            resolve();
          } catch (publicError) {
            reject(publicError);
          }
        });
        blobStream.end(req.file.buffer);
      }).catch((uploadError) => {
        console.error("Upload error gambar produk baru:", uploadError);
        return handleError(res, {
          statusCode: 500,
          message: `Gagal mengunggah gambar produk baru: ${uploadError.message}`,
        });
      });
      if (res.headersSent) return;
      fieldsToUpdate.productImageURL = newProductImageURL;
    } else if (removeProductImage === "true" || removeProductImage === true) {
      if (currentProductData.productImageURL) {
        await deleteProductImageFromStorage(
          currentProductData.productImageURL,
          bucket
        );
      }
      fieldsToUpdate.productImageURL = null;
    }

    if (name !== undefined && name.trim() !== currentProductData.name) {
      if (name.trim() === "")
        return handleError(res, {
          statusCode: 400,
          message: "Nama produk tidak boleh kosong.",
        });
      fieldsToUpdate.name = name.trim();
    }
    if (
      description !== undefined &&
      description.trim() !== currentProductData.description
    ) {
      fieldsToUpdate.description = description.trim(); // Deskripsi boleh kosong
    }
    if (price !== undefined) {
      const newPrice = parseFloat(price);
      if (isNaN(newPrice) || newPrice <= 0)
        return handleError(res, {
          statusCode: 400,
          message: "Harga harus berupa angka positif.",
        });
      if (newPrice !== currentProductData.price)
        fieldsToUpdate.price = newPrice;
    }
    if (stock !== undefined) {
      const newStock = parseInt(stock);
      if (isNaN(newStock) || newStock < 0)
        return handleError(res, {
          statusCode: 400,
          message: "Stok harus berupa angka non-negatif.",
        });
      if (newStock !== currentProductData.stock)
        fieldsToUpdate.stock = newStock;
    }
    if (
      category !== undefined &&
      category.trim() !== currentProductData.category
    ) {
      if (category.trim() === "")
        return handleError(res, {
          statusCode: 400,
          message: "Kategori produk tidak boleh kosong.",
        });
      fieldsToUpdate.category = category.trim();
    }

    if (Object.keys(fieldsToUpdate).length === 0) {
      return handleError(res, {
        statusCode: 400,
        message:
          "Tidak ada data yang dikirim untuk diperbarui atau data sama dengan yang sekarang.",
      });
    }

    fieldsToUpdate.updatedAt = new Date().toISOString();
    await productDocRef.update(fieldsToUpdate);

    const updatedProductDoc = await productDocRef.get();
    return handleSuccess(
      res,
      200,
      "Produk berhasil diperbarui.",
      updatedProductDoc.data()
    );
  } catch (error) {
    console.error("Error updating product:", error);
    return handleError(res, error, "Gagal memperbarui produk.");
  }
};

// 6. Menghapus Produk (Hanya Seller Pemilik Produk)
exports.deleteProduct = async (req, res) => {
  const uid = req.user?.uid;
  const { productId } = req.params;

  if (!uid) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }

  if (!productId) {
    return handleError(res, {
      statusCode: 400,
      message: "Product ID diperlukan.",
    });
  }

  try {
    const productDocRef = firestore.collection("products").doc(productId);
    const productDoc = await productDocRef.get();

    if (!productDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Produk tidak ditemukan untuk dihapus.",
      });
    }

    const productData = productDoc.data();
    if (productData.ownerUID !== uid) {
      return handleError(res, {
        statusCode: 403,
        message: "Anda tidak berhak menghapus produk ini.",
      });
    }

    // Hapus gambar produk dari Storage jika ada
    if (productData.productImageURL) {
      const bucket = storage.bucket();
      await deleteProductImageFromStorage(productData.productImageURL, bucket);
    }

    await productDocRef.delete();

    // Opsional: Hapus referensi produk dari tempat lain jika ada (misal: keranjang belanja pengguna)

    return handleSuccess(res, 200, "Produk berhasil dihapus.");
  } catch (error) {
    console.error("Error deleting product:", error);
    return handleError(res, error, "Gagal menghapus produk.");
  }
};
