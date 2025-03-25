const express = require("express");
const router = express.Router();
const cartController = require("../controllers/cartController");
const authHandler = require("../middlewares/authHandler");

// Get user's cart
router.get("/user/cart", authHandler, cartController.getCart);

// Add product to cart
router.post("/user/cart/add", authHandler, cartController.addToCart);

// Update cart item quantity
router.put("/user/cart/update", authHandler, cartController.updateCartItem);

// Remove item from cart
router.delete(
  "/user/cart/item/:cartItemId",
  authHandler,
  cartController.removeFromCart
);

// Clear cart (remove all items)
router.delete("/user/cart/clear", authHandler, cartController.clearCart);

// Get cart summary (for checkout)
router.get("/user/cart/summary", authHandler, cartController.getCartSummary);

module.exports = router;
