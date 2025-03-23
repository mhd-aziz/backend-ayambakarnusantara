// src/models/userModel.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const Admin = prisma.admin;

module.exports = Admin;
