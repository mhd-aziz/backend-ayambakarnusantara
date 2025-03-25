const express = require("express");
const router = express.Router();
const shopController = require("../controllers/shopController");
const authHandler = require("../middlewares/authHandler");
const upload = require("../middlewares/multerMiddleware");

// Admin routes
// Create a new shop
router.post(
  "/admin/shop",
  authHandler,
  upload.single("photoShop"),
  shopController.createShop
);

// Get shop by admin (using adminId from token)
router.get("/admin/shop", authHandler, shopController.getShopByAdmin);

// Update shop information
router.put(
  "/admin/shop",
  authHandler,
  upload.single("photoShop"),
  shopController.updateShop
);

// User routes
// Get all shops with pagination and search
router.get("/user/shops", authHandler, shopController.getShopByUser);

// Get shop detail by ID (for users)
router.get("/user/shop/:id", authHandler, shopController.getShopById);

router.delete("/admin/shop", authHandler, shopController.deleteShop);

module.exports = router;
