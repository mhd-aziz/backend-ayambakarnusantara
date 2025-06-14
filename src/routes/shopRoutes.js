const express = require("express");
const router = express.Router();
const shopController = require("../controllers/shopController");
const {
  authenticateToken,
  isSeller,
} = require("../middlewares/authMiddleware");
const upload = require("../middlewares/multerConfig");

router.post(
  "/",
  authenticateToken,
  upload.single("bannerImage"),
  shopController.createShop
);

router.get("/my-shop", authenticateToken, isSeller, shopController.getMyShop);

router.get(
  "/my-shop/statistics",
  authenticateToken,
  isSeller,
  shopController.getShopStatistics
);

router.put(
  "/my-shop",
  authenticateToken,
  isSeller,
  upload.single("bannerImage"),
  shopController.updateShop
);

router.delete(
  "/my-shop",
  authenticateToken,
  isSeller,
  shopController.deleteShop
);

router.get("/", shopController.listShops);

router.get("/:shopId/detail", shopController.getShopDetails);
module.exports = router;
