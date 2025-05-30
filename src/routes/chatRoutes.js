// src/routes/chatRoutes.js
const express = require("express");
const router = express.Router();
const chatController = require("../controllers/chatController");
const { authenticateToken } = require("../middlewares/authMiddleware");

router.use(authenticateToken);

router.post("/conversations", chatController.startOrGetConversation);

router.get("/conversations", chatController.getUserConversations);

router.post(
  "/conversations/:conversationId/messages",
  chatController.sendMessage
);

router.get(
  "/conversations/:conversationId/messages",
  chatController.getConversationMessages
);

router.patch(
  "/conversations/:conversationId/read",
  chatController.markConversationAsRead
);

module.exports = router;
