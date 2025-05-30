// src/index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const authRoutes = require("./routes/authRoutes");
const profileRoutes = require("./routes/profileRoutes");
const shopRoutes = require("./routes/shopRoutes");
const productRoutes = require("./routes/productRoutes");
const cartRoutes = require("./routes/cartRoutes");
const orderRoutes = require("./routes/orderRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const ratingRoutes = require("./routes/ratingRoutes");
const chatbotRoutes = require("./routes/chatbotRoutes");
const chatRoutes = require("./routes/chatRoutes");
require("./config/firebaseConfig");

const { handleError } = require("./utils/responseHandler");
const app = express();
const port = process.env.PORT || 3000;

app.use(cors({
  origin: process.env.FRONTEND_APP_URL || "http://localhost:3000",
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get("/", (req, res) => {
  res.send("Selamat datang di API Ayam Bakar Nusantara!");
});

app.use("/auth", authRoutes);
app.use("/profile", profileRoutes);
app.use("/shop", shopRoutes);
app.use("/product", productRoutes);
app.use("/cart", cartRoutes);
app.use("/order", orderRoutes);
app.use("/payment", paymentRoutes);
app.use("/rating", ratingRoutes);
app.use("/chatbot", chatbotRoutes);
app.use("/chat", chatRoutes);

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  if (err instanceof multer.MulterError) {
    let message = `Kesalahan unggah file: ${err.message}.`;
    if (err.code === "LIMIT_FILE_SIZE") {
      message = "Ukuran file terlalu besar dari batas yang diizinkan.";
    } else if (err.code === "LIMIT_FILE_COUNT") {
      message = "Jumlah file yang diunggah melebihi batas.";
    } else if (err.code === "LIMIT_UNEXPECTED_FILE") {
      message = `Jenis file tidak terduga atau nama field salah. Field: ${
        err.field || "tidak diketahui"
      }.`;
    }
    return handleError(res, { statusCode: 400, message });
  }

  return handleError(res, err, "Terjadi kesalahan tidak terduga pada server.");
});

app.listen(port, () => {
  console.log(
    `Server Ayam Bakar Nusantara berjalan di http://localhost:${port}`
  );
});
