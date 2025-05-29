// src/routes/PaymentRoutes.js
const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/paymentController");
const { authenticateToken } = require("../middlewares/authMiddleware");

// Endpoint untuk customer membuat/memulai pembayaran awal
router.post(
  "/charge/:orderId",
  authenticateToken,
  paymentController.createMidtransTransaction
);

// BARU: Endpoint untuk customer mencoba melakukan pembayaran ulang
router.post(
  "/retry/:orderId", 
  authenticateToken,
  paymentController.retryMidtransPayment
);

// Endpoint untuk customer mengecek status transaksi Midtrans
router.get(
  "/status/:orderId",
  authenticateToken,
  paymentController.getMidtransTransactionStatus
);

// HAPUS Route Notifikasi Midtrans:
// router.post("/midtrans/notification", paymentController.handleMidtransNotification);

module.exports = router;
