const { firestore } = require("../config/firebaseConfig");
const { handleSuccess, handleError } = require("../utils/responseHandler");

exports.createFeedback = async (req, res) => {
  const { name, email, subject, message } = req.body;

  if (!name || !email || !message) {
    return handleError(res, {
      statusCode: 400,
      message: "Nama, email, dan pesan wajib diisi.",
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return handleError(res, {
      statusCode: 400,
      message: "Format email tidak valid.",
    });
  }

  try {
    const newFeedbackRef = firestore.collection("feedbacks").doc();
    const newFeedbackData = {
      feedbackId: newFeedbackRef.id,
      name: name,
      email: email,
      subject: subject || "Tanpa Subjek",
      message: message,
      status: "new",
      createdAt: new Date().toISOString(),
    };

    await newFeedbackRef.set(newFeedbackData);

    return handleSuccess(
      res,
      201,
      "Terima kasih! Feedback Anda telah kami terima.",
      newFeedbackData
    );
  } catch (error) {
    console.error("Error creating feedback:", error);
    return handleError(res, error, "Gagal mengirim feedback.");
  }
};
