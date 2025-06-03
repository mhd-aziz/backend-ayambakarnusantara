const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const { authenticateToken } = require("../middlewares/authMiddleware");
const upload = require("../middlewares/multerConfig");

router.use(authenticateToken);

// --- Rute untuk Pelanggan (Customer) ---
router.post("/", orderController.createOrder);
router.get("/", orderController.getUserOrders);
router.get("/customer/:orderId", orderController.getOrderDetailsForCustomer);
router.patch("/:orderId/cancel", orderController.cancelOrder);

// --- Rute untuk Penjual (Seller) ---
router.get("/seller/all", orderController.getSellerOrders);
router.get("/seller/:orderId", orderController.getOrderDetailsForSeller);
router.patch(
  "/:orderId/seller/status",
  orderController.updateOrderStatusBySeller
);
router.patch(
  "/:orderId/seller/confirm-payment",
  upload.array("paymentProofs", 10),
  orderController.confirmPayAtStorePaymentBySeller
);

// --- Rute untuk mendapatkan bukti transaksi (akses oleh customer & seller terkait)
router.get("/:orderId/payment-proofs", orderController.getOrderPaymentProofs);

router.get("/all", orderController.getOrders);

module.exports = router;
