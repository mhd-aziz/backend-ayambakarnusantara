const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
let genAIInstance;
let geminiModel;

if (apiKey) {
  genAIInstance = new GoogleGenerativeAI(apiKey);
  geminiModel = genAIInstance.getGenerativeModel({ model: "models/gemini-2.5-flash-preview-05-20" });
  console.log("Gemini AI SDK initialized successfully.");
} else {
  console.warn(
    "GOOGLE_GEMINI_API_KEY is not set. Gemini chatbot features will be unavailable."
  );
}

module.exports = {
  geminiModel,
};
