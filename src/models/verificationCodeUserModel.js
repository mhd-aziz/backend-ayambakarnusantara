// src/models/userModel.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const VerificationCodeUser = prisma.verificationCodeUser;

module.exports = VerificationCodeUser;
