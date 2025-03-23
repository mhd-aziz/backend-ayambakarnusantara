const midtransClient = require("midtrans-client");

let snap = new midtransClient.Snap({
  isProduction: false, // Change to true when in production
  serverKey: process.env.MIDTRANS_SERVER_KEY, // Get this from Midtrans
  clientKey: process.env.MIDTRANS_CLIENT_KEY, // Get this from Midtrans
});

module.exports = snap;
