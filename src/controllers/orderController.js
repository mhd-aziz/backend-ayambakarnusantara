const { firestore, storage } = require("../config/firebaseConfig");
const { handleSuccess, handleError } = require("../utils/responseHandler");
const { sendNotification } = require("./notificationController");
const { FieldValue } = require("firebase-admin/firestore");
const path = require("path");

exports.createOrder = async (req, res) => {
  const userId = req.user?.uid;
  const { paymentMethod, notes } = req.body;

  if (!userId) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }

  if (!paymentMethod) {
    return handleError(res, {
      statusCode: 400,
      message:
        "Metode pembayaran diperlukan. Contoh: 'PAY_AT_STORE' atau 'ONLINE_PAYMENT'.",
    });
  }

  const cartRef = firestore.collection("carts").doc(userId);
  const productsCollection = firestore.collection("products");
  const ordersCollection = firestore.collection("orders");

  try {
    const cartDoc = await cartRef.get();

    if (
      !cartDoc.exists ||
      !cartDoc.data().items ||
      cartDoc.data().items.length === 0
    ) {
      return handleError(res, {
        statusCode: 400,
        message: "Keranjang Anda kosong. Tidak dapat membuat pesanan.",
      });
    }

    const cartData = cartDoc.data();
    const orderItems = [];
    let calculatedTotalPrice = 0;
    const shopIds = new Set();

    const productChecks = cartData.items.map(async (item) => {
      const productRef = productsCollection.doc(item.productId);
      const productDoc = await productRef.get();

      if (!productDoc.exists) {
        throw {
          statusCode: 404,
          message: `Produk dengan ID ${item.productId} (${item.name}) tidak ditemukan lagi. Harap hapus dari keranjang Anda.`,
        };
      }

      const productData = productDoc.data();
      if (productData.stock < item.quantity) {
        throw {
          statusCode: 400,
          message: `Stok untuk produk ${item.name} tidak mencukupi. Sisa stok: ${productData.stock}, diminta: ${item.quantity}.`,
        };
      }

      if (productData.shopId) {
        shopIds.add(productData.shopId);
      }

      orderItems.push({
        productId: item.productId,
        shopId: item.shopId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        productImageURL: item.productImageURL || null,
        subtotal: item.price * item.quantity,
      });
      calculatedTotalPrice += item.price * item.quantity;
    });

    await Promise.all(productChecks);

    if (Math.abs(calculatedTotalPrice - cartData.totalPrice) > 0.001) {
      console.warn(
        `Peringatan: Total harga keranjang (${cartData.totalPrice}) berbeda dengan total yang dihitung ulang (${calculatedTotalPrice}). Menggunakan total yang dihitung ulang.`
      );
    }

    let initialOrderStatus;
    let paymentDetailsStatus;
    const upperPaymentMethod = paymentMethod.toUpperCase();

    if (upperPaymentMethod === "PAY_AT_STORE") {
      initialOrderStatus = "PENDING_CONFIRMATION";
      paymentDetailsStatus = "pay_on_pickup";
    } else if (upperPaymentMethod === "ONLINE_PAYMENT") {
      initialOrderStatus = "AWAITING_PAYMENT";
      paymentDetailsStatus = "awaiting_gateway_interaction";
    } else {
      return handleError(res, {
        statusCode: 400,
        message:
          "Metode pembayaran tidak valid. Gunakan 'PAY_AT_STORE' atau 'ONLINE_PAYMENT'.",
      });
    }

    const newOrderRef = ordersCollection.doc();
    const newOrderData = {
      orderId: newOrderRef.id,
      userId: userId,
      items: orderItems,
      totalPrice: calculatedTotalPrice,
      paymentDetails: {
        method: paymentMethod,
        status: paymentDetailsStatus,
        gatewayTransactionId: null,
        gatewayAssignedOrderId: null,
        gatewaySnapToken: null,
        gatewayRedirectUrl: null,
      },
      orderStatus: initialOrderStatus,
      orderType: "PICKUP",
      notes: notes || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const batch = firestore.batch();
    batch.set(newOrderRef, newOrderData);

    orderItems.forEach((item) => {
      const productRef = productsCollection.doc(item.productId);
      batch.update(productRef, {
        stock: FieldValue.increment(-item.quantity),
      });
    });

    batch.update(cartRef, {
      items: [],
      totalPrice: 0,
      updatedAt: new Date().toISOString(),
    });

    await batch.commit();

    try {
      if (shopIds.size > 0) {
        const customerDoc = await firestore
          .collection("users")
          .doc(userId)
          .get();
        const customerName = customerDoc.exists
          ? customerDoc.data().displayName
          : "Seorang pelanggan";

        const shopId = shopIds.values().next().value;
        const shopDoc = await firestore.collection("shops").doc(shopId).get();

        if (shopDoc.exists) {
          const sellerUID = shopDoc.data().ownerUID;
          const notificationPayload = {
            userId: sellerUID,
            title: "Pesanan Baru Diterima!",
            body: `${customerName} telah membuat pesanan baru #${newOrderRef.id.substring(
              0,
              20
            )}.`,
            data: { orderId: newOrderRef.id, type: "NEW_ORDER" },
          };
          await sendNotification(notificationPayload);
        }
      }
    } catch (notifError) {
      console.error(
        "Gagal mengirim notifikasi pesanan baru ke seller:",
        notifError
      );
    }

    return handleSuccess(res, 201, "Pesanan berhasil dibuat.", newOrderData);
  } catch (error) {
    console.error("Error creating order:", error);
    if (error.statusCode) {
      return handleError(res, error);
    }
    return handleError(res, {
      statusCode: 500,
      message: "Gagal membuat pesanan.",
    });
  }
};

exports.getUserOrders = async (req, res) => {
  const userId = req.user?.uid;

  if (!userId) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }

  try {
    const ordersSnapshot = await firestore
      .collection("orders")
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .get();

    if (ordersSnapshot.empty) {
      return handleSuccess(res, 200, "Anda belum memiliki pesanan.", []);
    }

    const orders = ordersSnapshot.docs.map((doc) => {
      const orderData = doc.data();
      if (
        orderData.paymentDetails &&
        orderData.paymentDetails.gatewayTransactionId
      ) {
        orderData.paymentDetails.transactionId =
          orderData.paymentDetails.gatewayTransactionId;
      }
      return orderData;
    });

    return handleSuccess(res, 200, "Data pesanan berhasil diambil.", orders);
  } catch (error) {
    console.error("Error getting user orders:", error);
    return handleError(res, {
      statusCode: 500,
      message: "Gagal mengambil data pesanan.",
    });
  }
};

exports.getOrderDetailsForCustomer = async (req, res) => {
  const customerId = req.user?.uid;
  const { orderId } = req.params;

  if (!customerId) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }
  if (!orderId) {
    return handleError(res, {
      statusCode: 400,
      message: "ID Pesanan diperlukan.",
    });
  }

  try {
    const orderRef = firestore.collection("orders").doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Pesanan tidak ditemukan.",
      });
    }
    const orderData = orderDoc.data();

    if (orderData.userId !== customerId) {
      return handleError(res, {
        statusCode: 403,
        message: "Anda tidak diizinkan untuk mengakses detail pesanan ini.",
      });
    }

    let shopDetails = null;
    if (orderData.items && orderData.items.length > 0) {
      const shopId = orderData.items[0].shopId;
      if (shopId) {
        const shopDoc = await firestore.collection("shops").doc(shopId).get();
        if (shopDoc.exists) {
          const shopData = shopDoc.data();
          shopDetails = {
            shopName: shopData.shopName,
            shopAddress: shopData.shopAddress,
            bannerImageURL: shopData.bannerImageURL,
            description: shopData.description,
          };
        }
      }
    }

    if (
      orderData.paymentDetails &&
      orderData.paymentDetails.gatewayTransactionId
    ) {
      orderData.paymentDetails.transactionId =
        orderData.paymentDetails.gatewayTransactionId;
    }

    return handleSuccess(res, 200, "Detail pesanan berhasil diambil.", {
      order: orderData,
      shopDetails: shopDetails,
    });
  } catch (error) {
    console.error("Error getting order details for customer:", error);
    return handleError(res, {
      statusCode: 500,
      message: "Gagal mengambil detail pesanan untuk customer.",
    });
  }
};

exports.getSellerOrders = async (req, res) => {
  const sellerId = req.user?.uid;
  const {
    status: statusQuery,
    customerUserId: customerUserIdQuery,
    customerSearch: customerSearchQuery,
    orderId: orderIdQuery,
  } = req.query;

  if (!sellerId) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }

  try {
    const sellerUserDocRef = firestore.collection("users").doc(sellerId);
    const sellerUserDoc = await sellerUserDocRef.get();

    if (!sellerUserDoc.exists || sellerUserDoc.data().role !== "seller") {
      return handleError(res, {
        statusCode: 403,
        message: "Hanya seller yang dapat mengakses daftar pesanan ini.",
      });
    }

    const sellerOwnedShopId = sellerUserDoc.data().shopId;
    if (!sellerOwnedShopId) {
      return handleError(res, {
        statusCode: 403,
        message:
          "Hanya seller dengan id toko yang valid yang dapat mengakses daftar pesanan ini.",
      });
    }

    // --- Mode Pencarian Multi-Order ---
    // Blok if (orderIdQuery) yang mengambil satu doc dihilangkan, karena orderIdQuery kini bagian dari filter umum
    let ordersQuery = firestore.collection("orders");

    // 1. Filter berdasarkan customerUserId jika disediakan (equality filter, baik untuk Firestore)
    if (customerUserIdQuery) {
      ordersQuery = ordersQuery.where("userId", "==", customerUserIdQuery);
    }

    // 2. Filter berdasarkan status jika disediakan dan bukan "ALL" (equality filter, baik untuk Firestore)
    if (statusQuery && statusQuery.toUpperCase() !== "ALL") {
      ordersQuery = ordersQuery.where(
        "orderStatus",
        "==",
        statusQuery.toUpperCase()
      );
    }
    // Jika statusQuery adalah "ALL" atau tidak ada, tidak ada filter status awal.

    // Selalu urutkan berdasarkan createdAt untuk konsistensi
    ordersQuery = ordersQuery.orderBy("createdAt", "desc");
    const ordersSnapshot = await ordersQuery.get();

    let messageIfEmpty = "Tidak ada pesanan ditemukan untuk kriteria ini.";
    if (orderIdQuery || customerSearchQuery) {
      messageIfEmpty =
        "Tidak ada pesanan yang cocok dengan kriteria pencarian untuk toko Anda.";
    }

    if (ordersSnapshot.empty) {
      return handleSuccess(res, 200, messageIfEmpty, []);
    }

    const allFetchedOrders = ordersSnapshot.docs.map((doc) => doc.data());

    const sellerOrdersPromises = allFetchedOrders.map(async (orderData) => {
      // Filter WAJIB 1: Kepemilikan toko seller
      if (
        !(
          orderData.items &&
          orderData.items.length > 0 &&
          orderData.items.every((item) => item.shopId === sellerOwnedShopId)
        )
      ) {
        return null;
      }

      // Filter WAJIB 2 (jika orderIdQuery ada): Pencarian "contains" pada orderId
      if (orderIdQuery) {
        const orderIdTerm = orderIdQuery.toLowerCase();
        if (
          !orderData.orderId ||
          !orderData.orderId.toLowerCase().includes(orderIdTerm)
        ) {
          return null; // orderId tidak mengandung term pencarian
        }
      }

      // Ambil detail customer (diperlukan untuk customerSearchQuery dan untuk ditampilkan)
      let customerDetails = null;
      if (orderData.userId) {
        const customerDocRef = firestore
          .collection("users")
          .doc(orderData.userId);
        const customerDoc = await customerDocRef.get();
        if (customerDoc.exists) {
          const custData = customerDoc.data();
          customerDetails = {
            userId: orderData.userId,
            displayName: custData.displayName || null,
            email: custData.email || null,
            phoneNumber: custData.phoneNumber || null,
            photoURL: custData.photoURL || null,
          };
        }
      }
      orderData.customerDetails = customerDetails;

      // Filter WAJIB 3 (jika customerSearchQuery ada): Pencarian "contains" pada nama/email customer
      if (customerSearchQuery) {
        if (!customerDetails) {
          // Jika mencari berdasarkan customer tapi customer tidak ditemukan/tidak ada detail, skip order ini
          return null;
        }
        const searchTerm = customerSearchQuery.toLowerCase();
        const nameMatch =
          customerDetails.displayName &&
          customerDetails.displayName.toLowerCase().includes(searchTerm);
        const emailMatch =
          customerDetails.email &&
          customerDetails.email.toLowerCase().includes(searchTerm);

        if (!nameMatch && !emailMatch) {
          return null; // Tidak cocok dengan kriteria pencarian customer
        }
      }

      if (
        orderData.paymentDetails &&
        orderData.paymentDetails.gatewayTransactionId
      ) {
        orderData.paymentDetails.transactionId =
          orderData.paymentDetails.gatewayTransactionId;
      }
      return orderData;
    });

    const filteredOrders = (await Promise.all(sellerOrdersPromises)).filter(
      (order) => order !== null
    );

    if (filteredOrders.length === 0) {
      return handleSuccess(res, 200, messageIfEmpty, []);
    }

    return handleSuccess(
      res,
      200,
      "Daftar pesanan untuk seller berhasil diambil.",
      filteredOrders
    );
  } catch (error) {
    console.error("Error getting seller orders:", error);
    return handleError(res, {
      statusCode: 500,
      message: "Gagal mengambil daftar pesanan untuk seller.",
      detail: error.message,
    });
  }
};

exports.getOrderDetailsForSeller = async (req, res) => {
  const sellerId = req.user?.uid;
  const { orderId } = req.params;

  if (!sellerId) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }
  if (!orderId) {
    return handleError(res, {
      statusCode: 400,
      message: "ID Pesanan diperlukan.",
    });
  }

  try {
    const sellerUserDocRef = firestore.collection("users").doc(sellerId);
    const sellerUserDoc = await sellerUserDocRef.get();

    if (!sellerUserDoc.exists || sellerUserDoc.data().role !== "seller") {
      return handleError(res, {
        statusCode: 403,
        message: "Hanya seller yang dapat mengakses ini.",
      });
    }
    const sellerOwnedShopId = sellerUserDoc.data().shopId;
    if (!sellerOwnedShopId) {
      return handleError(res, {
        statusCode: 403,
        message: "Seller tidak memiliki informasi toko yang valid.",
      });
    }

    const orderRef = firestore.collection("orders").doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Pesanan tidak ditemukan.",
      });
    }
    const orderData = orderDoc.data();

    if (!orderData.items || orderData.items.length === 0) {
      return handleError(res, {
        statusCode: 400,
        message: "Pesanan tidak memiliki item.",
      });
    }
    const orderBelongsToSellerShop = orderData.items.every(
      (item) => item.shopId === sellerOwnedShopId
    );
    if (!orderBelongsToSellerShop) {
      return handleError(res, {
        statusCode: 403,
        message:
          "Anda tidak berhak mengakses detail pesanan ini karena tidak terkait dengan toko Anda.",
      });
    }

    let customerInfo = null;
    const customerUID = orderData.userId;
    if (customerUID) {
      const customerUserDoc = await firestore
        .collection("users")
        .doc(customerUID)
        .get();
      if (customerUserDoc.exists) {
        const customerUserData = customerUserDoc.data();
        customerInfo = {
          displayName: customerUserData.displayName,
          email: customerUserData.email,
          phoneNumber: customerUserData.phoneNumber,
          photoURL: customerUserData.photoURL,
        };
      }
    }

    if (
      orderData.paymentDetails &&
      orderData.paymentDetails.gatewayTransactionId
    ) {
      orderData.paymentDetails.transactionId =
        orderData.paymentDetails.gatewayTransactionId;
    }

    return handleSuccess(res, 200, "Detail pesanan berhasil diambil.", {
      order: orderData,
      customerDetails: customerInfo,
    });
  } catch (error) {
    console.error("Error getting order details for seller:", error);
    return handleError(res, {
      statusCode: 500,
      message: "Gagal mengambil detail pesanan untuk seller.",
    });
  }
};

exports.cancelOrder = async (req, res) => {
  const userId = req.user?.uid;
  const { orderId } = req.params;

  if (!userId) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }
  if (!orderId) {
    return handleError(res, {
      statusCode: 400,
      message: "ID Pesanan diperlukan.",
    });
  }

  const orderRef = firestore.collection("orders").doc(orderId);
  const productsCollection = firestore.collection("products");

  try {
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Pesanan tidak ditemukan.",
      });
    }
    const orderData = orderDoc.data();

    if (orderData.userId !== userId) {
      return handleError(res, {
        statusCode: 403,
        message: "Anda tidak diizinkan untuk membatalkan pesanan ini.",
      });
    }

    const cancellableStatuses = ["AWAITING_PAYMENT", "PENDING_CONFIRMATION"];
    if (!cancellableStatuses.includes(orderData.orderStatus)) {
      return handleError(res, {
        statusCode: 400,
        message: `Pesanan dengan status "${orderData.orderStatus}" tidak dapat dibatalkan oleh Anda saat ini.`,
      });
    }

    const batch = firestore.batch();
    batch.update(orderRef, {
      orderStatus: "CANCELLED",
      "paymentDetails.status": "cancelled_by_user",
      updatedAt: new Date().toISOString(),
    });

    orderData.items.forEach((item) => {
      const productRef = productsCollection.doc(item.productId);
      batch.update(productRef, {
        stock: FieldValue.increment(item.quantity),
      });
    });

    await batch.commit();

    try {
      if (orderData.items && orderData.items.length > 0) {
        const shopId = orderData.items[0].shopId;
        const shopDoc = await firestore.collection("shops").doc(shopId).get();

        if (shopDoc.exists) {
          const sellerUID = shopDoc.data().ownerUID;
          const notificationPayload = {
            userId: sellerUID,
            title: "Pesanan Dibatalkan",
            body: `Pesanan #${orderId.substring(
              0,
              20
            )} telah dibatalkan oleh pelanggan.`,
            data: { orderId: orderId, type: "ORDER_CANCELLED" },
          };
          await sendNotification(notificationPayload);
        }
      }
    } catch (notifError) {
      console.error(
        "Gagal mengirim notifikasi pembatalan pesanan ke seller:",
        notifError
      );
    }

    const updatedOrderDoc = await orderRef.get();

    return handleSuccess(
      res,
      200,
      "Pesanan berhasil dibatalkan.",
      updatedOrderDoc.data()
    );
  } catch (error) {
    console.error("Error cancelling order:", error);
    if (error.statusCode) {
      return handleError(res, error);
    }
    return handleError(res, {
      statusCode: 500,
      message: "Gagal membatalkan pesanan.",
    });
  }
};

exports.updateOrderStatusBySeller = async (req, res) => {
  const sellerId = req.user?.uid;
  const { orderId } = req.params;
  const { newStatus } = req.body;

  if (!sellerId) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }

  if (!orderId) {
    return handleError(res, {
      statusCode: 400,
      message: "ID Pesanan diperlukan.",
    });
  }

  const allowedNewStatuses = [
    "PROCESSING",
    "READY_FOR_PICKUP",
    "COMPLETED",
    "CONFIRMED",
  ];
  if (!newStatus || !allowedNewStatuses.includes(newStatus.toUpperCase())) {
    return handleError(res, {
      statusCode: 400,
      message: `Status baru tidak valid atau tidak disediakan. Harap set 'newStatus' menjadi salah satu dari: ${allowedNewStatuses.join(
        ", "
      )}.`,
    });
  }
  const normalizedNewStatus = newStatus.toUpperCase();

  const orderRef = firestore.collection("orders").doc(orderId);
  const usersCollection = firestore.collection("users");

  try {
    const sellerUserDocRef = usersCollection.doc(sellerId);
    const sellerUserDoc = await sellerUserDocRef.get();

    if (!sellerUserDoc.exists || sellerUserDoc.data().role !== "seller") {
      return handleError(res, {
        statusCode: 403,
        message: "Hanya seller yang dapat memperbarui status pesanan ini.",
      });
    }
    const sellerShopId = sellerUserDoc.data().shopId;
    if (!sellerShopId) {
      return handleError(res, {
        statusCode: 403,
        message: "Seller tidak memiliki informasi toko yang valid.",
      });
    }

    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Pesanan tidak ditemukan.",
      });
    }
    const orderData = orderDoc.data();

    const orderBelongsToSellerShop = orderData.items.every(
      (item) => item.shopId === sellerShopId
    );

    if (!orderBelongsToSellerShop) {
      return handleError(res, {
        statusCode: 403,
        message:
          "Anda tidak berhak memperbarui status pesanan ini karena tidak semua item berasal dari toko Anda.",
      });
    }

    let validPreviousStatuses;
    let paymentStatusUpdate = {};

    switch (normalizedNewStatus) {
      case "CONFIRMED":
        validPreviousStatuses = ["PENDING_CONFIRMATION"];
        if (orderData.paymentDetails.method.toUpperCase() !== "PAY_AT_STORE") {
          return handleError(res, {
            statusCode: 400,
            message: "Status CONFIRMED hanya untuk pesanan Bayar di Tempat.",
          });
        }
        break;
      case "PROCESSING":
        if (
          orderData.paymentDetails.method.toUpperCase() === "ONLINE_PAYMENT" &&
          orderData.paymentDetails.status !== "paid"
        ) {
          return handleError(res, {
            statusCode: 400,
            message: "Pembayaran online untuk pesanan ini belum lunas.",
          });
        }
        validPreviousStatuses =
          orderData.paymentDetails.method.toUpperCase() === "PAY_AT_STORE"
            ? ["CONFIRMED"]
            : ["AWAITING_PAYMENT"];
        break;
      case "READY_FOR_PICKUP":
        validPreviousStatuses = ["PROCESSING"];
        break;
      case "COMPLETED":
        validPreviousStatuses = ["READY_FOR_PICKUP"];
        if (
          orderData.paymentDetails.method.toUpperCase() === "PAY_AT_STORE" &&
          orderData.paymentDetails.status !== "paid"
        ) {
          return handleError(res, {
            statusCode: 400,
            message:
              "Pesanan Bayar di Tempat harus ditandai lunas sebelum diselesaikan.",
          });
        }
        break;
      default:
        console.error(
          "Kesalahan logika internal: Status baru tidak dikenal dalam switch:",
          normalizedNewStatus
        );
        return handleError(res, {
          statusCode: 500,
          message: "Terjadi kesalahan internal dalam pemrosesan status.",
        });
    }

    if (!validPreviousStatuses.includes(orderData.orderStatus)) {
      return handleError(res, {
        statusCode: 400,
        message: `Pesanan dengan status "${orderData.orderStatus}" tidak dapat diubah menjadi "${normalizedNewStatus}" saat ini.`,
      });
    }

    if (orderData.orderStatus === normalizedNewStatus) {
      return handleError(res, {
        statusCode: 400,
        message: `Pesanan sudah dalam status "${normalizedNewStatus}".`,
      });
    }

    const updatePayload = {
      orderStatus: normalizedNewStatus,
      updatedAt: new Date().toISOString(),
      ...paymentStatusUpdate,
    };

    await orderRef.update(updatePayload);

    const customerId = orderData.userId;
    const notificationPayload = {
      userId: customerId,
      title: "Status Pesanan Diperbarui!",
      body: `Status pesanan #${orderId.substring(
        0,
        20
      )} kini adalah ${normalizedNewStatus}.`,
      data: { orderId: orderId, type: "ORDER_STATUS_UPDATE" },
    };
    await sendNotification(notificationPayload);

    const updatedOrderDoc = await orderRef.get();
    return handleSuccess(
      res,
      200,
      `Status pesanan berhasil diperbarui menjadi ${normalizedNewStatus}.`,
      updatedOrderDoc.data()
    );
  } catch (error) {
    console.error("Error updating order status by seller:", error);
    if (error.statusCode) {
      return handleError(res, error);
    }
    return handleError(res, {
      statusCode: 500,
      message: "Gagal memperbarui status pesanan.",
    });
  }
};

exports.confirmPayAtStorePaymentBySeller = async (req, res) => {
  const sellerId = req.user?.uid;
  const { orderId } = req.params;
  const { paymentConfirmationNotes } = req.body;

  if (!sellerId) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }
  if (!orderId) {
    return handleError(res, {
      statusCode: 400,
      message: "ID Pesanan diperlukan.",
    });
  }

  const orderRef = firestore.collection("orders").doc(orderId);

  try {
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Pesanan tidak ditemukan.",
      });
    }
    const orderData = orderDoc.data();

    const sellerUserDoc = await firestore
      .collection("users")
      .doc(sellerId)
      .get();
    if (
      !sellerUserDoc.exists ||
      sellerUserDoc.data().role !== "seller" ||
      !orderData.items.every(
        (item) => item.shopId === sellerUserDoc.data().shopId
      )
    ) {
      return handleError(res, { statusCode: 403, message: "Akses ditolak." });
    }

    if (orderData.paymentDetails.method.toUpperCase() !== "PAY_AT_STORE") {
      return handleError(res, {
        statusCode: 400,
        message: "Fungsi ini hanya untuk pesanan 'Bayar di Tempat'.",
      });
    }

    const proofImageURLs = orderData.paymentDetails.proofImageURLs || [];
    let newProofsUploaded = false;
    if (req.files && req.files.length > 0) {
      newProofsUploaded = true;
      const bucket = storage.bucket();
      for (const file of req.files) {
        const timestamp = Date.now();
        const originalNameWithoutExt = path.parse(file.originalname).name;
        const extension = path.parse(file.originalname).ext;
        const fileName = `orders/${orderId}/paymentProofs/${timestamp}-${originalNameWithoutExt.replace(
          /\s+/g,
          "_"
        )}${extension}`;
        const fileUpload = bucket.file(fileName);
        await fileUpload.save(file.buffer, {
          metadata: { contentType: file.mimetype },
          public: true,
        });
        proofImageURLs.push(
          `https://storage.googleapis.com/${bucket.name}/${fileName}`
        );
      }
    }

    const updatePayload = {
      "paymentDetails.status": "paid",
      "paymentDetails.confirmedAt": new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (paymentConfirmationNotes) {
      updatePayload["paymentDetails.confirmationNotes"] =
        paymentConfirmationNotes;
    }
    if (newProofsUploaded || proofImageURLs.length > 0) {
      updatePayload["paymentDetails.proofImageURLs"] = proofImageURLs;
    }

    await orderRef.update(updatePayload);

    try {
      const customerId = orderData.userId;
      const notificationPayload = {
        userId: customerId,
        title: "Pembayaran Dikonfirmasi",
        body: `Pembayaran untuk pesanan #${orderId.substring(
          0,
          20
        )} telah dikonfirmasi oleh penjual.`,
        data: { orderId: orderId, type: "PAYMENT_CONFIRMED" },
      };
      await sendNotification(notificationPayload);
    } catch (notifError) {
      console.error(
        "Gagal mengirim notifikasi konfirmasi pembayaran ke customer:",
        notifError
      );
    }

    const updatedOrderDoc = await orderRef.get();
    return handleSuccess(
      res,
      200,
      "Pembayaran Bayar di Tempat berhasil dikonfirmasi" +
        (newProofsUploaded ? " dan bukti transaksi diunggah." : "."),
      updatedOrderDoc.data()
    );
  } catch (error) {
    console.error("Error confirming pay at store payment by seller:", error);
    if (error.statusCode) {
      return handleError(res, error);
    }
    return handleError(res, {
      statusCode: 500,
      message: "Gagal mengkonfirmasi pembayaran.",
      detail: error.message,
    });
  }
};

exports.getOrderPaymentProofs = async (req, res) => {
  const currentAuthUserId = req.user?.uid; // ID pengguna yang terotentikasi
  const { orderId } = req.params;

  if (!currentAuthUserId) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }
  if (!orderId) {
    return handleError(res, {
      statusCode: 400,
      message: "ID Pesanan diperlukan.",
    });
  }

  try {
    const orderRef = firestore.collection("orders").doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Pesanan tidak ditemukan.",
      });
    }
    const orderData = orderDoc.data();

    // Otorisasi: Cek apakah pengguna adalah customer pemilik order atau seller pemilik toko order
    let authorized = false;
    const customerIdFromOrder = orderData.userId;

    // Cek apakah pengguna adalah customer pemilik order
    if (customerIdFromOrder === currentAuthUserId) {
      authorized = true;
    } else {
      // Jika bukan customer, cek apakah pengguna adalah seller yang relevan
      const userDocRef = firestore.collection("users").doc(currentAuthUserId);
      const userDoc = await userDocRef.get();

      if (userDoc.exists && userDoc.data().role === "seller") {
        const sellerShopId = userDoc.data().shopId;
        if (
          sellerShopId &&
          orderData.items &&
          orderData.items.length > 0 &&
          orderData.items.every((item) => item.shopId === sellerShopId)
        ) {
          authorized = true;
        }
      }
    }

    if (!authorized) {
      return handleError(res, {
        statusCode: 403,
        message: "Anda tidak berhak mengakses bukti transaksi ini.",
      });
    }

    // Ambil detail pembayaran, termasuk notes dan URL gambar
    const paymentDetails = orderData.paymentDetails || {};
    const paymentProofData = {
      confirmationNotes: paymentDetails.confirmationNotes || null, // Ambil notes, default ke null jika tidak ada
      proofImageURLs: paymentDetails.proofImageURLs || [], // Ambil URL gambar, default ke array kosong
    };

    return handleSuccess(
      res,
      200,
      "Bukti dan catatan transaksi berhasil diambil.", // Pesan disesuaikan
      paymentProofData // Kembalikan objek yang berisi notes dan URL
    );
  } catch (error) {
    console.error("Error getting order payment proofs:", error);
    return handleError(res, {
      statusCode: 500,
      message: "Gagal mengambil bukti transaksi.",
      detail: error.message,
    });
  }
};

exports.getOrders = async (req, res) => {
  const currentUserId = req.user?.uid;
  const { status: statusQuery, limit = 10, offset = 0 } = req.query;

  if (!currentUserId) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }

  try {
    const userRef = firestore.collection("users").doc(currentUserId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Data pengguna tidak ditemukan.",
      });
    }
    const userData = userDoc.data();
    const userRole = userData.role;

    let ordersQuery = firestore.collection("orders");

    if (userRole === "customer") {
      ordersQuery = ordersQuery.where("userId", "==", currentUserId);
      if (statusQuery && statusQuery.toUpperCase() !== "ALL") {
        ordersQuery = ordersQuery.where(
          "orderStatus",
          "==",
          statusQuery.toUpperCase()
        );
      }
    } else if (userRole === "seller") {
      const sellerOwnedShopId = userData.shopId;
      if (!sellerOwnedShopId) {
        return handleError(res, {
          statusCode: 403,
          message: "Seller tidak memiliki informasi toko yang valid.",
        });
      }
      if (statusQuery && statusQuery.toUpperCase() !== "ALL") {
        ordersQuery = ordersQuery.where(
          "orderStatus",
          "==",
          statusQuery.toUpperCase()
        );
      }
    } else {
      return handleError(res, {
        statusCode: 403,
        message: "Peran pengguna tidak valid untuk mengakses pesanan.",
      });
    }

    ordersQuery = ordersQuery.orderBy("createdAt", "desc");

    ordersQuery = ordersQuery.limit(parseInt(limit));

    const ordersSnapshot = await ordersQuery.get();

    if (ordersSnapshot.empty && userRole === "customer") {
      return handleSuccess(res, 200, "Anda belum memiliki pesanan.", []);
    }
    if (
      ordersSnapshot.empty &&
      userRole === "seller" &&
      fetchedOrders.length === 0
    ) {
      // Kondisi ini akan dicek setelah filter seller
      return handleSuccess(
        res,
        200,
        "Tidak ada pesanan ditemukan untuk toko Anda dengan kriteria ini.",
        []
      );
    }

    let fetchedOrders = ordersSnapshot.docs.map((doc) => {
      const orderData = doc.data();
      if (
        orderData.paymentDetails &&
        orderData.paymentDetails.gatewayTransactionId
      ) {
        orderData.paymentDetails.transactionId =
          orderData.paymentDetails.gatewayTransactionId;
      }
      return orderData;
    });

    if (userRole === "seller") {
      const sellerOwnedShopId = userData.shopId;
      fetchedOrders = fetchedOrders.filter(
        (order) =>
          order.items &&
          order.items.some((item) => item.shopId === sellerOwnedShopId)
      );

      if (fetchedOrders.length === 0) {
        return handleSuccess(
          res,
          200,
          "Tidak ada pesanan yang cocok untuk toko Anda setelah filter.",
          []
        );
      }

      const ordersWithCustomerDetails = await Promise.all(
        fetchedOrders.map(async (order) => {
          if (order.userId) {
            const custDoc = await firestore
              .collection("users")
              .doc(order.userId)
              .get();
            if (custDoc.exists) {
              const custData = custDoc.data();
              order.customerRingkas = {
                displayName: custData.displayName || null,
              };
            }
          }
          return order;
        })
      );
      fetchedOrders = ordersWithCustomerDetails;
    } else if (userRole === "customer") {
      const ordersWithShopDetails = await Promise.all(
        fetchedOrders.map(async (order) => {
          if (order.items && order.items.length > 0 && order.items[0].shopId) {
            const shopDoc = await firestore
              .collection("shops")
              .doc(order.items[0].shopId)
              .get();
            if (shopDoc.exists) {
              const shopData = shopDoc.data();
              order.shopRingkas = {
                shopName: shopData.shopName || null,
              };
            }
          }
          return order;
        })
      );
      fetchedOrders = ordersWithShopDetails;
    }

    return handleSuccess(
      res,
      200,
      "Daftar pesanan berhasil diambil.",
      fetchedOrders
    );
  } catch (error) {
    console.error("Error getting orders list:", error);
    return handleError(res, {
      statusCode: 500,
      message: "Gagal mengambil daftar pesanan.",
      detail: error.message,
    });
  }
};
