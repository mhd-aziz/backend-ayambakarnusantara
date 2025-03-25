const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const midtransClient = require("midtrans-client");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

// Inisialisasi Midtrans Client (Sandbox Mode)
const snap = new midtransClient.Snap({
  isProduction: false, // Selalu gunakan sandbox untuk pengembangan
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

// Fungsi helper untuk menghasilkan orderNumber unik
const generateOrderNumber = () => {
  const timestamp = Date.now().toString();
  const randomPart = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `ORD${timestamp}${randomPart}`;
};

// Fungsi helper untuk menghasilkan kode pickup
const generatePickupCode = () => {
  return Math.floor(10000 + Math.random() * 90000).toString();
};

/**
 * Create new order from cart
 */
exports.createOrder = async (req, res) => {
  const { id, role } = req.auth;
  const {
    paymentMethod,
    pickupMethod = "STANDARD",
    pickupTime,
    customerName,
    customerPhone,
    notes,
  } = req.body;

  if (role !== "user") {
    return res.status(403).json({ message: "Access forbidden. Not a user." });
  }

  try {
    // Mengambil data cart user
    const cart = await prisma.cart.findUnique({
      where: { userId: id },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                price: true,
                photoProduct: true,
                stock: true,
                shopId: true,
                shop: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
        user: {
          select: {
            fullName: true,
            email: true,
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: "Your cart is empty." });
    }

    // Memeriksa stok dan menghitung total
    let subTotal = 0;
    const stockIssues = [];
    const orderItems = [];

    // Menginisialisasi shopId, akan dicek untuk semua item
    let currentShopId = null;

    // Grup produk berdasarkan toko
    const shopProducts = {};

    for (const item of cart.items) {
      if (item.quantity > item.product.stock) {
        stockIssues.push({
          productId: item.product.id,
          productName: item.product.name,
          requestedQuantity: item.quantity,
          availableStock: item.product.stock,
        });
        continue;
      }

      const itemSubtotal = item.product.price * item.quantity;
      subTotal += itemSubtotal;

      // Semua item harus dari toko yang sama
      if (currentShopId === null) {
        currentShopId = item.product.shopId;
      } else if (currentShopId !== item.product.shopId) {
        return res.status(400).json({
          message: "All items in an order must be from the same shop.",
        });
      }

      // Mengumpulkan data untuk orderItems
      orderItems.push({
        productId: item.product.id,
        quantity: item.quantity,
        priceAtPurchase: item.product.price,
        subtotal: itemSubtotal,
        productName: item.product.name,
        productImage: item.product.photoProduct,
      });

      // Mengelompokkan produk berdasarkan toko
      const shopId = item.product.shopId;
      if (!shopProducts[shopId]) {
        shopProducts[shopId] = {
          shopId: shopId,
          shopName: item.product.shop.name,
          items: [],
        };
      }

      shopProducts[shopId].items.push({
        id: item.product.id,
        name: item.product.name,
        price: item.product.price,
        quantity: item.quantity,
        subtotal: itemSubtotal,
      });
    }

    if (stockIssues.length > 0) {
      return res.status(400).json({
        message: "Some items in your cart have stock issues.",
        stockIssues,
      });
    }

    if (currentShopId === null) {
      return res.status(400).json({ message: "No valid items in cart." });
    }

    // Hitung total dengan pajak dan biaya layanan (jika ada)
    const tax = subTotal * 0.1; // Contoh: 10% pajak
    const serviceFee = 5000; // Contoh: biaya layanan tetap
    const total = subTotal + tax + serviceFee;

    // Buat order number unik
    const orderNumber = generateOrderNumber();
    const pickupCode = generatePickupCode();

    // Buat pesanan baru
    const order = await prisma.order.create({
      data: {
        userId: id,
        orderNumber,
        shopId: currentShopId, // Gunakan shopId yang telah divalidasi
        subTotal,
        tax,
        serviceFee,
        total,
        status: paymentMethod === "CASH_ON_PICKUP" ? "PENDING" : "PENDING",
        paymentMethod,
        paymentStatus:
          paymentMethod === "CASH_ON_PICKUP"
            ? "PENDING"
            : "WAITING_FOR_PAYMENT",
        pickupMethod,
        pickupTime: pickupTime ? new Date(pickupTime) : null,
        pickupCode,
        customerName: customerName || cart.user.fullName || "",
        customerPhone: customerPhone || "",
        notes,
        orderItems: {
          create: orderItems,
        },
      },
      include: {
        orderItems: true,
      },
    });

    // Jika pembayaran tunai saat pengambilan
    if (paymentMethod === "CASH_ON_PICKUP") {
      // Update stok produk
      for (const item of cart.items) {
        await prisma.product.update({
          where: { id: item.product.id },
          data: { stock: { decrement: item.quantity } },
        });
      }

      // Kosongkan keranjang
      await prisma.cartItem.deleteMany({
        where: { cartId: cart.id },
      });

      return res.status(201).json({
        message:
          "Order created successfully with Cash on Pickup payment method.",
        order,
        paymentType: "cash_on_pickup",
      });
    }

    // Untuk metode pembayaran lain, siapkan Midtrans
    let paymentType;
    switch (paymentMethod) {
      case "BANK_TRANSFER":
        paymentType = "bank_transfer";
        break;
      case "CREDIT_CARD":
        paymentType = "credit_card";
        break;
      case "E_WALLET":
        paymentType = "gopay";
        break;
      case "VIRTUAL_ACCOUNT":
        paymentType = "bank_transfer";
        break;
      case "RETAIL_OUTLET":
        paymentType = "cstore";
        break;
      case "QRIS":
        paymentType = "qris";
        break;
      default:
        paymentType = "bank_transfer";
    }

    // Format item untuk Midtrans
    const itemDetails = cart.items.map((item) => ({
      id: item.product.id.toString(),
      price: item.product.price,
      quantity: item.quantity,
      name: item.product.name.substring(0, 50), // Midtrans membatasi panjang nama
    }));

    // Tambahkan pajak dan biaya layanan ke item details
    if (tax) {
      itemDetails.push({
        id: "TAX",
        price: tax,
        quantity: 1,
        name: "Tax",
      });
    }

    if (serviceFee) {
      itemDetails.push({
        id: "SERVICE",
        price: serviceFee,
        quantity: 1,
        name: "Service Fee",
      });
    }

    // Siapkan parameter transaksi Midtrans
    const transactionDetails = {
      transaction_details: {
        order_id: orderNumber,
        gross_amount: total,
      },
      customer_details: {
        first_name: customerName || cart.user.fullName || "Guest",
        email: cart.user.email || "guest@example.com",
        phone: customerPhone || "",
      },
      item_details: itemDetails,
      callbacks: {
        finish: `${process.env.FRONTEND_URL}/order/status/${order.id}`,
      },
    };

    // Jika metode pembayaran spesifik
    if (paymentMethod === "VIRTUAL_ACCOUNT") {
      transactionDetails.payment_type = "bank_transfer";
      transactionDetails.bank_transfer = {
        bank: "bca",
      };
    } else if (paymentMethod === "E_WALLET") {
      transactionDetails.payment_type = "gopay";
    } else if (paymentMethod === "RETAIL_OUTLET") {
      transactionDetails.payment_type = "cstore";
      transactionDetails.cstore = {
        store: "alfamart",
      };
    }

    // Buat transaksi di Midtrans
    const midtransResponse = await snap.createTransaction(transactionDetails);

    // Update order dengan token dan URL dari Midtrans
    const updatedOrder = await prisma.order.update({
      where: { id: order.id },
      data: {
        snapToken: midtransResponse.token,
        snapUrl: midtransResponse.redirect_url,
      },
    });

    // Kosongkan keranjang
    await prisma.cartItem.deleteMany({
      where: { cartId: cart.id },
    });

    res.status(201).json({
      message: "Order created successfully",
      order: updatedOrder,
      payment: {
        token: midtransResponse.token,
        redirectUrl: midtransResponse.redirect_url,
        paymentType,
      },
    });
  } catch (error) {
    console.error("Create order error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get user orders
 */
exports.getUserOrders = async (req, res) => {
  const { id, role } = req.auth;
  const { status, page = 1, limit = 10 } = req.query;

  if (role !== "user") {
    return res.status(403).json({ message: "Access forbidden. Not a user." });
  }

  try {
    const parsedPage = parseInt(page, 10);
    const parsedLimit = parseInt(limit, 10);
    const skip = (parsedPage - 1) * parsedLimit;

    // Buat filter berdasarkan status jika ada
    const where = { userId: id };
    if (status) {
      where.status = status;
    }

    // Hitung total pesanan
    const totalOrders = await prisma.order.count({ where });

    // Dapatkan pesanan
    const orders = await prisma.order.findMany({
      where,
      include: {
        orderItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                photoProduct: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: parsedLimit,
    });

    res.status(200).json({
      orders,
      pagination: {
        total: totalOrders,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(totalOrders / parsedLimit),
      },
    });
  } catch (error) {
    console.error("Get user orders error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get order details
 */
exports.getOrderDetails = async (req, res) => {
  const { id, role } = req.auth;
  const { orderId } = req.params;

  try {
    const order = await prisma.order.findUnique({
      where: { id: parseInt(orderId, 10) },
      include: {
        orderItems: true,
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    // Verifikasi akses
    if (role === "user" && order.userId !== id) {
      return res
        .status(403)
        .json({ message: "You don't have permission to view this order." });
    }

    if (role === "admin") {
      // Verifikasi admin toko
      const shop = await prisma.shop.findUnique({
        where: { adminId: id },
      });

      if (!shop || shop.id !== order.shopId) {
        return res
          .status(403)
          .json({ message: "You don't have permission to view this order." });
      }
    }

    res.status(200).json(order);
  } catch (error) {
    console.error("Get order details error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Update order status (for admin)
 */
exports.updateOrderStatus = async (req, res) => {
  const { id, role } = req.auth;
  const { orderId } = req.params;
  const { status } = req.body;

  if (role !== "admin") {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  if (!status) {
    return res.status(400).json({ message: "Status is required." });
  }

  try {
    const order = await prisma.order.findUnique({
      where: { id: parseInt(orderId, 10) },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    // Verifikasi admin toko
    const shop = await prisma.shop.findUnique({
      where: { adminId: id },
    });

    if (!shop || shop.id !== order.shopId) {
      return res
        .status(403)
        .json({ message: "You don't have permission to update this order." });
    }

    // Data untuk update
    const updateData = { status };

    // Tambahkan timestamp sesuai status
    switch (status) {
      case "PREPARATION":
        updateData.preparationAt = new Date();
        break;
      case "READY":
        updateData.readyAt = new Date();
        break;
      case "COMPLETED":
        updateData.completedAt = new Date();
        break;
      case "CANCELLED":
        updateData.cancelledAt = new Date();
        // Kembalikan stok jika dibatalkan
        const orderItems = await prisma.orderItem.findMany({
          where: { orderId: order.id },
        });
        for (const item of orderItems) {
          await prisma.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
        }
        break;
    }

    // Update status pesanan
    const updatedOrder = await prisma.order.update({
      where: { id: order.id },
      data: updateData,
    });

    res.status(200).json({
      message: "Order status updated successfully",
      order: updatedOrder,
    });
  } catch (error) {
    console.error("Update order status error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Cancel order (for user)
 */
exports.cancelOrder = async (req, res) => {
  const { id, role } = req.auth;
  const { orderId } = req.params;

  if (role !== "user") {
    return res.status(403).json({ message: "Access forbidden. Not a user." });
  }

  try {
    const order = await prisma.order.findUnique({
      where: { id: parseInt(orderId, 10) },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    if (order.userId !== id) {
      return res
        .status(403)
        .json({ message: "You don't have permission to cancel this order." });
    }

    // Cek apakah pesanan masih bisa dibatalkan
    if (!["PENDING", "WAITING_FOR_PAYMENT"].includes(order.status)) {
      return res
        .status(400)
        .json({ message: "Order cannot be cancelled at this stage." });
    }

    // Kembalikan stok produk
    const orderItems = await prisma.orderItem.findMany({
      where: { orderId: order.id },
    });

    for (const item of orderItems) {
      await prisma.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      });
    }

    // Update status pesanan
    const updatedOrder = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
      },
    });

    res.status(200).json({
      message: "Order cancelled successfully",
      order: updatedOrder,
    });
  } catch (error) {
    console.error("Cancel order error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get shop orders (for admin)
 */
exports.getShopOrders = async (req, res) => {
  const { id, role } = req.auth;
  const { status, page = 1, limit = 10 } = req.query;

  if (role !== "admin") {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  try {
    // Dapatkan toko admin
    const shop = await prisma.shop.findUnique({
      where: { adminId: id },
    });

    if (!shop) {
      return res.status(404).json({ message: "Shop not found." });
    }

    const parsedPage = parseInt(page, 10);
    const parsedLimit = parseInt(limit, 10);
    const skip = (parsedPage - 1) * parsedLimit;

    // Buat filter berdasarkan status jika ada
    const where = { shopId: shop.id };
    if (status) {
      where.status = status;
    }

    // Hitung total pesanan
    const totalOrders = await prisma.order.count({ where });

    // Dapatkan pesanan
    const orders = await prisma.order.findMany({
      where,
      include: {
        orderItems: true,
        user: {
          select: {
            username: true,
            email: true,
            fullName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: parsedLimit,
    });

    res.status(200).json({
      orders,
      pagination: {
        total: totalOrders,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(totalOrders / parsedLimit),
      },
    });
  } catch (error) {
    console.error("Get shop orders error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Handle Midtrans payment notification
 */
exports.handlePaymentNotification = async (req, res) => {
  try {
    let notification = req.body;

    // Verifikasi signature dari Midtrans
    const orderId = notification.order_id;
    const statusCode = notification.status_code;
    const grossAmount = notification.gross_amount;
    const serverKey = process.env.MIDTRANS_SERVER_KEY;
    const signature = notification.signature_key;

    const stringToSign = `${orderId}${statusCode}${grossAmount}${serverKey}`;
    const expectedSignature = crypto
      .createHash("sha512")
      .update(stringToSign)
      .digest("hex");

    if (signature !== expectedSignature) {
      return res.status(403).json({ message: "Invalid signature" });
    }

    // Proses berdasarkan status transaksi
    let orderUpdateData = {
      callbackData: JSON.stringify(notification),
    };

    // Temukan pesanan berdasarkan order_id
    const order = await prisma.order.findUnique({
      where: { orderNumber: orderId },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Update status pembayaran
    switch (notification.transaction_status) {
      case "capture":
      case "settlement":
        orderUpdateData.paymentStatus = "PAID";
        orderUpdateData.status = "PREPARATION";
        orderUpdateData.paidAt = new Date();
        orderUpdateData.preparationAt = new Date();
        orderUpdateData.transactionId = notification.transaction_id;

        // Kurangi stok produk karena pembayaran berhasil
        const orderItems = await prisma.orderItem.findMany({
          where: { orderId: order.id },
        });

        for (const item of orderItems) {
          await prisma.product.update({
            where: { id: item.productId },
            data: { stock: { decrement: item.quantity } },
          });
        }
        break;

      case "deny":
      case "cancel":
      case "expire":
        orderUpdateData.paymentStatus =
          notification.transaction_status === "expire" ? "EXPIRED" : "FAILED";
        orderUpdateData.status = "CANCELLED";
        orderUpdateData.cancelledAt = new Date();
        break;

      case "pending":
        orderUpdateData.paymentStatus = "PENDING";
        break;

      default:
        orderUpdateData.paymentStatus = "PENDING";
    }

    // Update pesanan
    await prisma.order.update({
      where: { id: order.id },
      data: orderUpdateData,
    });

    // Kirim respons ke Midtrans
    res.status(200).json({ status: "OK" });
  } catch (error) {
    console.error("Payment notification error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
