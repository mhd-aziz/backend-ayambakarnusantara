const express = require("express");
const router = express.Router();
const cartController = require("../controllers/cartController");
const { authenticateToken } = require("../middlewares/authMiddleware");

router.use(authenticateToken);
router.post("/items", cartController.addItemToCart);
router.get("/", cartController.getCart);
router.put("/items/:productId", cartController.updateItemQuantity);
router.delete("/items/:productId", cartController.removeItemFromCart);
router.delete("/", cartController.clearCart);

module.exports = router;
