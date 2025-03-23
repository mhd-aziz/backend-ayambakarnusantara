const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const Order = prisma.order;

module.exports = Order;
