const bcrypt = require("bcryptjs");
const User = require("../models/userModel");
const Admin = require("../models/adminModel");
const { generateToken } = require("../utils/generateToken");
const { validateEmail, validateUsername } = require("../utils/validation");
const nodemailer = require("nodemailer");
const VerificationCodeUser = require("../models/verificationCodeUserModel");
const VerificationCodeAdmin = require("../models/verificationCodeAdminModel");

// Register new user
exports.registerUser = async (req, res) => {
  const { username, email, password } = req.body;
  try {
    if (!validateEmail(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    if (!validateUsername(username)) {
      return res
        .status(400)
        .json({ message: "Username cannot contain spaces" });
    }

    // Cek apakah email atau username sudah terdaftar
    const userExists = await User.findUnique({
      where: { email },
    });
    if (userExists) {
      return res.status(400).json({ message: "Email is already in use" });
    }

    const usernameExists = await User.findUnique({
      where: { username },
    });
    if (usernameExists) {
      return res.status(400).json({ message: "Username is already taken" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      data: {
        email,
        password: hashedPassword,
        username,
      },
    });

    // Generate token with role "user"
    const token = generateToken(newUser.id, "user");
    res.status(201).json({ token, user: newUser });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Register new admin
exports.registerAdmin = async (req, res) => {
  const { username, email, password } = req.body;
  try {
    // Validasi email dan username
    if (!validateEmail(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    if (!validateUsername(username)) {
      return res
        .status(400)
        .json({ message: "Username cannot contain spaces" });
    }

    // Cek apakah username atau email sudah terdaftar
    const adminExists = await Admin.findUnique({
      where: { email },
    });
    if (adminExists) {
      return res.status(400).json({ message: "Email is already in use" });
    }

    const adminUsernameExists = await Admin.findUnique({
      where: { username },
    });
    if (adminUsernameExists) {
      return res.status(400).json({ message: "Username is already taken" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newAdmin = await Admin.create({
      data: {
        email,
        password: hashedPassword,
        username,
      },
    });

    // Generate token with role "admin"
    const token = generateToken(newAdmin.id, "admin");
    res.status(201).json({ token, admin: newAdmin });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Login user
exports.loginUser = async (req, res) => {
  const { identifier, password } = req.body;
  try {
    let user;
    if (validateEmail(identifier)) {
      user = await User.findUnique({
        where: { email: identifier },
      });
    } else {
      user = await User.findUnique({
        where: { username: identifier },
      });
    }

    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Generate token with role "user"
    const token = generateToken(user.id, "user");
    res.status(200).json({ token, user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Login admin
exports.loginAdmin = async (req, res) => {
  const { identifier, password } = req.body; // Menggunakan identifier (username atau email)
  try {
    let admin;
    if (validateEmail(identifier)) {
      admin = await Admin.findUnique({
        where: { email: identifier },
      });
    } else {
      admin = await Admin.findUnique({
        where: { username: identifier },
      });
    }

    if (!admin) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, admin.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Generate token with role "admin"
    const token = generateToken(admin.id, "admin");
    res.status(200).json({ token, admin });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

const sendVerificationEmail = async (email, verificationCode) => {
  let transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  // Menyusun pesan email dengan HTML untuk tampilan yang lebih baik
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Kode Verifikasi untuk Reset Password",
    html: `
      <h2>Hallo User</h2>
      <p>Terima kasih telah meminta untuk mereset password Anda.</p>
      <p>Berikut adalah kode verifikasi Anda: <strong>${verificationCode}</strong></p>
      <p>Pastikan untuk menggunakan kode ini dalam waktu 2 menit untuk melanjutkan proses reset password.</p>
      <br>
      <p>Jika Anda tidak melakukan permintaan ini, abaikan email ini.</p>
      <br>
      <p>Salam,</p>
      <p><em>Tim Ayam Bakar Nusantara</em></p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    throw new Error("Gagal mengirim email verifikasi. Silakan coba lagi.");
  }
};

// Forgot Password for User
exports.forgotPasswordUser = async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    // Check if a verification code was already sent within the last 2 minutes
    const existingCode = await VerificationCodeUser.findUnique({
      where: { userId: user.id },
    });

    if (existingCode && new Date() < new Date(existingCode.expiresAt)) {
      return res.status(400).json({
        message:
          "A verification code was already sent recently. Please wait before requesting again.",
      });
    }

    // Generate a new verification code
    const verificationCode = Math.floor(
      100000 + Math.random() * 900000
    ).toString();

    // Set expiration time to 2 minutes
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 2);

    // Store the verification code and expiration time
    await VerificationCodeUser.upsert({
      where: { userId: user.id },
      update: {
        code: verificationCode,
        expiresAt,
      },
      create: {
        code: verificationCode,
        expiresAt,
        userId: user.id,
      },
    });

    // Send the verification code via email
    await sendVerificationEmail(user.email, verificationCode);

    res.status(200).json({ message: "Verification code sent to your email" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Forgot Password for Admin
exports.forgotPasswordAdmin = async (req, res) => {
  const { email } = req.body;
  try {
    const admin = await Admin.findUnique({
      where: { email },
    });

    if (!admin) {
      return res.status(400).json({ message: "Admin not found" });
    }

    // Check if a verification code was already sent within the last 2 minutes
    const existingCode = await VerificationCodeAdmin.findUnique({
      where: { adminId: admin.id },
    });

    if (existingCode && new Date() < new Date(existingCode.expiresAt)) {
      return res.status(400).json({
        message:
          "A verification code was already sent recently. Please wait before requesting again.",
      });
    }

    // Generate a new verification code
    const verificationCode = Math.floor(
      100000 + Math.random() * 900000
    ).toString();

    // Set expiration time to 2 minutes
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 2);

    // Store the verification code and expiration time
    await VerificationCodeAdmin.upsert({
      where: { adminId: admin.id },
      update: {
        code: verificationCode,
        expiresAt,
      },
      create: {
        code: verificationCode,
        expiresAt,
        adminId: admin.id,
      },
    });

    // Send the verification code via email
    await sendVerificationEmail(admin.email, verificationCode);

    res.status(200).json({ message: "Verification code sent to your email" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Verify the code and reset password for User
exports.resetPasswordUser = async (req, res) => {
  const { email, verificationCode, newPassword } = req.body;
  try {
    const user = await User.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    // Fetch the verification code record
    const verificationRecord = await VerificationCodeUser.findUnique({
      where: { userId: user.id },
    });

    if (!verificationRecord) {
      return res.status(400).json({ message: "No verification request found" });
    }

    // Check if the verification code is valid and not expired
    if (verificationRecord.code !== verificationCode) {
      return res.status(400).json({ message: "Invalid verification code" });
    }

    if (new Date() > new Date(verificationRecord.expiresAt)) {
      return res.status(400).json({ message: "Verification code has expired" });
    }

    // Hash the new password and update
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.update({
      where: { email },
      data: { password: hashedPassword },
    });

    res.status(200).json({ message: "Password reset successful" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Verify the code and reset password for Admin
exports.resetPasswordAdmin = async (req, res) => {
  const { email, verificationCode, newPassword } = req.body;
  try {
    const admin = await Admin.findUnique({
      where: { email },
    });

    if (!admin) {
      return res.status(400).json({ message: "Admin not found" });
    }

    // Fetch the verification code record
    const verificationRecord = await VerificationCodeAdmin.findUnique({
      where: { adminId: admin.id },
    });

    if (!verificationRecord) {
      return res.status(400).json({ message: "No verification request found" });
    }

    // Check if the verification code is valid and not expired
    if (verificationRecord.code !== verificationCode) {
      return res.status(400).json({ message: "Invalid verification code" });
    }

    if (new Date() > new Date(verificationRecord.expiresAt)) {
      return res.status(400).json({ message: "Verification code has expired" });
    }

    // Hash the new password and update
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await Admin.update({
      where: { email },
      data: { password: hashedPassword },
    });

    res.status(200).json({ message: "Password reset successful" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};
