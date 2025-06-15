const multer = require("multer");
const storageConfig = multer.memoryStorage();
const fileFilterConfig = (req, file, cb) => {
  const allowedMimeTypes = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
  ];
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true); 
  } else {
    const error = new Error(
      "Format file tidak didukung! Hanya gambar (JPEG, PNG, GIF, WEBP) yang diizinkan."
    );
    error.statusCode = 400;
    cb(error, false);
  }
};

const upload = multer({
  storage: storageConfig,
  fileFilter: fileFilterConfig,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

module.exports = upload;
