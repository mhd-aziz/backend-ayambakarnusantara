// src/utils/responseHandler.js

/**
 * Mengirim respons sukses standar.
 * @param {object} res - Objek respons Express.
 * @param {number} statusCode - Kode status HTTP.
 * @param {string} message - Pesan sukses.
 * @param {object} [data=null] - Data yang akan dikirim (opsional).
 */
exports.handleSuccess = (res, statusCode, message, data = null) => {
  const responsePayload = { success: true, message };
  if (data !== null) {
    responsePayload.data = data;
  }
  return res.status(statusCode).json(responsePayload);
};

/**
 * Menangani dan mengirim respons error standar.
 * @param {object} res - Objek respons Express.
 * @param {Error | object} error - Objek error atau objek custom error.
 * @param {string} [defaultMessage='Terjadi kesalahan pada server.'] - Pesan default jika tidak ada pesan spesifik.
 */
exports.handleError = (
  res,
  error,
  defaultMessage = "Terjadi kesalahan pada server."
) => {
  console.error(
    `Error Handler: Message: "${error.message}"`,
    error.code ? `Firebase Code: ${error.code}` : "",
    error.statusCode ? `Custom Status: ${error.statusCode}` : "",
    error.errorCode ? `Custom ErrorCode: ${error.errorCode}` : "" // misal: TOKEN_EXPIRED
  );

  // Log stack trace untuk error yang tidak terduga di environment development
  if (
    process.env.NODE_ENV !== "production" &&
    error instanceof Error &&
    !error.code &&
    !error.statusCode &&
    error.stack
  ) {
    console.error("Stack Trace:", error.stack);
  }

  let statusCode = 500;
  let message = defaultMessage;

  if (error.code) {
    switch (error.code) {
      case "auth/email-already-exists":
      case "auth/email-already-in-use":
        statusCode = 400;
        message = "Email sudah terdaftar.";
        break;
      case "auth/invalid-email":
        statusCode = 400;
        message = "Format email tidak valid.";
        break;
      case "auth/weak-password":
        statusCode = 400;
        message = "Password terlalu lemah. Minimal 6 karakter.";
        break;
      case "auth/user-not-found":
        statusCode = 404;
        message = "Pengguna tidak ditemukan.";
        break;
      case "auth/invalid-credential":
        statusCode = 401;
        message = "Kredensial tidak valid atau autentikasi gagal.";
        break;
      case "auth/invalid-phone-number":
        statusCode = 400;
        message =
          "Nomor telepon tidak valid. Pastikan formatnya benar (misal: +6281234567890).";
        break;
      case "auth/phone-number-already-exists":
        statusCode = 400;
        message = "Nomor telepon sudah digunakan oleh akun lain.";
        break;
      case "auth/id-token-expired":
        statusCode = 401;
        message = "Sesi Anda telah berakhir. Silakan login kembali.";
        break;
      case "auth/id-token-revoked":
        statusCode = 401;
        message =
          "Sesi Anda tidak valid lagi atau telah dicabut. Silakan login kembali.";
        break;
      case "auth/argument-error":
      case "auth/invalid-id-token":
        statusCode = 401;
        message = "Token autentikasi tidak valid atau formatnya salah.";
        break;
      default:
        if (error.message && error.message.includes("E.164")) {
          statusCode = 400;
          message =
            "Nomor telepon harus dalam format E.164 (contoh: +6281234567890).";
        } else if (error.message) {
          message = error.message;
        }
    }
  } else if (error.isJoi) {
    statusCode = 400;
    message = error.details.map((detail) => detail.message).join(", ");
  } else if (error.statusCode) {
    statusCode = error.statusCode;
    message = error.message || defaultMessage;
  }

  return res.status(statusCode).json({ success: false, message });
};
