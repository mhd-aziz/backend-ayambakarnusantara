const { PrismaClient } = require("@prisma/client");
const snap = require("../utils/midtransConfig");
const prisma = new PrismaClient();

async function createOrder(req, res) {
  try {
    const { userId, productId, quantity, fullName, email, phone } = req.body;

    // Fetch product details
    const product = await prisma.product.findUnique({
      where: { id: productId },
    });

    // Validate product existence
    if (!product) {
      return res.status(404).send("Product not found");
    }

    // Calculate total price
    const total = product.price * quantity;

    // Set the expiry date (e.g., 1 hour from now)
    const expiryDate = new Date();
    expiryDate.setHours(expiryDate.getHours() + 1); // Payment expiry set to 1 hour

    // Create the order in the database (status set to 'pending')
    const order = await prisma.order.create({
      data: {
        userId,
        productId,
        quantity,
        total,
        status: "PENDING", // Set order status as 'pending'
        paymentMethod: null, // Will be filled after payment
        paymentStatus: "PENDING", // Initially set to 'pending'
        paymentToken: null, // Will be filled with the token from Midtrans
        transactionId: null, // Will be filled with transaction ID from Midtrans
        paymentDate: null, // Not set until payment is successful
        expiryDate: expiryDate, // Set the expiry date for the payment
      },
    });

    // Prepare transaction details for Midtrans payment
    const transactionDetails = {
      order_id: order.id.toString(),
      gross_amount: total, // Set the gross amount to the total price of the order
    };

    // Prepare item details, set the price per item, not the total
    const itemDetails = [
      {
        id: product.id.toString(),
        price: product.price, // Set the price per item (not the total)
        quantity: quantity, // The quantity of items ordered
        name: product.name,
      },
    ];

    const customerDetails = {
      first_name: fullName, // Full name from the request
      email: email,
      phone: phone, // Phone number from the request
    };

    const parameter = {
      transaction_details: transactionDetails,
      item_details: itemDetails,
      customer_details: customerDetails,
    };

    // Create payment token via Midtrans
    const paymentTokenResponse = await snap.createTransaction(parameter);
    const paymentToken = paymentTokenResponse.token;
    const transactionId = paymentTokenResponse.transaction_id;

    // Update order with payment token, transaction ID, and set status to waiting for payment
    await prisma.order.update({
      where: { id: order.id },
      data: {
        paymentToken,
        transactionId,
        paymentMethod: "CREDIT_CARD", // Assuming this is the method. Replace if necessary
        paymentStatus: "WAITING_FOR_PAYMENT", // Status changed to waiting for payment
      },
    });

    // Send the payment token to the client for redirection to the Midtrans payment page
    res.json({ paymentToken, orderId: order.id });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).send("Internal Server Error");
  }
}

module.exports = { createOrder };
