// midtransRoutes.js

const express = require("express");
const router = express.Router();
const { handleMidtransNotification } = require("../controllers/midtransController"); // Memanggil controller

// Endpoint untuk menerima notifikasi dari Midtrans
router.post("/midtrans-notification", handleMidtransNotification);

module.exports = router;
