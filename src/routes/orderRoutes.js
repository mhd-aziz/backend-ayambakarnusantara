const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const authHandler = require("../middlewares/authHandler");

// --- User Routes ---

// Create new order
router.post("/user/order", authHandler, orderController.createOrder);

// Get user orders with pagination and filtering
router.get("/user/orders", authHandler, orderController.getUserOrders);

// Get order details
router.get("/user/order/:orderId", authHandler, orderController.getOrderDetails);

// Cancel order (only for pending or waiting for payment)
router.post("/user/order/:orderId/cancel", authHandler, orderController.cancelOrder);

// --- Admin Routes ---

// Get shop orders
router.get("/admin/orders", authHandler, orderController.getShopOrders);

// Update order status
router.patch(
  "/admin/order/:orderId/status",
  authHandler,
  orderController.updateOrderStatus
);

// --- Payment Callback ---

// Handle Midtrans payment notification
router.post("/payment/notification", orderController.handlePaymentNotification);

module.exports = router;
