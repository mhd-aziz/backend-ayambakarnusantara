// src/controllers/chatController.js
const { firestore, FieldValue } = require("../config/firebaseConfig");
const { handleSuccess, handleError } = require("../utils/responseHandler");
const { v4: uuidv4 } = require("uuid");

/**
 * @desc    Start a new conversation or get an existing one between two users.
 * @route   POST /api/chat/conversations
 * @access  Private
 * @body    { "recipientUID": "UID of the other user" }
 */
exports.startOrGetConversation = async (req, res) => {
  const initiatorUID = req.user?.uid;
  const { recipientUID } = req.body;

  if (!initiatorUID) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }
  if (!recipientUID) {
    return handleError(res, {
      statusCode: 400,
      message: "recipientUID (UID pengguna tujuan) diperlukan.",
    });
  }
  if (initiatorUID === recipientUID) {
    return handleError(res, {
      statusCode: 400,
      message: "Anda tidak dapat memulai percakapan dengan diri sendiri.",
    });
  }

  const conversationsRef = firestore.collection("conversations");

  try {
    const querySnapshot = await conversationsRef
      .where("participantUIDs", "array-contains", initiatorUID)
      .get();

    let existingConversation = null;
    if (!querySnapshot.empty) {
      for (const doc of querySnapshot.docs) {
        const conversation = doc.data();
        if (conversation.participantUIDs.includes(recipientUID)) {
          existingConversation = conversation;
          break;
        }
      }
    }

    if (existingConversation) {
      return handleSuccess(
        res,
        200,
        "Percakapan sudah ada.",
        existingConversation
      );
    } else {
      const newConversationId = uuidv4();
      const conversationRef = conversationsRef.doc(newConversationId);

      const usersRef = firestore.collection("users");
      const initiatorDoc = await usersRef.doc(initiatorUID).get();
      const recipientDoc = await usersRef.doc(recipientUID).get();

      if (!initiatorDoc.exists || !recipientDoc.exists) {
        return handleError(res, {
          statusCode: 404,
          message: "Satu atau kedua pengguna tidak ditemukan.",
        });
      }

      const initiatorData = initiatorDoc.data();
      const recipientData = recipientDoc.data();

      const newConversationData = {
        _id: newConversationId,
        participantUIDs: [initiatorUID, recipientUID].sort(),
        participantInfo: {
          [initiatorUID]: {
            displayName: initiatorData.displayName || "Pengguna",
            photoURL: initiatorData.photoURL || null,
          },
          [recipientUID]: {
            displayName: recipientData.displayName || "Pengguna",
            photoURL: recipientData.photoURL || null,
          },
        },
        lastMessage: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      await conversationRef.set(newConversationData);
      return handleSuccess(
        res,
        201,
        "Percakapan berhasil dimulai.",
        newConversationData
      );
    }
  } catch (error) {
    console.error("Error starting or getting conversation:", error);
    return handleError(
      res,
      error,
      "Gagal memulai atau mendapatkan percakapan."
    );
  }
};

/**
 * @desc    Get all conversations for the authenticated user.
 * @route   GET /api/chat/conversations
 * @access  Private
 */
exports.getUserConversations = async (req, res) => {
  const userUID = req.user?.uid;

  if (!userUID) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }

  try {
    const conversationsSnapshot = await firestore
      .collection("conversations")
      .where("participantUIDs", "array-contains", userUID)
      .orderBy("updatedAt", "desc")
      .get();

    if (conversationsSnapshot.empty) {
      return handleSuccess(res, 200, "Tidak ada percakapan ditemukan.", []);
    }

    const conversations = conversationsSnapshot.docs.map((doc) => doc.data());
    return handleSuccess(
      res,
      200,
      "Daftar percakapan berhasil diambil.",
      conversations
    );
  } catch (error) {
    console.error("Error getting user conversations:", error);
    return handleError(res, error, "Gagal mengambil daftar percakapan.");
  }
};

/**
 * @desc    Send a message in a conversation.
 * @route   POST /api/chat/conversations/:conversationId/messages
 * @access  Private
 * @body    { "text": "Isi pesan" }
 */
exports.sendMessage = async (req, res) => {
  const senderUID = req.user?.uid;
  const { conversationId } = req.params;
  const { text } = req.body;

  if (!senderUID) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }
  if (!conversationId) {
    return handleError(res, {
      statusCode: 400,
      message: "ID Percakapan diperlukan.",
    });
  }
  if (!text || text.trim() === "") {
    return handleError(res, {
      statusCode: 400,
      message: "Teks pesan tidak boleh kosong.",
    });
  }

  const conversationRef = firestore
    .collection("conversations")
    .doc(conversationId);
  const messagesRef = conversationRef.collection("messages");

  try {
    const conversationDoc = await conversationRef.get();
    if (!conversationDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Percakapan tidak ditemukan.",
      });
    }

    const conversationData = conversationDoc.data();
    if (!conversationData.participantUIDs.includes(senderUID)) {
      return handleError(res, {
        statusCode: 403,
        message: "Anda bukan partisipan dalam percakapan ini.",
      });
    }

    const newMessageRef = messagesRef.doc();
    const newMessageData = {
      _id: newMessageRef.id,
      senderUID: senderUID,
      text: text.trim(),
      timestamp: FieldValue.serverTimestamp(),
      type: "text",
    };

    const batch = firestore.batch();
    batch.set(newMessageRef, newMessageData);

    const currentTimestamp = FieldValue.serverTimestamp();
    batch.update(conversationRef, {
      lastMessage: {
        text: newMessageData.text,
        senderUID: newMessageData.senderUID,
        timestamp: currentTimestamp,
      },
      updatedAt: currentTimestamp,
    });

    await batch.commit();

    const createdMessageForResponse = {
      ...newMessageData,
      timestamp: new Date().toISOString(),
      _id: newMessageRef.id,
    };

    return handleSuccess(
      res,
      201,
      "Pesan berhasil dikirim.",
      createdMessageForResponse
    );
  } catch (error) {
    console.error("Error sending message:", error);
    return handleError(res, error, "Gagal mengirim pesan.");
  }
};

/**
 * @desc    Get messages for a specific conversation.
 * @route   GET /api/chat/conversations/:conversationId/messages
 * @access  Private
 * @query   ?limit=20&beforeTimestamp=ISO_STRING (for pagination)
 */
exports.getConversationMessages = async (req, res) => {
  const userUID = req.user?.uid;
  const { conversationId } = req.params;
  const { limit = 20, beforeTimestamp } = req.query;

  if (!userUID) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }
  if (!conversationId) {
    return handleError(res, {
      statusCode: 400,
      message: "ID Percakapan diperlukan.",
    });
  }

  const conversationRef = firestore
    .collection("conversations")
    .doc(conversationId);
  const messagesRef = conversationRef.collection("messages");

  try {
    const conversationDoc = await conversationRef.get();
    if (!conversationDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Percakapan tidak ditemukan.",
      });
    }
    if (!conversationDoc.data().participantUIDs.includes(userUID)) {
      return handleError(res, {
        statusCode: 403,
        message: "Anda bukan partisipan dalam percakapan ini.",
      });
    }

    let query = messagesRef.orderBy("timestamp", "desc").limit(Number(limit));

    if (beforeTimestamp) {
      try {
        const parsedTimestamp = new Date(beforeTimestamp);
        if (isNaN(parsedTimestamp.valueOf())) {
          throw new Error("Invalid date format for beforeTimestamp");
        }
        query = query.startAfter(parsedTimestamp);
      } catch (e) {
        return handleError(res, {
          statusCode: 400,
          message: `Format beforeTimestamp tidak valid: ${e.message}`,
        });
      }
    }

    const messagesSnapshot = await query.get();
    const messages = messagesSnapshot.docs.map((doc) => {
      const data = doc.data();
      if (data.timestamp && typeof data.timestamp.toDate === "function") {
        data.timestamp = data.timestamp.toDate().toISOString();
      }
      return data;
    });

    return handleSuccess(
      res,
      200,
      "Pesan percakapan berhasil diambil.",
      messages.reverse()
    );
  } catch (error) {
    console.error("Error getting conversation messages:", error);
    return handleError(res, error, "Gagal mengambil pesan percakapan.");
  }
};

/**
 * @desc    Mark all messages in a conversation as read for the current user.
 * @route   PATCH /api/chat/conversations/:conversationId/read
 * @access  Private
 */
exports.markConversationAsRead = async (req, res) => {
  const userUID = req.user?.uid;
  const { conversationId } = req.params;

  if (!userUID) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }
  if (!conversationId) {
    return handleError(res, {
      statusCode: 400,
      message: "ID Percakapan diperlukan.",
    });
  }

  const conversationRef = firestore
    .collection("conversations")
    .doc(conversationId);

  try {
    const conversationDoc = await conversationRef.get();
    if (!conversationDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Percakapan tidak ditemukan.",
      });
    }
    const conversationData = conversationDoc.data();
    if (!conversationData.participantUIDs.includes(userUID)) {
      return handleError(res, {
        statusCode: 403,
        message: "Anda bukan partisipan dalam percakapan ini.",
      });
    }

    if (
      conversationData.unreadCounts &&
      typeof conversationData.unreadCounts[userUID] === "number" &&
      conversationData.unreadCounts[userUID] > 0
    ) {
      await conversationRef.update({
        [`unreadCounts.${userUID}`]: 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return handleSuccess(res, 200, "Percakapan ditandai sudah dibaca.");
    } else if (!conversationData.unreadCounts) {
      console.warn(
        `Conversation ${conversationId} does not have unreadCounts field. Skipping read update.`
      );
      return handleSuccess(
        res,
        200,
        "Percakapan tidak memiliki fitur hitung pesan belum dibaca, status baca tidak diubah."
      );
    }

    return handleSuccess(
      res,
      200,
      "Tidak ada pesan baru untuk ditandai sudah dibaca."
    );
  } catch (error) {
    console.error("Error marking conversation as read:", error);
    return handleError(res, error, "Gagal menandai percakapan sudah dibaca.");
  }
};
