// src/controllers/cartController.js
const { firestore } = require("../config/firebaseConfig");
const { handleSuccess, handleError } = require("../utils/responseHandler");
const { FieldValue } = require("firebase-admin/firestore");

// --- Cart Controller Functions ---

/**
 * @desc    Add an item to the user's cart or update quantity if it already exists.
 * @route   POST /api/cart/items
 * @access  Private (Authenticated Users)
 */
exports.addItemToCart = async (req, res) => {
  const userId = req.user?.uid;
  const { productId, quantity } = req.body;

  if (!userId) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }

  if (!productId || !quantity) {
    return handleError(res, {
      statusCode: 400,
      message: "ID Produk dan jumlah kuantitas diperlukan.",
    });
  }

  const numQuantity = parseInt(quantity);
  if (isNaN(numQuantity) || numQuantity <= 0) {
    return handleError(res, {
      statusCode: 400,
      message: "Kuantitas harus berupa angka positif.",
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

    const productData = productDoc.data();
    if (productData.stock < numQuantity) {
      return handleError(res, {
        statusCode: 400,
        message: `Stok produk tidak mencukupi. Sisa stok: ${productData.stock}.`,
      });
    }

    const cartRef = firestore.collection("carts").doc(userId);
    const cartDoc = await cartRef.get();

    let cartData;
    let itemIndex = -1;

    if (!cartDoc.exists) {
      // Buat keranjang baru jika belum ada
      cartData = {
        userId: userId,
        items: [],
        totalPrice: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } else {
      cartData = cartDoc.data();
      itemIndex = cartData.items.findIndex(
        (item) => item.productId === productId
      );
    }

    if (itemIndex > -1) {
      // Produk sudah ada di keranjang, update kuantitas
      const existingItem = cartData.items[itemIndex];
      const newQuantityForItem = existingItem.quantity + numQuantity;

      if (productData.stock < newQuantityForItem) {
        return handleError(res, {
          statusCode: 400,
          message: `Stok produk tidak mencukupi untuk total kuantitas yang diminta. Sisa stok: ${productData.stock}, di keranjang: ${existingItem.quantity}.`,
        });
      }
      existingItem.quantity = newQuantityForItem;
      existingItem.subtotal = existingItem.price * existingItem.quantity;
    } else {
      // Tambah produk baru ke keranjang
      cartData.items.push({
        productId: productId,
        shopId: productData.shopId, // Simpan shopId untuk referensi
        name: productData.name,
        price: productData.price, // Simpan harga saat ditambahkan
        quantity: numQuantity,
        productImageURL: productData.productImageURL || null,
        subtotal: productData.price * numQuantity,
      });
    }

    // Hitung ulang total harga keranjang
    cartData.totalPrice = cartData.items.reduce(
      (total, item) => total + item.subtotal,
      0
    );
    cartData.updatedAt = new Date().toISOString();

    await cartRef.set(cartData, { merge: true }); // Gunakan merge true untuk update atau create

    return handleSuccess(
      res,
      200,
      "Produk berhasil ditambahkan ke keranjang.",
      cartData
    );
  } catch (error) {
    console.error("Error adding item to cart:", error);
    return handleError(res, error, "Gagal menambahkan produk ke keranjang.");
  }
};

/**
 * @desc    Get the user's current cart.
 * @route   GET /api/cart
 * @access  Private (Authenticated Users)
 */
exports.getCart = async (req, res) => {
  const userId = req.user?.uid;

  if (!userId) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }

  try {
    const cartRef = firestore.collection("carts").doc(userId);
    const cartDoc = await cartRef.get();

    if (
      !cartDoc.exists ||
      !cartDoc.data().items ||
      cartDoc.data().items.length === 0
    ) {
      return handleSuccess(res, 200, "Keranjang Anda kosong.", {
        userId: userId,
        items: [],
        totalPrice: 0,
      });
    }

    // TODO: Pertimbangkan untuk validasi ulang harga produk dan ketersediaan stok di sini
    // sebelum mengirimkan data keranjang, terutama jika harga sering berubah atau
    // untuk memastikan konsistensi sebelum checkout.
    // Untuk saat ini, kita kirim data yang tersimpan di keranjang.

    return handleSuccess(
      res,
      200,
      "Data keranjang berhasil diambil.",
      cartDoc.data()
    );
  } catch (error) {
    console.error("Error getting cart:", error);
    return handleError(res, error, "Gagal mengambil data keranjang.");
  }
};

/**
 * @desc    Update quantity of an item in the cart.
 * @route   PUT /api/cart/items/:productId
 * @access  Private (Authenticated Users)
 */
exports.updateItemQuantity = async (req, res) => {
  const userId = req.user?.uid;
  const { productId } = req.params;
  const { newQuantity } = req.body;

  if (!userId) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }

  if (!productId) {
    return handleError(res, {
      statusCode: 400,
      message: "ID Produk diperlukan.",
    });
  }

  const numNewQuantity = parseInt(newQuantity);
  if (isNaN(numNewQuantity) || numNewQuantity < 0) {
    // Kuantitas 0 akan ditangani sebagai penghapusan item
    return handleError(res, {
      statusCode: 400,
      message: "Kuantitas baru harus berupa angka non-negatif.",
    });
  }

  try {
    const cartRef = firestore.collection("carts").doc(userId);
    const cartDoc = await cartRef.get();

    if (!cartDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Keranjang tidak ditemukan.",
      });
    }

    let cartData = cartDoc.data();
    const itemIndex = cartData.items.findIndex(
      (item) => item.productId === productId
    );

    if (itemIndex === -1) {
      return handleError(res, {
        statusCode: 404,
        message: "Produk tidak ditemukan di dalam keranjang.",
      });
    }

    if (numNewQuantity === 0) {
      // Jika kuantitas baru adalah 0, hapus item dari keranjang
      cartData.items.splice(itemIndex, 1);
    } else {
      const productRef = firestore.collection("products").doc(productId);
      const productDoc = await productRef.get();

      if (!productDoc.exists) {
        // Seharusnya tidak terjadi jika produk sudah ada di keranjang, tapi sebagai fallback
        cartData.items.splice(itemIndex, 1); // Hapus item jika produk aslinya sudah tidak ada
        await cartRef.set(cartData);
        return handleError(res, {
          statusCode: 404,
          message: "Produk asli tidak ditemukan, item dihapus dari keranjang.",
        });
      }

      const productData = productDoc.data();
      if (productData.stock < numNewQuantity) {
        return handleError(res, {
          statusCode: 400,
          message: `Stok produk tidak mencukupi. Sisa stok: ${productData.stock}.`,
        });
      }

      const itemToUpdate = cartData.items[itemIndex];
      itemToUpdate.quantity = numNewQuantity;
      itemToUpdate.subtotal = itemToUpdate.price * numNewQuantity;
    }

    cartData.totalPrice = cartData.items.reduce(
      (total, item) => total + item.subtotal,
      0
    );
    cartData.updatedAt = new Date().toISOString();

    await cartRef.set(cartData);
    return handleSuccess(
      res,
      200,
      "Kuantitas produk di keranjang berhasil diperbarui.",
      cartData
    );
  } catch (error) {
    console.error("Error updating item quantity:", error);
    return handleError(res, error, "Gagal memperbarui kuantitas produk.");
  }
};

/**
 * @desc    Remove an item from the cart.
 * @route   DELETE /api/cart/items/:productId
 * @access  Private (Authenticated Users)
 */
exports.removeItemFromCart = async (req, res) => {
  const userId = req.user?.uid;
  const { productId } = req.params;

  if (!userId) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }
  if (!productId) {
    return handleError(res, {
      statusCode: 400,
      message: "ID Produk diperlukan.",
    });
  }

  try {
    const cartRef = firestore.collection("carts").doc(userId);
    const cartDoc = await cartRef.get();

    if (!cartDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Keranjang tidak ditemukan.",
      });
    }

    let cartData = cartDoc.data();
    const initialItemCount = cartData.items.length;
    cartData.items = cartData.items.filter(
      (item) => item.productId !== productId
    );

    if (cartData.items.length === initialItemCount) {
      return handleError(res, {
        statusCode: 404,
        message: "Produk tidak ditemukan di dalam keranjang untuk dihapus.",
      });
    }

    cartData.totalPrice = cartData.items.reduce(
      (total, item) => total + item.subtotal,
      0
    );
    cartData.updatedAt = new Date().toISOString();

    await cartRef.set(cartData);
    return handleSuccess(
      res,
      200,
      "Produk berhasil dihapus dari keranjang.",
      cartData
    );
  } catch (error) {
    console.error("Error removing item from cart:", error);
    return handleError(res, error, "Gagal menghapus produk dari keranjang.");
  }
};

/**
 * @desc    Clear all items from the user's cart.
 * @route   DELETE /api/cart
 * @access  Private (Authenticated Users)
 */
exports.clearCart = async (req, res) => {
  const userId = req.user?.uid;

  if (!userId) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }

  try {
    const cartRef = firestore.collection("carts").doc(userId);

    // Update keranjang menjadi kosong
    const emptyCartData = {
      userId: userId,
      items: [],
      totalPrice: 0,
      updatedAt: new Date().toISOString(),
      // createdAt bisa dipertahankan jika ingin tahu kapan keranjang pertama kali dibuat
      // atau di-set ulang juga. Untuk kesederhanaan, kita set updatedAt.
    };

    // Cek apakah dokumen keranjang ada sebelum melakukan set
    const cartDoc = await cartRef.get();
    if (cartDoc.exists) {
      emptyCartData.createdAt =
        cartDoc.data().createdAt || new Date().toISOString(); // Pertahankan createdAt jika ada
      await cartRef.set(emptyCartData);
    } else {
      // Jika keranjang belum ada, tidak ada yang perlu dikosongkan,
      // tapi kita bisa mengembalikan struktur keranjang kosong standar.
      emptyCartData.createdAt = new Date().toISOString();
    }

    return handleSuccess(
      res,
      200,
      "Keranjang berhasil dikosongkan.",
      emptyCartData
    );
  } catch (error) {
    console.error("Error clearing cart:", error);
    return handleError(res, error, "Gagal mengosongkan keranjang.");
  }
};
