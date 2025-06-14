const { firestore, admin } = require("../config/firebaseConfig");
const { handleSuccess, handleError } = require("../utils/responseHandler");

exports.sendNotification = async (notificationPayload) => {
  const { userId, title, body, data } = notificationPayload;

  try {
    const userDocRef = firestore.collection("users").doc(userId);
    const userDoc = await userDocRef.get();
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

    const tokensToRemove = [];
    response.responses.forEach((result, index) => {
      if (!result.success) {
        const error = result.error;
        if (
          error.code === "messaging/registration-token-not-registered" ||
          error.code === "messaging/invalid-registration-token"
        ) {
          const invalidToken = fcmTokens[index];
          console.log(`Token FCM tidak valid ditemukan: ${invalidToken}`);
          tokensToRemove.push(invalidToken);
        }
      }
    });

    if (tokensToRemove.length > 0) {
      console.log(
        `Menghapus ${tokensToRemove.length} token FCM yang tidak valid untuk pengguna ${userId}.`
      );
      await userDocRef.update({
        fcmTokens: admin.firestore.FieldValue.arrayRemove(...tokensToRemove),
      });
    }
  } catch (error) {
    console.error(`Gagal mengirim notifikasi untuk pengguna ${userId}:`, error);
  }
};

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
