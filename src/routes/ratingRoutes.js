// src/routes/ratingRoutes.js
const express = require("express");
const router = express.Router();
const ratingController = require("../controllers/ratingController");
const { authenticateToken } = require("../middlewares/authMiddleware");

// Tambah rating baru ke produk
router.post(
  "/:productId", // productId dari produk yang dinilai
  authenticateToken,
  ratingController.addRating
);

// Dapatkan semua rating untuk produk tertentu
router.get(
  "/:productId", // productId dari produk
  ratingController.getRatingsForProduct
);

// Update rating yang sudah ada
router.put(
  "/:ratingId", // ratingId dari rating yang akan diupdate
  authenticateToken,
  ratingController.updateRating
);

// Hapus rating yang sudah ada
router.delete(
  "/:ratingId",
  authenticateToken,
  ratingController.deleteRating
);

module.exports = router;
