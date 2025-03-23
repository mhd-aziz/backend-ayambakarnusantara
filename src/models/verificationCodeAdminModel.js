// src/models/userModel.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const VerificationCodeAdmin = prisma.verificationCodeAdmin;

module.exports = VerificationCodeAdmin;
