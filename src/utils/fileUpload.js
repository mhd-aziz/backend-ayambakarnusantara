// utils/fileUpload.js
const { bucket } = require("../firebaseConfig");
const path = require("path");
const fs = require("fs");

const uploadImageToFirebase = async (imageFile) => {
  const filePath = imageFile.path; // Path to the temporary file
  const fileName = Date.now() + path.extname(imageFile.originalname); // Create a unique file name
  const file = bucket.file(fileName);

  // Upload the file to Firebase Storage
  await file.save(fs.readFileSync(filePath), {
    contentType: imageFile.mimetype,
    public: true, // Make the file publicly accessible
  });

  // Get the file's public URL
  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
  return publicUrl;
};

module.exports = uploadImageToFirebase;
