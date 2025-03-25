const express = require("express");
const router = express.Router();
const productController = require("../controllers/productController");
const authHandler = require("../middlewares/authHandler");
const upload = require("../middlewares/multerMiddleware");

// ========== ADMIN ROUTES ==========

// Create a new product
router.post(
  "/admin/product",
  authHandler,
  upload.single("photoProduct"),
  productController.createProduct
);

// Get all products for the admin's shop with pagination and search
router.get(
  "/admin/products",
  authHandler,
  productController.getProductsByAdmin
);

// Update a product
router.put(
  "/admin/product",
  authHandler,
  upload.single("photoProduct"),
  productController.updateProduct
);

// Delete a product - menggunakan parameter URL sesuai REST convention
router.delete(
  "/admin/product/:productId",
  authHandler,
  productController.deleteProduct
);

// Update product stock only (untuk pengelolaan inventory cepat)
router.patch(
  "/admin/product/:productId/stock",
  authHandler,
  productController.updateProductStock
);

// Bulk update multiple products (untuk operasi batch)
router.post(
  "/admin/products/bulk-update",
  authHandler,
  productController.bulkUpdateProducts
);

// ========== USER ROUTES ==========

// Get all products for a user with filtering, pagination, and sorting
router.get("/user/products", authHandler, productController.getProductsByUser);

// ========== PUBLIC ROUTES (NO AUTH REQUIRED) ==========

// Get all products for public users (no auth required)
router.get("/products", productController.getPublicProducts);

// Get product details
router.get("/product/:productId", productController.getProductDetails);

// Get product stock status (tersedia untuk publik)
router.get("/product/:productId/stock", productController.getProductStock);

module.exports = router;
