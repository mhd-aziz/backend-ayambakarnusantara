// src/routes/notificationRoutes.js

const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const { authenticateToken } = require("../middlewares/authMiddleware");

// Semua rute di sini memerlukan otentikasi
router.use(authenticateToken);

// Rute untuk mendapatkan daftar notifikasi pengguna
// GET http://localhost:3000/notifications
router.get("/", notificationController.getUserNotifications);

// Rute untuk menandai notifikasi spesifik sebagai sudah dibaca
// PATCH http://localhost:3000/notifications/{notificationId}/read
router.patch(
  "/:notificationId/read",
  notificationController.markNotificationAsRead
);

module.exports = router;
