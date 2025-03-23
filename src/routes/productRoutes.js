const express = require("express");
const router = express.Router();
const productController = require("../controllers/productController");
const authHandler = require("../middlewares/authHandler");
const upload = require("../middlewares/multerMiddleware");

// Create a new product
router.post(
  "/admin/product",
  authHandler,
  upload.single("photoProduct"),
  productController.createProduct
);

// Get all products for the admin's shop
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

// Delete a product
router.delete("/admin/product", authHandler, productController.deleteProduct);

// Get all products for a user
router.get("/user/products", authHandler, productController.getProductsByUser);

module.exports = router;
