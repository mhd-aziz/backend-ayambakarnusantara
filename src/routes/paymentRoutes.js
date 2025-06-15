const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/paymentController");
const { authenticateToken } = require("../middlewares/authMiddleware");

router.post(
  "/charge/:orderId",
  authenticateToken,
  paymentController.createMidtransTransaction
);

router.post(
  "/retry/:orderId", 
  authenticateToken,
  paymentController.retryMidtransPayment
);

router.get(
  "/status/:orderId",
  authenticateToken,
  paymentController.getMidtransTransactionStatus
);

module.exports = router;
