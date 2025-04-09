const express = require("express");
const router = express.Router();
const profileController = require("../controllers/profileController");
const authHandler = require("../middlewares/authHandler");
const upload = require("../middlewares/multerMiddleware");

// Get user profile
router.get("/user/profile", authHandler, profileController.getUserProfile);

// Update user profile
router.put(
  "/user/profile",
  authHandler,
  upload.single("photoUser"),
  profileController.updateUserProfile
);

// Get admin profile
router.get("/admin/profile", authHandler, profileController.getAdminProfile);

// Update admin profile
router.put(
  "/admin/profile",
  authHandler,
  upload.single("photoAdmin"),
  profileController.updateAdminProfile
);

// Change user password
router.put("/user/password", authHandler, profileController.changeUserPassword);

// Change admin password
router.put(
  "/admin/password",
  authHandler,
  profileController.changeAdminPassword
);

module.exports = router;
