// src/middlewares/multerMiddleware.js
const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // Menyimpan file di folder 'uploads/'
  },
  filename: (req, file, cb) => {
    // Menambahkan timestamp agar nama file unik
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

module.exports = upload;
