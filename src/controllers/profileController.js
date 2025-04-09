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

    res.status(200).json(user); // Mengirimkan data user, termasuk numberPhone
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Update profile user
exports.updateUserProfile = async (req, res) => {
  const { id, role } = req.auth;

  if (role !== "user") {
    return res.status(403).json({ message: "Access forbidden. Not a user." });
  }

  let { fullName, address, birthDate, username, email, phoneNumber } = req.body;
  const photoUser = req.file;

  try {
    const userId = parseInt(id);
    if (isNaN(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    // Mendapatkan data user yang ada untuk mempertahankan nilai yang tidak berubah
    const existingUser = await User.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Pertahankan nilai yang ada jika tidak ada data baru
    fullName =
      fullName !== undefined ? fullName || null : existingUser.fullName;
    address = address !== undefined ? address || null : existingUser.address;
    birthDate = birthDate
      ? new Date(birthDate).toISOString()
      : existingUser.birthDate;
    phoneNumber =
      phoneNumber !== undefined
        ? phoneNumber || null
        : existingUser.phoneNumber;
    username = username || existingUser.username;
    email = email || existingUser.email;

    let photoUrl;
    if (photoUser) {
      photoUrl = await uploadImageToFirebase(photoUser);
    } else {
      // Pertahankan URL foto yang ada
      photoUrl = existingUser.photoUser;
    }

    if (username !== existingUser.username) {
      const usernameExists = await User.findUnique({
        where: { username },
      });
      if (usernameExists && usernameExists.id !== userId) {
        return res.status(400).json({ message: "Username is already taken" });
      }
    }

    if (email !== existingUser.email) {
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
        photoUser: photoUrl,
        fullName,
        address,
        birthDate,
        username,
        email,
        phoneNumber,
      },
    });

    res.status(200).json(updatedUser);
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

    res.status(200).json(admin); // Mengirimkan data admin, termasuk numberPhone
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Update profile admin
exports.updateAdminProfile = async (req, res) => {
  const { id, role } = req.auth;

  if (role !== "admin") {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  let { fullName, address, birthDate, username, email, phoneNumber } = req.body;
  const photoAdmin = req.file;

  try {
    const adminId = parseInt(id);
    if (isNaN(adminId)) {
      return res.status(400).json({ message: "Invalid admin ID" });
    }

    const existingAdmin = await Admin.findUnique({
      where: { id: adminId },
    });

    if (!existingAdmin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    fullName =
      fullName !== undefined ? fullName || null : existingAdmin.fullName;
    address = address !== undefined ? address || null : existingAdmin.address;
    birthDate = birthDate
      ? new Date(birthDate).toISOString()
      : existingAdmin.birthDate;
    phoneNumber =
      phoneNumber !== undefined
        ? phoneNumber || null
        : existingAdmin.phoneNumber;
    username = username || existingAdmin.username;
    email = email || existingAdmin.email;

    let photoUrl;
    if (photoAdmin) {
      photoUrl = await uploadImageToFirebase(photoAdmin);
    } else {
      // Pertahankan URL foto yang ada
      photoUrl = existingAdmin.photoAdmin;
    }

    // Cek apakah username dan email sudah digunakan oleh admin lain
    if (username !== existingAdmin.username) {
      const usernameExists = await Admin.findUnique({
        where: { username },
      });
      if (usernameExists && usernameExists.id !== adminId) {
        return res.status(400).json({ message: "Username is already taken" });
      }
    }

    if (email !== existingAdmin.email) {
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
        photoAdmin: photoUrl,
        fullName,
        address,
        birthDate,
        username,
        email,
        phoneNumber,
      },
    });

    res.status(200).json(updatedAdmin);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Ubah password untuk user
exports.changeUserPassword = async (req, res) => {
  const { id, role } = req.auth;

  if (role !== "user") {
    return res.status(403).json({ message: "Access forbidden. Not a user." });
  }

  const { oldPassword, newPassword } = req.body; // Mendapatkan oldPassword dan newPassword

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

    // Verifikasi oldPassword dengan yang ada di database
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Old password is incorrect" });
    }

    // Enkripsi password baru
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    const updatedUser = await User.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    res
      .status(200)
      .json({ message: "Password updated successfully", user: updatedUser });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Ubah password untuk admin
exports.changeAdminPassword = async (req, res) => {
  const { id, role } = req.auth; // Mengambil ID dan role dari token yang ada di req.auth

  if (role !== "admin") {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  const { oldPassword, newPassword } = req.body; // Mendapatkan oldPassword dan newPassword

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

    // Verifikasi oldPassword dengan yang ada di database
    const isMatch = await bcrypt.compare(oldPassword, admin.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Old password is incorrect" });
    }

    // Enkripsi password baru
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    const updatedAdmin = await Admin.update({
      where: { id: adminId },
      data: { password: hashedPassword },
    });

    res
      .status(200)
      .json({ message: "Password updated successfully", admin: updatedAdmin });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};
