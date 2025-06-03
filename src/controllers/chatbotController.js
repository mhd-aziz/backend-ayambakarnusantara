// src/controllers/chatbotController.js
const axios = require("axios");
const { handleSuccess, handleError } = require("../utils/responseHandler");
const { firestore } = require("../config/firebaseConfig");

const RASA_WEBHOOK_URL =
  process.env.RASA_WEBHOOK_URL || "http://localhost:5005/webhooks/rest/webhook";
const USER_CHAT_HISTORY_COLLECTION = "userChatHistories";

exports.forwardToRasa = async (req, res) => {
  const { message: userMessageText, sender: senderIdFromFrontend } = req.body;

  if (
    !userMessageText ||
    typeof userMessageText !== "string" ||
    userMessageText.trim() === ""
  ) {
    return handleError(res, {
      statusCode: 400,
      message: "Pesan tidak boleh kosong.",
    });
  }

  const rasaSenderId = req.user?.uid || senderIdFromFrontend || "defaultUser";
  const userId = req.user?.uid;

  const payloadToRasa = {
    sender: rasaSenderId,
    message: userMessageText,
  };

  const authToken = req.firebaseIdToken;

  if (authToken) {
    payloadToRasa.metadata = {
      authToken: authToken,
    };
  }

  try {
    const rasaResponse = await axios.post(RASA_WEBHOOK_URL, payloadToRasa);

    if (userId) {
      const userHistoryDocRef = firestore
        .collection(USER_CHAT_HISTORY_COLLECTION)
        .doc(userId);

      const userMessageEntry = {
        role: "user",
        text: userMessageText,
        createdAt: new Date().toISOString(),
      };

      const botMessageEntriesForDb =
        rasaResponse.data && Array.isArray(rasaResponse.data)
          ? rasaResponse.data.map((botMsg) => ({
              role: "bot",
              text: botMsg.text || null,
              imageUrl: botMsg.image || null,
              createdAt: new Date().toISOString(),
            }))
          : [];

      const newMessagesToAdd = [
        userMessageEntry,
        ...botMessageEntriesForDb.filter((bm) => bm.text || bm.imageUrl),
      ];

      try {
        const doc = await userHistoryDocRef.get();
        if (doc.exists) {
          const currentMessages = doc.data().messages || [];
          await userHistoryDocRef.update({
            messages: [...currentMessages, ...newMessagesToAdd],
            lastUpdatedAt: new Date().toISOString(),
          });
        } else {
          await userHistoryDocRef.set({
            userId: userId,
            messages: newMessagesToAdd,
            lastUpdatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          });
        }
      } catch (dbError) {
        console.error(
          "Gagal menyimpan atau memperbarui riwayat percakapan pengguna:",
          dbError
        );
      }
    }

    let finalPayloadForClient;

    if (rasaResponse.data && Array.isArray(rasaResponse.data)) {
      finalPayloadForClient = rasaResponse.data.map((botMsg) => {
        const { quick_replies, buttons, ...messageWithoutSuggestions } = botMsg;
        return messageWithoutSuggestions;
      });
    } else {
      finalPayloadForClient = rasaResponse.data;
    }

    return handleSuccess(
      res,
      200,
      "Pesan berhasil diproses.",
      finalPayloadForClient
    );
  } catch (error) {
    console.error(
      "Error saat berkomunikasi dengan Rasa:",
      error.response?.data || error.message
    );
    const statusCode = error.response?.status || 502;
    const errorMessage =
      error.response?.data?.message ||
      error.message ||
      "Gagal berkomunikasi dengan layanan chatbot.";

    if (error.code === "ECONNREFUSED") {
      return handleError(res, {
        statusCode: 503,
        message: `Layanan chatbot Rasa di ${RASA_WEBHOOK_URL} tidak dapat dijangkau.`,
      });
    }

    return handleError(res, {
      statusCode: statusCode,
      message: errorMessage,
      errorDetails: error.response?.data,
    });
  }
};

// Fungsi getChatHistory dan clearChatHistory tetap sama
exports.getChatHistory = async (req, res) => {
  const userId = req.user?.uid;
  if (!userId) {
    return handleError(res, {
      statusCode: 401,
      message: "Autentikasi diperlukan untuk melihat riwayat chat.",
    });
  }

  try {
    const historyDocRef = firestore
      .collection(USER_CHAT_HISTORY_COLLECTION)
      .doc(userId);
    const doc = await historyDocRef.get();

    if (!doc.exists) {
      return handleSuccess(
        res,
        200,
        "Tidak ada riwayat percakapan ditemukan.",
        []
      );
    }

    const historyData = doc.data();
    return handleSuccess(
      res,
      200,
      "Riwayat percakapan berhasil diambil.",
      historyData.messages || []
    );
  } catch (error) {
    console.error("Error mengambil riwayat percakapan:", error);
    return handleError(res, error, "Gagal mengambil riwayat percakapan.");
  }
};

exports.clearChatHistory = async (req, res) => {
  const userId = req.user?.uid;
  if (!userId) {
    return handleError(res, {
      statusCode: 401,
      message: "Autentikasi diperlukan untuk menghapus riwayat chat.",
    });
  }

  try {
    const historyDocRef = firestore
      .collection(USER_CHAT_HISTORY_COLLECTION)
      .doc(userId);

    const doc = await historyDocRef.get();

    if (!doc.exists) {
      return handleSuccess(
        res,
        200,
        "Tidak ada riwayat percakapan untuk dihapus."
      );
    }

    await historyDocRef.delete();

    return handleSuccess(res, 200, "Riwayat percakapan berhasil dihapus.");
  } catch (error) {
    console.error("Error menghapus riwayat percakapan:", error);
    return handleError(res, error, "Gagal menghapus riwayat percakapan.");
  }
};
