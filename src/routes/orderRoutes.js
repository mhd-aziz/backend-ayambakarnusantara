const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const authHandler = require("../middlewares/authHandler");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });

// --- User Routes ---

// Create new order
router.post("/user/orders", authHandler, orderController.createOrder);

// Get user orders with pagination and filtering
router.get("/user/orders", authHandler, orderController.getUserOrders);

// Get order details
router.get(
  "/user/order/:orderId",
  authHandler,
  orderController.getOrderDetails
);

// Cancel order (only for pending or waiting for payment)
router.post(
  "/user/order/:orderId/cancel",
  authHandler,
  orderController.cancelOrder
);

// Retry payment for an order
router.post(
  "/user/order/:orderId/retry-payment",
  authHandler,
  orderController.retryPayment
);

// Get payment status from Midtrans
router.get(
  "/user/order/:orderId/payment-status",
  authHandler,
  orderController.getPaymentStatus
);

// --- Admin Routes ---

// Get all orders (admin)
router.get("/admin/orders", authHandler, orderController.getAllOrders);

// Get orders by status (admin)
router.get(
  "/admin/orders/status",
  authHandler,
  orderController.getOrdersByStatus
);

// Update order status (admin)
router.put(
  "/admin/order/:orderId/status",
  authHandler,
  orderController.updateOrderStatus
);

// Get order statistics (admin)
router.get(
  "/admin/order-statistics",
  authHandler,
  orderController.getOrderStatistics
);

// --- Payment Routes ---

// Get Midtrans client key
router.get("/payment/client-key", orderController.getMidtransClientKey);

// Handle Midtrans payment notification (webhook)
router.post(
  "/payment/notification",
  orderController.handleMidtransNotification
);

// Get payment status (Admin)
router.get(
  "/admin/payment/:paymentId/status",
  authHandler,
  orderController.getPaymentStatusAdmin
);

module.exports = router;
