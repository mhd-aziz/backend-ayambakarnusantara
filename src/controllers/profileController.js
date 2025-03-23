const bcrypt = require("bcryptjs");
const User = require("../models/userModel");
const Admin = require("../models/adminModel");
const { validateEmail, validateUsername } = require("../utils/validation");
const { bucket } = require("../firebaseConfig");
const path = require("path");
const fs = require("fs");

// Fungsi untuk mengunggah gambar ke Firebase Storage
const uploadImageToFirebase = async (imageFile) => {
  const filePath = imageFile.path; // Path ke file sementara
  const fileName = Date.now() + path.extname(imageFile.originalname); // Membuat nama file unik
  const file = bucket.file(fileName);

  // Mengunggah file ke Firebase Storage
  await file.save(fs.readFileSync(filePath), {
    contentType: imageFile.mimetype,
    public: true, // Agar file dapat diakses publik
  });

  // Mendapatkan URL file yang telah di-upload
  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
  return publicUrl;
};

// Profile untuk user
exports.getUserProfile = async (req, res) => {
  const { id, role } = req.auth; // Mengambil ID dan role dari token yang ada di req.auth

  if (role !== "user") {
    return res.status(403).json({ message: "Access forbidden. Not a user." });
  }

  try {
    const userId = parseInt(id);
    if (isNaN(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const user = await User.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(user); // Mengirimkan data user
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Update profile user
exports.updateUserProfile = async (req, res) => {
  const { id, role } = req.auth; // Mengambil ID dan role dari token yang ada di req.auth

  if (role !== "user") {
    return res.status(403).json({ message: "Access forbidden. Not a user." });
  }

  let { fullName, address, birthDate, username, email } = req.body;
  const photoUser = req.file; // Mengambil file fotoUser

  try {
    const userId = parseInt(id);
    if (isNaN(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    // Menangani nilai kosong dan set them to null
    fullName = fullName || null;
    address = address || null;
    birthDate = birthDate ? new Date(birthDate).toISOString() : null;

    // Jika ada file foto, unggah ke Firebase Storage dan dapatkan URL-nya
    let photoUrl = null;
    if (photoUser) {
      photoUrl = await uploadImageToFirebase(photoUser);
    }

    // Cek apakah username dan email sudah digunakan oleh user lain
    if (username) {
      const usernameExists = await User.findUnique({
        where: { username },
      });
      if (usernameExists && usernameExists.id !== userId) {
        return res.status(400).json({ message: "Username is already taken" });
      }
    }

    if (email) {
      const emailExists = await User.findUnique({
        where: { email },
      });
      if (emailExists && emailExists.id !== userId) {
        return res.status(400).json({ message: "Email is already in use" });
      }
    }

    const updatedUser = await User.update({
      where: { id: userId },
      data: {
        photoUser: photoUrl || null, // Jika fotoUser kosong, set ke null
        fullName,
        address,
        birthDate,
        username,
        email,
      },
    });

    res.status(200).json(updatedUser); // Mengirimkan user yang sudah diupdate
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Profile untuk admin
exports.getAdminProfile = async (req, res) => {
  const { id, role } = req.auth; // Mengambil ID dan role dari token yang ada di req.auth

  if (role !== "admin") {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  try {
    const adminId = parseInt(id);
    if (isNaN(adminId)) {
      return res.status(400).json({ message: "Invalid admin ID" });
    }

    const admin = await Admin.findUnique({
      where: { id: adminId },
    });

    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    res.status(200).json(admin); // Mengirimkan data admin
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Update profile admin
exports.updateAdminProfile = async (req, res) => {
  const { id, role } = req.auth; // Mengambil ID dan role dari token yang ada di req.auth

  if (role !== "admin") {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  let { fullName, address, birthDate, username, email } = req.body;
  const photoAdmin = req.file; // Mengambil file fotoAdmin

  try {
    const adminId = parseInt(id);
    if (isNaN(adminId)) {
      return res.status(400).json({ message: "Invalid admin ID" });
    }

    // Menangani nilai kosong dan set them to null
    fullName = fullName || null;
    address = address || null;
    birthDate = birthDate ? new Date(birthDate).toISOString() : null;

    // Jika ada file foto, unggah ke Firebase Storage dan dapatkan URL-nya
    let photoUrl = null;
    if (photoAdmin) {
      photoUrl = await uploadImageToFirebase(photoAdmin);
    }

    // Cek apakah username dan email sudah digunakan oleh admin lain
    if (username) {
      const usernameExists = await Admin.findUnique({
        where: { username },
      });
      if (usernameExists && usernameExists.id !== adminId) {
        return res.status(400).json({ message: "Username is already taken" });
      }
    }

    if (email) {
      const emailExists = await Admin.findUnique({
        where: { email },
      });
      if (emailExists && emailExists.id !== adminId) {
        return res.status(400).json({ message: "Email is already in use" });
      }
    }

    const updatedAdmin = await Admin.update({
      where: { id: adminId },
      data: {
        photoAdmin: photoUrl || null, // Jika photoAdmin kosong, set ke null
        fullName,
        address,
        birthDate,
        username,
        email,
      },
    });

    res.status(200).json(updatedAdmin); // Mengirimkan admin yang sudah diupdate
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};
