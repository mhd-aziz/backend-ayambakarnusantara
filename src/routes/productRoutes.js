// src/routes/productRoutes.js
const express = require("express");
const router = express.Router();
const productController = require("../controllers/productController");
const {
  authenticateToken,
  isSeller,
} = require("../middlewares/authMiddleware");
const upload = require("../middlewares/multerConfig");

router.post(
  "/",
  authenticateToken,
  isSeller,
  upload.single("productImage"), 
  productController.createProduct
);

router.get(
  "/my-products", 
  authenticateToken,
  isSeller,
  productController.getMyProducts
);

router.put(
  "/:productId",
  authenticateToken,
  isSeller,
  upload.single("productImage"),
  productController.updateProduct
);

router.delete(
  "/:productId",
  authenticateToken,
  isSeller,
  productController.deleteProduct
);

router.get("/", productController.getAllProducts); 
router.get('/recommendations', productController.getProductRecommendations);
router.get("/:productId", productController.getProductById);

module.exports = router;
