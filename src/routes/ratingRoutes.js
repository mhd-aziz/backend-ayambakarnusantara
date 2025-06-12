const express = require("express");
const router = express.Router();
const ratingController = require("../controllers/ratingController");
const { authenticateToken } = require("../middlewares/authMiddleware");

router.post(
  "/:productId",
  authenticateToken,
  ratingController.addRating
);

router.get(
  "/:productId",
  ratingController.getRatingsForProduct
);

router.put(
  "/:ratingId",
  authenticateToken,
  ratingController.updateRating
);

router.delete(
  "/:ratingId",
  authenticateToken,
  ratingController.deleteRating
);

router.get(
  "/",
  ratingController.getRatings
);
module.exports = router;
