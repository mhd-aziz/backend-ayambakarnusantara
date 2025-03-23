// src/routes/orderRoutes.js
const express = require("express");
const router = express.Router();
const {
  createOrder,
  handleMidtransCallback,
} = require("../controllers/orderController");

// Route to create an order
router.post("/create-order", createOrder);

module.exports = router;
