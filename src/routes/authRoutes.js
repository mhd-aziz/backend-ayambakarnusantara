const express = require("express");
const router = express.Router();
const {
  registerUser,
  registerAdmin,
  loginUser,
  loginAdmin,
  forgotPasswordUser,
  forgotPasswordAdmin,
  resetPasswordUser,
  resetPasswordAdmin,
} = require("../controllers/authController");

// User routes
router.post("/user/register", registerUser);
router.post("/user/login", loginUser);
router.post("/user/forgot-password", forgotPasswordUser); 
router.post("/user/reset-password", resetPasswordUser); 

// Admin routes
router.post("/admin/register", registerAdmin);
router.post("/admin/login", loginAdmin);
router.post("/admin/forgot-password", forgotPasswordAdmin); 
router.post("/admin/reset-password", resetPasswordAdmin); 

module.exports = router;
