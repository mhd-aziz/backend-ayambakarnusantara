const express = require("express");
const router = express.Router();
const ratingController = require("../controllers/ratingController");
const authHandler = require("../middlewares/authHandler");

// ========== USER ROUTES ==========

// Create or update a rating for a product
router.post("/user/rating", authHandler, ratingController.createOrUpdateRating);

// Get a user's rating for a specific product
router.get(
  "/user/rating/:productId",
  authHandler,
  ratingController.getUserProductRating
);

// Delete a rating
router.delete(
  "/user/rating/:ratingId",
  authHandler,
  ratingController.deleteRating
);

// ========== ADMIN ROUTES ==========

// Admin can view recent ratings (with additional user data)
router.get(
  "/admin/ratings/recent",
  authHandler,
  ratingController.getRecentRatings
);

// ========== PUBLIC ROUTES (NO AUTH REQUIRED) ==========

// Get all ratings for a product with pagination
router.get("/product/:productId/ratings", ratingController.getProductRatings);

// Get rating summary for a shop
router.get("/shop/:shopId/ratings", ratingController.getShopRatings);

// Get top-rated products
router.get("/products/top-rated", ratingController.getTopRatedProducts);

// Get recent ratings (public version)
router.get(
  "/ratings/recent",
  authHandler, // Optional auth to determine if admin or regular user
  ratingController.getRecentRatings
);

module.exports = router;
