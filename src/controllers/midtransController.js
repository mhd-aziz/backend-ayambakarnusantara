// midtransController.js

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Fungsi untuk memetakan payment_type dari Midtrans ke PaymentMethod enum
function mapPaymentMethod(paymentType) {
  switch (paymentType) {
    case "credit_card":
      return "CREDIT_CARD";
    case "bank_transfer":
      return "BANK_TRANSFER";
    case "ewallet":
      return "E_WALLET";
    default:
      return null; // Mengembalikan null jika metode pembayaran tidak dikenali
  }
}

async function handleMidtransNotification(req, res) {
  try {
    const notification = req.body;

    // Cek status transaksi yang diterima dari Midtrans
    const transactionStatus = notification.transaction_status;
    const orderId = notification.order_id;
    const paymentType = notification.payment_type;
    const transactionId = notification.transaction_id;

    // Memetakan payment_type ke PaymentMethod enum
    const paymentMethod = mapPaymentMethod(paymentType);

    // Fetch order from database
    const order = await prisma.order.findUnique({
      where: { id: parseInt(orderId) },
    });

    if (!order) {
      return res.status(404).send("Order not found");
    }

    // Update status berdasarkan status transaksi dari Midtrans
    if (transactionStatus === "capture") {
      // Jika statusnya capture, anggap pembayaran berhasil
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: "COMPLETED",
          paymentStatus: "PAID",
          transactionId: transactionId,
          paymentMethod: paymentMethod, // Simpan metode pembayaran yang sudah dipetakan
          paymentDate: new Date(),
        },
      });
    } else if (
      transactionStatus === "cancel" ||
      transactionStatus === "expire"
    ) {
      // Jika status transaksi dibatalkan atau kadaluarsa
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: "CANCELED",
          paymentStatus: "FAILED",
          transactionId: transactionId,
        },
      });
    } else if (transactionStatus === "pending") {
      // Jika transaksi masih pending
      await prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: "PENDING",
        },
      });
    }

    // Kirim response OK ke Midtrans setelah menerima notifikasi
    res.status(200).send("Notification received successfully");
  } catch (error) {
    console.error("Error handling Midtrans notification:", error);
    res.status(500).send("Internal Server Error");
  }
}

module.exports = { handleMidtransNotification };
