// src/config/midtransConfig.js
require("dotenv").config(); // Pastikan ini ada dan dipanggil sebelum variabel env digunakan

console.log("--- Midtrans Config Initialization ---");
console.log(
  "process.env.MIDTRANS_IS_PRODUCTION:",
  process.env.MIDTRANS_IS_PRODUCTION
);
console.log(
  "process.env.MIDTRANS_SERVER_KEY (first 5 chars):",
  process.env.MIDTRANS_SERVER_KEY
    ? process.env.MIDTRANS_SERVER_KEY.substring(0, 10) + "..."
    : "NOT SET"
);
console.log(
  "process.env.MIDTRANS_CLIENT_KEY (first 5 chars):",
  process.env.MIDTRANS_CLIENT_KEY
    ? process.env.MIDTRANS_CLIENT_KEY.substring(0, 10) + "..."
    : "NOT SET"
);

const midtransClient = require("midtrans-client");

const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === "true",
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

console.log(
  "Midtrans Snap instance configured. isProduction:",
  snap.apiConfig.isProduction
);
console.log("--- End Midtrans Config ---");

module.exports = snap;
