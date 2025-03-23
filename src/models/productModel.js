const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const Product = prisma.product;

module.exports = Product;
