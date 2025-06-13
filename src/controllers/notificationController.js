// src/controllers/notificationController.js

const { firestore, admin } = require("../config/firebaseConfig");
const { handleSuccess, handleError } = require("../utils/responseHandler");

/**
 * Fungsi internal untuk membuat dan mengirim notifikasi.
 * Tidak diekspos langsung sebagai API route.
 * @param {object} notificationPayload - Data notifikasi.
 * @param {string} notificationPayload.userId - ID pengguna penerima.
 * @param {string} notificationPayload.title - Judul notifikasi.
 * @param {string} notificationPayload.body - Isi pesan notifikasi.
 * @param {object} [notificationPayload.data] - Data tambahan (misal: { orderId: '...' }).
 */
exports.sendNotification = async (notificationPayload) => {
  const { userId, title, body, data } = notificationPayload;

  try {
    const userDoc = await firestore.collection("users").doc(userId).get();
    if (
      !userDoc.exists ||
      !userDoc.data().fcmTokens ||
      userDoc.data().fcmTokens.length === 0
    ) {
      console.log(
        `Tidak ada token FCM untuk pengguna ${userId}, notifikasi push dilewati.`
      );
      return;
    }
    const fcmTokens = userDoc.data().fcmTokens;

    const notificationRef = firestore.collection("notifications").doc();
    await notificationRef.set({
      notificationId: notificationRef.id,
      userId,
      title,
      body,
      data: data || {},
      isRead: false,
      createdAt: new Date().toISOString(),
    });

    const message = {
      tokens: fcmTokens,
      notification: {
        title,
        body,
      },
      data: data || {},
      android: {
        notification: {
          sound: "default",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
          },
        },
      },
    };

    console.log(
      `Mengirim notifikasi ke ${fcmTokens.length} token untuk pengguna ${userId}.`
    );
    const response = await admin.messaging().sendEachForTokens(message);

    response.responses.forEach((result, index) => {
      if (!result.success) {
        const error = result.error;
        if (
          error.code === "messaging/registration-token-not-registered" ||
          error.code === "messaging/invalid-registration-token"
        ) {
          console.log(`Menghapus token FCM tidak valid: ${fcmTokens[index]}`);
        }
      }
    });
  } catch (error) {
    console.error(`Gagal mengirim notifikasi untuk pengguna ${userId}:`, error);
  }
};

/**
 * @desc    Mengambil daftar notifikasi untuk pengguna yang sedang login.
 * @route   GET /notifications
 * @access  Private
 */
exports.getUserNotifications = async (req, res) => {
  const userId = req.user?.uid;

  try {
    const snapshot = await firestore
      .collection("notifications")
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .limit(30)
      .get();

    const notifications = snapshot.docs.map((doc) => doc.data());
    return handleSuccess(
      res,
      200,
      "Notifikasi berhasil diambil.",
      notifications
    );
  } catch (error) {
    console.error("Error getting user notifications:", error);
    return handleError(res, error, "Gagal mengambil notifikasi.");
  }
};

/**
 * @desc    Menandai satu notifikasi sebagai sudah dibaca.
 * @route   PATCH /notifications/:notificationId/read
 * @access  Private
 */
exports.markNotificationAsRead = async (req, res) => {
  const userId = req.user?.uid;
  const { notificationId } = req.params;

  if (!notificationId) {
    return handleError(res, {
      statusCode: 400,
      message: "Notification ID diperlukan.",
    });
  }

  try {
    const notifRef = firestore.collection("notifications").doc(notificationId);
    const notifDoc = await notifRef.get();

    if (!notifDoc.exists || notifDoc.data().userId !== userId) {
      return handleError(res, {
        statusCode: 404,
        message: "Notifikasi tidak ditemukan atau bukan milik Anda.",
      });
    }

    await notifRef.update({ isRead: true });
    return handleSuccess(res, 200, "Notifikasi ditandai sudah dibaca.");
  } catch (error) {
    console.error("Error marking notification as read:", error);
    return handleError(res, error, "Gagal memperbarui notifikasi.");
  }
};
