const express = require("express");
const router = express.Router();
const shopController = require("../controllers/shopController");
const authHandler = require("../middlewares/authHandler");
const upload = require("../middlewares/multerMiddleware");

// Create a new shop
router.post(
  "/admin/shop",
  authHandler,
  upload.single("photoShop"),
  shopController.createShop
);

// Get shop by admin (using adminId from token)
router.get("/admin/shop", authHandler, shopController.getShopByAdmin);

// Get shop by user (using user role from token)
router.get("/user/shop", authHandler, shopController.getShopByUser);

// Update shop information
router.put(
  "/admin/shop",
  authHandler,
  upload.single("photoShop"),
  shopController.updateShop
);

module.exports = router;
