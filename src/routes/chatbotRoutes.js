// src/routes/chatbotRoutes.js
const express = require("express");
const router = express.Router();
const chatbotController = require("../controllers/chatbotController");
const { authenticateToken } = require("../middlewares/authMiddleware");

router.post("/ask", authenticateToken, chatbotController.askGemini);

module.exports = router;