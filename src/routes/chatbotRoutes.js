// src/routes/chatbotRoutes.js
const express = require("express");
const router = express.Router();
const chatbotController = require("../controllers/chatbotController");
const { authenticateToken } = require("../middlewares/authMiddleware");

router.post("/ask", authenticateToken, chatbotController.forwardToRasa);

router.get("/history", authenticateToken, chatbotController.getChatHistory);

router.delete(
  "/history/clear",
  authenticateToken,
  chatbotController.clearChatHistory
);

module.exports = router;
