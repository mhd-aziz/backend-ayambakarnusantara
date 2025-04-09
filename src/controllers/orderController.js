const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const midtransClient = require("midtrans-client");

// Initialize Midtrans Snap client
const snap = new midtransClient.Snap({
  isProduction: false, // Set to true for production
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

// Create a new order from cart
exports.createOrder = async (req, res) => {
  const { id, role } = req.auth;

  if (role !== "user") {
    return res.status(403).json({ message: "Access forbidden. Not a user." });
  }

  try {
    const userId = parseInt(id);
    if (isNaN(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    // Get user with address and phone info for shipping
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Get user's cart with items
    const cart = await prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: "Cart is empty" });
    }

    // Calculate total amount
    let totalAmount = 0;
    for (const item of cart.items) {
      totalAmount += item.product.price * item.quantity;
    }

    // Begin transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create order
      const order = await tx.order.create({
        data: {
          userId, // Relasi otomatis dengan userId
          totalAmount: Math.round(totalAmount), // Midtrans requires integer amounts
          status: "pending",
          orderItems: {
            create: cart.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              price: item.product.price,
            })),
          },
        },
        include: {
          orderItems: {
            include: {
              product: true,
            },
          },
        },
      });

      // Create payment record
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          amount: Math.round(totalAmount), // Midtrans requires integer amounts
          status: "pending",
        },
      });

      // Clear cart
      await tx.cartItem.deleteMany({
        where: { cartId: cart.id },
      });

      return { order, payment };
    });

    // Create Midtrans Snap token
    const orderId = `ORDER-${result.order.id}-${Date.now()}`;

    const parameter = {
      transaction_details: {
        order_id: orderId,
        gross_amount: Math.round(result.order.totalAmount),
      },
      customer_details: {
        first_name: user.fullName || user.username || "",
        email: user.email,
        phone: user.phoneNumber || "",
      },
      item_details: result.order.orderItems.map((item) => ({
        id: item.productId.toString(),
        price: Math.round(item.price),
        quantity: item.quantity,
        name: item.product.name,
      })),
      callbacks: {
        finish: `${process.env.FRONTEND_URL}/order/finish?order_id=${result.order.id}`,
        error: `${process.env.FRONTEND_URL}/order/error?order_id=${result.order.id}`,
        pending: `${process.env.FRONTEND_URL}/order/pending?order_id=${result.order.id}`,
      },
    };

    const snapToken = await snap.createTransaction(parameter);

    // Update payment with snapToken and transaction ID
    await prisma.payment.update({
      where: { id: result.payment.id },
      data: {
        snapToken: snapToken.token,
        transactionId: orderId,
      },
    });

    res.status(201).json({
      order: result.order,
      payment: {
        ...result.payment,
        snapToken: snapToken.token,
        transactionId: orderId,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message || "Server error" });
  }
};

// Get all orders for a user
exports.getUserOrders = async (req, res) => {
  const { id, role } = req.auth;

  if (role !== "user") {
    return res.status(403).json({ message: "Access forbidden. Not a user." });
  }

  try {
    const userId = parseInt(id);
    if (isNaN(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const orders = await prisma.order.findMany({
      where: { userId },
      include: {
        payment: true,
        orderItems: {
          include: {
            product: {
              select: {
                name: true,
                photoProduct: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.status(200).json(orders);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get order details
exports.getOrderDetails = async (req, res) => {
  const { id, role } = req.auth;
  const { orderId } = req.params;

  try {
    const userId = parseInt(id);
    const orderIdInt = parseInt(orderId);

    if (isNaN(userId) || isNaN(orderIdInt)) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderIdInt },
      include: {
        orderItems: {
          include: {
            product: true,
          },
        },
        payment: true,
        user: {
          select: {
            username: true,
            fullName: true,
            email: true,
            phoneNumber: true,
            address: true,
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Check if user is authorized to view this order
    if (role === "user" && order.userId !== userId) {
      return res
        .status(403)
        .json({ message: "Not authorized to view this order" });
    }

    res.status(200).json(order);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Cancel an order
exports.cancelOrder = async (req, res) => {
  const { id, role } = req.auth;
  const { orderId } = req.params;

  try {
    const userId = parseInt(id);
    const orderIdInt = parseInt(orderId);

    if (isNaN(userId) || isNaN(orderIdInt)) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderIdInt },
      include: {
        orderItems: true,
        payment: true,
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Check if user is authorized to cancel this order
    if (role === "user" && order.userId !== userId) {
      return res
        .status(403)
        .json({ message: "Not authorized to cancel this order" });
    }

    // Check if order can be cancelled
    if (order.status !== "pending") {
      return res
        .status(400)
        .json({ message: "Cannot cancel order that is not pending" });
    }

    // If payment exists and has a transaction in Midtrans, cancel it
    if (order.payment && order.payment.transactionId) {
      try {
        await snap.cancel(order.payment.transactionId);
      } catch (midtransError) {
        console.error("Midtrans cancellation error:", midtransError);
        // Continue with local cancellation even if Midtrans fails
      }
    }

    // Begin transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update order status
      const updatedOrder = await tx.order.update({
        where: { id: orderIdInt },
        data: { status: "cancelled" },
      });

      // Update payment status if exists
      if (order.payment) {
        await tx.payment.update({
          where: { id: order.payment.id },
          data: { status: "cancel" },
        });
      }

      // Restore product stock
      for (const item of order.orderItems) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
        });

        await tx.product.update({
          where: { id: item.productId },
          data: { stock: product.stock + item.quantity },
        });
      }

      return updatedOrder;
    });

    res.status(200).json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get payment status from Midtrans
exports.getPaymentStatus = async (req, res) => {
  const { id, role } = req.auth;
  const { orderId } = req.params;

  try {
    const userId = parseInt(id);
    const orderIdInt = parseInt(orderId);

    if (isNaN(userId) || isNaN(orderIdInt)) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderIdInt },
      include: {
        payment: true,
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Check if user is authorized to view this order
    if (role === "user" && order.userId !== userId) {
      return res
        .status(403)
        .json({ message: "Not authorized to view this order" });
    }

    if (!order.payment || !order.payment.transactionId) {
      return res
        .status(400)
        .json({ message: "No payment found for this order" });
    }

    try {
      // Get status from Midtrans
      const transactionStatus = await snap.transaction.status(
        order.payment.transactionId
      );
      res.status(200).json(transactionStatus);
    } catch (midtransError) {
      // Handle case where transaction doesn't exist in Midtrans
      console.error("Midtrans status error:", midtransError);

      // Return payment data from database instead
      res.status(200).json({
        order_id: order.payment.transactionId,
        transaction_status: "not_found",
        message:
          "Transaction not found in Midtrans. You may need to retry payment.",
        payment_details: order.payment,
      });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Webhook handler for Midtrans notifications
exports.handleMidtransNotification = async (req, res) => {
  try {
    // Log the raw request information for debugging
    console.log("==== WEBHOOK REQUEST RECEIVED ====");
    console.log("Headers:", JSON.stringify(req.headers));
    console.log("Body:", JSON.stringify(req.body));

    // Get the notification data
    const notification = req.body || {};

    // For manual testing (when calling the endpoint directly)
    // Check if there's a transaction_id or order_id in the notification
    // If not, just return OK to acknowledge
    if (!notification.transaction_id && !notification.order_id) {
      console.log(
        "No transaction_id or order_id in notification, this may be a test ping"
      );
      return res.status(200).json({
        status: "OK",
        message: "Received webhook ping",
      });
    }

    // Extract order_id directly from notification if possible
    const orderId = notification.order_id || notification.transaction_id;

    // If we have an order ID, try to find the corresponding payment
    if (orderId) {
      console.log(`Looking for payment with transaction ID: ${orderId}`);

      const payment = await prisma.payment.findFirst({
        where: { transactionId: orderId },
        include: { order: true },
      });

      if (payment) {
        console.log(
          `Found payment ID: ${payment.id} for order ID: ${payment.orderId}`
        );

        // We found the payment, now let's try to update its status based on the notification

        // Order status values from schema: "pending", "paid", "cancelled"
        let orderStatus = payment.order.status;

        // Payment status values: "pending", "settlement", "deny", "cancel", "expire", "challenge"
        let paymentStatus = payment.status;

        // Status order values from schema: "pending", "proses", "ready", "delivered"
        let statusOrder = payment.statusOrder;

        // Try to determine status from notification
        if (notification.transaction_status) {
          const txStatus = notification.transaction_status;

          if (txStatus === "settlement" || txStatus === "capture") {
            paymentStatus = "settlement";
            orderStatus = "paid";
            statusOrder = "proses"; // When payment is settled, start processing
          } else if (txStatus === "deny") {
            paymentStatus = "deny";
            // Keep order as pending so user can retry
            orderStatus = "pending";
            statusOrder = "cancel";
          } else if (txStatus === "cancel" || txStatus === "expire") {
            paymentStatus = txStatus;
            orderStatus = "cancelled";
            statusOrder = "cancel";
          } else if (txStatus === "pending") {
            paymentStatus = "pending";
            orderStatus = "pending";
            statusOrder = "pending";
          } else {
            // For any other status, just use the status as is
            paymentStatus = txStatus;
          }

          console.log(
            `Determined status: payment=${paymentStatus}, order=${orderStatus}, delivery=${statusOrder}`
          );

          // Update payment and order
          await prisma.$transaction([
            prisma.payment.update({
              where: { id: payment.id },
              data: {
                status: paymentStatus,
                statusOrder: statusOrder,
                paymentType: notification.payment_type || payment.paymentType,
                vaNumber:
                  notification.va_numbers && notification.va_numbers[0]
                    ? notification.va_numbers[0].va_number
                    : payment.vaNumber,
              },
            }),
            prisma.order.update({
              where: { id: payment.orderId },
              data: { status: orderStatus },
            }),
          ]);

          console.log(`Successfully updated payment and order status`);
        } else {
          console.log(`No transaction_status in notification, skipping update`);
        }
      } else {
        console.log(`No payment found with transaction ID: ${orderId}`);
      }
    }

    // Always respond with 200 OK to acknowledge the webhook
    return res.status(200).json({ status: "OK" });
  } catch (error) {
    console.error("Webhook handler error:", error);
    // Always return 200 OK to prevent Midtrans from retrying
    return res.status(200).json({
      status: "OK",
      message: "Error processing notification, but acknowledged",
      error_details: error.message,
    });
  }
};

// Get client key for frontend
exports.getMidtransClientKey = async (req, res) => {
  try {
    res.status(200).json({ clientKey: process.env.MIDTRANS_CLIENT_KEY });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Retry payment for an order
exports.retryPayment = async (req, res) => {
  const { id, role } = req.auth;
  const { orderId } = req.params;

  if (role !== "user") {
    return res.status(403).json({ message: "Access forbidden. Not a user." });
  }

  try {
    const userId = parseInt(id);
    const orderIdInt = parseInt(orderId);

    if (isNaN(userId) || isNaN(orderIdInt)) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderIdInt },
      include: {
        orderItems: {
          include: {
            product: true,
          },
        },
        payment: true,
        user: true,
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (order.userId !== userId) {
      return res
        .status(403)
        .json({ message: "Not authorized to access this order" });
    }

    if (order.status === "paid") {
      return res.status(400).json({ message: "Order is already paid" });
    }

    // Create new transaction in Midtrans
    const newOrderId = `ORDER-${order.id}-${Date.now()}`;

    const parameter = {
      transaction_details: {
        order_id: newOrderId,
        gross_amount: Math.round(order.totalAmount),
      },
      customer_details: {
        first_name: order.user.fullName || order.user.username,
        email: order.user.email,
        phone: order.user.phoneNumber || "",
      },
      item_details: order.orderItems.map((item) => ({
        id: item.productId.toString(),
        price: Math.round(item.price),
        quantity: item.quantity,
        name: item.product.name,
      })),
      callbacks: {
        finish: `${process.env.FRONTEND_URL}/order/finish?order_id=${order.id}`,
        error: `${process.env.FRONTEND_URL}/order/error?order_id=${order.id}`,
        pending: `${process.env.FRONTEND_URL}/order/pending?order_id=${order.id}`,
      },
    };

    const snapToken = await snap.createTransaction(parameter);

    // Update payment with new snapToken and transaction ID
    await prisma.payment.update({
      where: { id: order.payment.id },
      data: {
        snapToken: snapToken.token,
        transactionId: newOrderId,
        status: "pending",
        statusOrder: "pending", // Reset statusOrder to pending
        paymentType: null,
        vaNumber: null,
      },
    });

    res.status(200).json({
      message: "Payment retrieval successful",
      order: order,
      snapToken: snapToken.token,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get all orders for admin's shop
exports.getAllOrders = async (req, res) => {
  const { id, role } = req.auth;

  if (role !== "admin") {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  try {
    const adminId = parseInt(id);
    if (isNaN(adminId)) {
      return res.status(400).json({ message: "Invalid admin ID" });
    }

    // Find the shop associated with this admin
    const shop = await prisma.shop.findUnique({
      where: { adminId },
    });

    if (!shop) {
      return res.status(404).json({ message: "Shop not found for this admin" });
    }

    // Get all products from this shop
    const shopProducts = await prisma.product.findMany({
      where: { shopId: shop.id },
      select: { id: true },
    });

    const productIds = shopProducts.map((product) => product.id);

    // Find orders that contain products from this shop
    const orders = await prisma.order.findMany({
      where: {
        orderItems: {
          some: {
            productId: { in: productIds },
          },
        },
      },
      include: {
        user: {
          select: {
            username: true,
            email: true,
            fullName: true,
            phoneNumber: true,
            address: true,
          },
        },
        payment: true,
        orderItems: {
          include: {
            product: {
              select: {
                name: true,
                photoProduct: true,
                price: true,
                shopId: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.status(200).json(orders);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get order statistics for admin's shop only
exports.getOrderStatistics = async (req, res) => {
  const { id, role } = req.auth;

  if (role !== "admin") {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  try {
    const adminId = parseInt(id);
    if (isNaN(adminId)) {
      return res.status(400).json({ message: "Invalid admin ID" });
    }

    // Find the shop associated with this admin
    const shop = await prisma.shop.findUnique({
      where: { adminId },
    });

    if (!shop) {
      return res.status(404).json({ message: "Shop not found for this admin" });
    }

    // Get all products from this shop
    const shopProducts = await prisma.product.findMany({
      where: { shopId: shop.id },
      select: { id: true },
    });

    const productIds = shopProducts.map((product) => product.id);

    // Base where clause for orders containing products from this shop
    const baseWhereClause = {
      orderItems: {
        some: {
          productId: { in: productIds },
        },
      },
    };

    // Get total number of orders
    const totalOrders = await prisma.order.count({
      where: baseWhereClause,
    });

    // Find orders IDs with products from this shop
    const shopOrderIds = await prisma.orderItem.findMany({
      where: {
        productId: { in: productIds },
      },
      distinct: ["orderId"],
      select: {
        orderId: true,
      },
    });

    const orderIds = shopOrderIds.map((item) => item.orderId);

    // Completed orders (paid, delivered, settlement)
    const completedOrders = await prisma.payment.count({
      where: {
        orderId: { in: orderIds },
        statusOrder: { in: ["paid", "delivered", "settlement"] },
      },
    });

    // Pending orders (pending, proses, ready)
    const pendingOrders = await prisma.payment.count({
      where: {
        orderId: { in: orderIds },
        statusOrder: { in: ["pending", "proses", "ready"] },
      },
    });

    // Cancelled orders
    const cancelledOrders = await prisma.payment.count({
      where: {
        orderId: { in: orderIds },
        statusOrder: { in: ["cancelled", "cancel"] },
      },
    });

    // Calculate total revenue from completed orders
    const completedPayments = await prisma.payment.findMany({
      where: {
        orderId: { in: orderIds },
        statusOrder: { in: ["paid", "delivered", "settlement"] },
      },
      select: {
        amount: true,
      },
    });

    const totalRevenue = completedPayments.reduce(
      (sum, payment) => sum + payment.amount,
      0
    );

    // Get recent orders
    const recentOrders = await prisma.order.findMany({
      where: {
        id: { in: orderIds },
      },
      take: 5,
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            username: true,
            fullName: true,
          },
        },
        payment: true,
        orderItems: {
          include: {
            product: {
              select: {
                name: true,
                photoProduct: true,
                price: true,
              },
            },
          },
        },
      },
    });

    // Get counts by status
    const statusCounts = await prisma.payment.groupBy({
      by: ["statusOrder"],
      where: {
        orderId: { in: orderIds },
      },
      _count: {
        statusOrder: true,
      },
    });

    // Format status counts to a more usable structure
    const formattedStatusCounts = statusCounts.map((item) => ({
      status: item.statusOrder,
      count: item._count.statusOrder,
    }));

    res.status(200).json({
      totalOrders,
      completedOrders,
      pendingOrders,
      cancelledOrders,
      totalRevenue,
      recentOrders,
      statusCounts: formattedStatusCounts,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get payment status (Admin)
exports.getPaymentStatusAdmin = async (req, res) => {
  const { id, role } = req.auth;
  const { paymentId } = req.params;

  if (role !== "admin") {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  try {
    const adminId = parseInt(id);
    if (isNaN(adminId)) {
      return res.status(400).json({ message: "Invalid admin ID" });
    }

    // Find the shop associated with this admin
    const shop = await prisma.shop.findUnique({
      where: { adminId },
    });

    if (!shop) {
      return res.status(404).json({ message: "Shop not found for this admin" });
    }

    // Find payment and check if it belongs to an order containing products from admin's shop
    const payment = await prisma.payment.findUnique({
      where: { id: parseInt(paymentId) },
      include: {
        order: {
          include: {
            user: {
              select: {
                username: true,
                fullName: true,
                email: true,
              },
            },
            orderItems: {
              include: {
                product: {
                  select: {
                    shopId: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    // Check if any product in this order belongs to the admin's shop
    const hasShopProduct = payment.order.orderItems.some(
      (item) => item.product.shopId === shop.id
    );

    if (!hasShopProduct) {
      return res.status(403).json({
        message:
          "Access forbidden. This payment is not associated with your shop.",
      });
    }

    // Try to get status from Midtrans for the most up-to-date information
    try {
      const midtransStatus = await snap.transaction.status(
        payment.transactionId
      );
      // Update local database if status has changed
      if (midtransStatus.transaction_status !== payment.status) {
        await updatePaymentAndOrderStatus(payment.id, midtransStatus);
      }

      res.status(200).json({
        payment,
        midtransStatus,
      });
    } catch (midtransError) {
      // If Midtrans call fails, return local data only
      res.status(200).json({
        payment,
        midtransStatus: { error: "Could not fetch from Midtrans" },
      });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Update order status (Admin only)
exports.updateOrderStatus = async (req, res) => {
  const { id, role } = req.auth;
  const { orderId } = req.params;
  const { statusOrder } = req.body;

  if (role !== "admin") {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  // Validate status
  const validStatuses = ["pending", "proses", "ready", "delivered", "cancel"];
  if (!validStatuses.includes(statusOrder)) {
    return res.status(400).json({
      message:
        "Invalid status. Must be one of: pending, proses, ready, delivered, cancel",
    });
  }

  try {
    const adminId = parseInt(id);
    if (isNaN(adminId)) {
      return res.status(400).json({ message: "Invalid admin ID" });
    }

    // Find the shop associated with this admin
    const shop = await prisma.shop.findUnique({
      where: { adminId },
    });

    if (!shop) {
      return res.status(404).json({ message: "Shop not found for this admin" });
    }

    const orderIdInt = parseInt(orderId);
    if (isNaN(orderIdInt)) {
      return res.status(400).json({ message: "Invalid order ID" });
    }

    // Get the order with payment and orderItems to check shop association
    const order = await prisma.order.findUnique({
      where: { id: orderIdInt },
      include: {
        payment: true,
        orderItems: {
          include: {
            product: {
              select: {
                shopId: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (!order.payment) {
      return res
        .status(404)
        .json({ message: "Payment not found for this order" });
    }

    // Check if any product in this order belongs to the admin's shop
    const hasShopProduct = order.orderItems.some(
      (item) => item.product.shopId === shop.id
    );

    if (!hasShopProduct) {
      return res.status(403).json({
        message:
          "Access forbidden. This order is not associated with your shop.",
      });
    }

    // Update the statusOrder in payment
    const updatedPayment = await prisma.payment.update({
      where: { id: order.payment.id },
      data: { statusOrder },
    });

    res.status(200).json({
      message: "Order status updated successfully",
      payment: updatedPayment,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get orders by status for admin's shop only
exports.getOrdersByStatus = async (req, res) => {
  const { id, role } = req.auth;
  const { status } = req.query; // Get status from query parameter

  if (role !== "admin") {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  try {
    const adminId = parseInt(id);
    if (isNaN(adminId)) {
      return res.status(400).json({ message: "Invalid admin ID" });
    }

    // Find the shop associated with this admin
    const shop = await prisma.shop.findUnique({
      where: { adminId },
    });

    if (!shop) {
      return res.status(404).json({ message: "Shop not found for this admin" });
    }

    // Get all products from this shop
    const shopProducts = await prisma.product.findMany({
      where: { shopId: shop.id },
      select: { id: true },
    });

    const productIds = shopProducts.map((product) => product.id);

    let whereClause = {
      orderItems: {
        some: {
          productId: { in: productIds },
        },
      },
    };

    // Add status filter if provided
    if (status) {
      whereClause.payment = {
        statusOrder: status,
      };
    }

    // Find orders that contain products from this shop and match the status filter
    const orders = await prisma.order.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            username: true,
            email: true,
            fullName: true,
            phoneNumber: true,
            address: true,
          },
        },
        payment: true,
        orderItems: {
          include: {
            product: {
              select: {
                name: true,
                photoProduct: true,
                price: true,
                shopId: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.status(200).json(orders);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Helper function to update payment and order status
async function updatePaymentAndOrderStatus(paymentId, midtransStatus) {
  const txStatus = midtransStatus.transaction_status;
  let paymentStatus = txStatus;
  let orderStatus = "pending";
  let statusOrder = "pending";

  if (txStatus === "settlement") {
    orderStatus = "paid";
    statusOrder = "proses";
  } else if (
    txStatus === "cancel" ||
    txStatus === "deny" ||
    txStatus === "expire"
  ) {
    orderStatus = "cancelled";
    statusOrder = "cancel"; // Added cancel status here
  }

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { order: true },
  });

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: paymentStatus,
        statusOrder: statusOrder, // Added statusOrder update
        paymentType: midtransStatus.payment_type,
        vaNumber: midtransStatus.va_numbers?.[0]?.va_number || null,
      },
    }),
    prisma.order.update({
      where: { id: payment.orderId },
      data: { status: orderStatus },
    }),
  ]);

  return { paymentStatus, orderStatus, statusOrder };
}
