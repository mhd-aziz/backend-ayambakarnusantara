const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const { authenticateToken } = require("../middlewares/authMiddleware");

router.use(authenticateToken);

router.get("/", notificationController.getUserNotifications);

router.patch(
  "/:notificationId/read",
  notificationController.markNotificationAsRead
);

module.exports = router;
