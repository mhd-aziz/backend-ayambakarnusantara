const express = require("express");
const router = express.Router();
const profileController = require("../controllers/profileController");
const { authenticateToken } = require("../middlewares/authMiddleware");
const upload = require("../middlewares/multerConfig");

router.get("/", authenticateToken, profileController.getProfile);

router.put(
  "/update",
  authenticateToken,
  upload.single("profileImage"),
  profileController.updateProfile
);

router.delete(
  "/photo",
  authenticateToken,
  profileController.deleteProfilePhoto
);

router.post("/fcm-token", authenticateToken, profileController.addFcmToken);

module.exports = router;
