const { firestore, FieldValue, storage } = require("../config/firebaseConfig");
const { handleSuccess, handleError } = require("../utils/responseHandler");
const { sendNotification } = require("./notificationController");
const { v4: uuidv4 } = require("uuid");

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

  const participants = [initiatorUID, recipientUID].sort();
  const conversationId = participants.join("_");

  const conversationRef = firestore
    .collection("conversations")
    .doc(conversationId);
  const usersRef = firestore.collection("users");

  try {
    const conversationDoc = await conversationRef.get();

    if (conversationDoc.exists) {
      let existingConversationData = conversationDoc.data();
      if (!existingConversationData._id) {
        existingConversationData._id = conversationDoc.id;
      }

      const [initiatorUserDoc, recipientUserDoc] = await Promise.all([
        usersRef.doc(initiatorUID).get(),
        usersRef.doc(recipientUID).get(),
      ]);

      let needsInfoUpdate = false;
      const updatedParticipantInfo = {
        ...(existingConversationData.participantInfo || {}),
      };

      if (initiatorUserDoc.exists) {
        const initiatorData = initiatorUserDoc.data();
        if (
          updatedParticipantInfo[initiatorUID]?.displayName !==
            initiatorData.displayName ||
          updatedParticipantInfo[initiatorUID]?.photoURL !==
            initiatorData.photoURL
        ) {
          updatedParticipantInfo[initiatorUID] = {
            displayName: initiatorData.displayName || "Pengguna",
            photoURL: initiatorData.photoURL || null,
          };
          needsInfoUpdate = true;
        }
      }

      if (recipientUserDoc.exists) {
        const recipientData = recipientUserDoc.data();
        if (
          updatedParticipantInfo[recipientUID]?.displayName !==
            recipientData.displayName ||
          updatedParticipantInfo[recipientUID]?.photoURL !==
            recipientData.photoURL
        ) {
          updatedParticipantInfo[recipientUID] = {
            displayName: recipientData.displayName || "Pengguna",
            photoURL: recipientData.photoURL || null,
          };
          needsInfoUpdate = true;
        }
      }

      if (needsInfoUpdate) {
        await conversationRef.update({
          participantInfo: updatedParticipantInfo,
          updatedAt: FieldValue.serverTimestamp(),
        });
        existingConversationData.participantInfo = updatedParticipantInfo;
      }

      return handleSuccess(
        res,
        200,
        "Percakapan sudah ada.",
        existingConversationData
      );
    } else {
      const initiatorUserDoc = await usersRef.doc(initiatorUID).get();
      const recipientUserDoc = await usersRef.doc(recipientUID).get();

      if (!initiatorUserDoc.exists || !recipientUserDoc.exists) {
        return handleError(res, {
          statusCode: 404,
          message: "Satu atau kedua pengguna tidak ditemukan.",
        });
      }

      const initiatorData = initiatorUserDoc.data();
      const recipientData = recipientUserDoc.data();

      const newConversationData = {
        _id: conversationId,
        participantUIDs: participants,
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

      const createdConversationForResponse = {
        ...newConversationData,
      };

      return handleSuccess(
        res,
        201,
        "Percakapan berhasil dimulai.",
        createdConversationForResponse
      );
    }
  } catch (error) {
    console.error(
      "Error starting or getting conversation:",
      error.message,
      error.stack
    );
    return handleError(res, {
      statusCode: 500,
      message: error.message || "Gagal memulai atau mendapatkan percakapan.",
    });
  }
};

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

exports.sendMessage = async (req, res) => {
  const senderUID = req.user?.uid;
  const { conversationId } = req.params;
  const { text, latitude, longitude } = req.body;
  const imageFile = req.file;

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
  if (!text?.trim() && !imageFile && (!latitude || !longitude)) {
    return handleError(res, {
      statusCode: 400,
      message: "Konten pesan tidak boleh kosong.",
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

    const recipientUID = conversationData.participantUIDs.find(
      (uid) => uid !== senderUID
    );

    const newMessageRef = messagesRef.doc();
    let newMessageData = {
      _id: newMessageRef.id,
      senderUID: senderUID,
      timestamp: FieldValue.serverTimestamp(),
      text: null,
      imageUrl: null,
      location: null,
      type: "text",
    };
    let lastMessageText = "";

    if (imageFile) {
      newMessageData.type = "image";
      lastMessageText = text?.trim() || "Gambar";
      newMessageData.text = text?.trim() || null;

      const bucket = storage.bucket();
      const fileExtension = imageFile.originalname.split(".").pop();
      const fileName = `chat-images/${conversationId}/${
        newMessageRef.id
      }-${uuidv4()}.${fileExtension}`;
      const fileUpload = bucket.file(fileName);

      const blobStream = fileUpload.createWriteStream({
        metadata: { contentType: imageFile.mimetype },
        public: true,
      });

      await new Promise((resolve, reject) => {
        blobStream.on("error", (error) => {
          console.error("Kesalahan stream upload:", error);
          reject(error);
        });
        blobStream.on("finish", () => {
          newMessageData.imageUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
          resolve();
        });
        blobStream.end(imageFile.buffer);
      });
    } else if (latitude && longitude) {
      newMessageData.type = "location";
      lastMessageText = "📍 Lokasi";
      const lat = parseFloat(latitude);
      const lon = parseFloat(longitude);
      if (isNaN(lat) || isNaN(lon)) {
        return handleError(res, {
          statusCode: 400,
          message: "Latitude dan Longitude harus berupa angka.",
        });
      }
      newMessageData.location = { latitude: lat, longitude: lon };
    } else {
      newMessageData.type = "text";
      newMessageData.text = text.trim();
      lastMessageText = text.trim();
    }

    const batch = firestore.batch();
    batch.set(newMessageRef, newMessageData);

    const currentTimestamp = FieldValue.serverTimestamp();
    batch.update(conversationRef, {
      lastMessage: {
        text: lastMessageText,
        senderUID: senderUID,
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

    const senderInfo = conversationData.participantInfo[senderUID];
    const senderName = senderInfo ? senderInfo.displayName : "Seseorang";

    const notificationPayload = {
      userId: recipientUID,
      title: `Pesan baru dari ${senderName}`,
      body: lastMessageText,
      data: { conversationId: conversationId, type: "NEW_MESSAGE" },
    };
    await sendNotification(notificationPayload);

    return handleSuccess(
      res,
      201,
      "Pesan berhasil dikirim.",
      createdMessageForResponse
    );
  } catch (error) {
    console.error("Error sending message:", error);
    console.error("DETAIL ERROR:", JSON.stringify(error, null, 2));
    return handleError(res, error, "Gagal mengirim pesan.");
  }
};

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
