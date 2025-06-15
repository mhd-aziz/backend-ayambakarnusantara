const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const { authenticateToken } = require("../middlewares/authMiddleware");
const upload = require("../middlewares/multerConfig");

router.use(authenticateToken);

router.post("/", orderController.createOrder);
router.get("/", orderController.getUserOrders);
router.get("/customer/:orderId", orderController.getOrderDetailsForCustomer);
router.patch("/:orderId/cancel", orderController.cancelOrder);

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

router.get("/:orderId/payment-proofs", orderController.getOrderPaymentProofs);

router.get("/all", orderController.getOrders);

module.exports = router;
