// src/controllers/chatbotController.js
require("dotenv").config();
const { handleSuccess, handleError } = require("../utils/responseHandler");
const axios = require("axios");

exports.askGemini = async (req, res) => {
  const { question } = req.body;
  const userId = req.user?.uid;

  if (!question) {
    return handleError(res, {
      statusCode: 400,
      message: "Pertanyaan tidak boleh kosong.",
    });
  }

  if (!userId) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi pengguna diperlukan untuk menggunakan chatbot.",
    });
  }

  const externalChatbotApiUrl = process.env.EXTERNAL_CHATBOT_API_URL;
  if (!externalChatbotApiUrl) {
    console.error("EXTERNAL_CHATBOT_API_URL tidak diset di .env");
    return handleError(res, {
      statusCode: 503,
      message:
        "Layanan chatbot tidak tersedia saat ini karena masalah konfigurasi server.",
    });
  }

  try {
    console.log(
      `[ChatbotController] Mengirim permintaan ke API eksternal: ${externalChatbotApiUrl}`
    );
    console.log(
      `[ChatbotController] Request body:`,
      JSON.stringify({ question, userId })
    );

    const apiResponse = await axios.post(externalChatbotApiUrl, {
      question: question,
      userId: userId,
    });

    console.log(
      `[ChatbotController] Respon diterima dari API eksternal:`,
      apiResponse.data
    );

    if (apiResponse.data && apiResponse.data.answer) {
      return handleSuccess(
        res,
        200,
        "Jawaban berhasil diterima dari chatbot.",
        {
          question: apiResponse.data.question || question,
          answer: apiResponse.data.answer,
          suggestions: apiResponse.data.suggestions || [],
        }
      );
    } else {
      console.error(
        "[ChatbotController] Respon API eksternal tidak memiliki field 'answer'."
      );
      return handleError(res, {
        statusCode: 500,
        message: "Format respon dari layanan chatbot tidak sesuai.",
      });
    }
  } catch (error) {
    console.error(
      "[ChatbotController] Error memanggil API chatbot eksternal:",
      error.response ? error.response.data : error.message
    );
    let errorMessage = "Gagal mendapatkan jawaban dari chatbot eksternal.";
    let statusCode = 500;

    if (axios.isAxiosError(error)) {
      if (error.response) {
        statusCode = error.response.status || 500;
        errorMessage =
          error.response.data?.message ||
          error.response.data?.detail ||
          error.response.statusText ||
          "Layanan chatbot eksternal mengembalikan error.";
        console.error(
          `[ChatbotController] Detail error API eksternal (${statusCode}):`,
          error.response.data
        );
      } else if (error.request) {
        statusCode = 504;
        errorMessage =
          "Tidak ada respon dari layanan chatbot eksternal. Layanan mungkin tidak aktif.";
      } else {
        errorMessage = `Terjadi kesalahan saat menyiapkan permintaan ke chatbot: ${error.message}`;
      }
    } else {
      errorMessage = `Terjadi kesalahan internal: ${error.message}`;
    }

    return handleError(res, { statusCode: statusCode, message: errorMessage });
  }
};
