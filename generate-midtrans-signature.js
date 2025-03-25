const crypto = require("crypto");

// 1. Masukkan nilai-nilai transaksi Anda di sini
const orderId = "ORD1742915406925710"; // Ganti dengan nomor pesanan yang valid di sistem Anda
const statusCode = "200";
const grossAmount = "50000.00"; // Pastikan menggunakan format dengan 2 angka desimal
const serverKey = process.env.MIDTRANS_SERVER_KEY; // Ganti dengan Server Key Sandbox Anda

// 2. Gabungkan semua nilai tanpa separator
const stringToSign = orderId + statusCode + grossAmount + serverKey;
console.log("String to sign:", stringToSign);

// 3. Buat hash SHA-512
const signature = crypto
  .createHash("sha512")
  .update(stringToSign)
  .digest("hex");

// 4. Tampilkan hasilnya
console.log("\nSignature Key:", signature);

// 5. Tampilkan contoh payload untuk Postman
const payload = {
  transaction_time: new Date().toISOString(),
  transaction_status: "settlement",
  transaction_id: "5a9d494b-51c8-4b91-95a9-a9e845047495",
  status_message: "midtrans payment notification",
  status_code: statusCode,
  signature_key: signature,
  payment_type: "bank_transfer",
  order_id: orderId,
  merchant_id: "G123456789",
  gross_amount: grossAmount,
  fraud_status: "accept",
  currency: "IDR",
};

console.log("\nContoh Payload untuk Postman:");
console.log(JSON.stringify(payload, null, 2));
