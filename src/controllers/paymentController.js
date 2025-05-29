// src/controllers/PaymentController.js
require("dotenv").config();
const { firestore } = require("../config/firebaseConfig");
const snap = require("../config/midtransConfig");
const { handleSuccess, handleError } = require("../utils/responseHandler");

exports.createMidtransTransaction = async (req, res) => {
  const customerId = req.user?.uid;
  const { orderId } = req.params;

  const FRONTEND_BASE_URL = process.env.FRONTEND_APP_URL;

  if (!customerId) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }
  if (!orderId) {
    return handleError(res, {
      statusCode: 400,
      message: "ID Pesanan diperlukan.",
    });
  }

  const orderRef = firestore.collection("orders").doc(orderId);
  const usersCollection = firestore.collection("users");

  try {
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Pesanan tidak ditemukan.",
      });
    }
    const orderData = orderDoc.data();

    if (orderData.userId !== customerId) {
      return handleError(res, {
        statusCode: 403,
        message: "Anda tidak berhak melakukan pembayaran untuk pesanan ini.",
      });
    }
    if (orderData.paymentDetails.method.toUpperCase() !== "ONLINE_PAYMENT") {
      return handleError(res, {
        statusCode: 400,
        message: "Metode pembayaran pesanan ini bukan ONLINE_PAYMENT.",
      });
    }

    if (
      orderData.paymentDetails.midtransSnapToken &&
      orderData.paymentDetails.midtransRedirectUrl &&
      (orderData.orderStatus === "AWAITING_PAYMENT" ||
        orderData.orderStatus === "PAYMENT_FAILED")
    ) {
      console.log(
        `[PaymentController] Reusing existing Snap token for orderId: ${orderId}`
      );
      return handleSuccess(
        res,
        200,
        "Transaksi pembayaran sudah ada, silakan lanjutkan.",
        {
          token: orderData.paymentDetails.midtransSnapToken,
          redirect_url: orderData.paymentDetails.midtransRedirectUrl,
          orderId: orderId,
        }
      );
    }

    if (
      orderData.orderStatus !== "AWAITING_PAYMENT" &&
      orderData.orderStatus !== "PAYMENT_FAILED"
    ) {
      if (orderData.paymentDetails.status === "paid") {
        return handleError(res, {
          statusCode: 400,
          message: "Pesanan ini sudah dibayar.",
        });
      }
      return handleError(res, {
        statusCode: 400,
        message: `Pesanan dengan status "${orderData.orderStatus}" tidak dapat diproses untuk pembayaran baru.`,
      });
    }

    const customerUserDoc = await usersCollection.doc(customerId).get();
    if (!customerUserDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Data customer tidak ditemukan.",
      });
    }
    const customerData = customerUserDoc.data();
    const nameParts = customerData.displayName
      ? customerData.displayName.split(" ")
      : ["Pelanggan"];
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

    const midtransOrderIdForGateway = `${orderId}-${Date.now()}`;

    const parameter = {
      transaction_details: {
        order_id: midtransOrderIdForGateway,
        gross_amount: orderData.totalPrice,
      },
      item_details: orderData.items.map((item) => ({
        id: item.productId,
        price: item.price,
        quantity: item.quantity,
        name: item.name.substring(0, 50),
      })),
      customer_details: {
        first_name: firstName,
        last_name: lastName,
        email: customerData.email,
        phone: customerData.phoneNumber || undefined,
      },
      callbacks: {
        finish: `${FRONTEND_BASE_URL}/pesanan/${orderId}?payment_status=finish&transaction_id=${midtransOrderIdForGateway}`,
        unfinish: `${FRONTEND_BASE_URL}/pesanan/${orderId}?payment_status=unfinish&transaction_id=${midtransOrderIdForGateway}`,
        error: `${FRONTEND_BASE_URL}/pesanan/${orderId}?payment_status=error&transaction_id=${midtransOrderIdForGateway}`,
      },
    };

    console.log(
      "[PaymentController] Creating payment gateway transaction with params:",
      JSON.stringify(parameter, null, 2)
    );
    const transaction = await snap.createTransaction(parameter);
    const { token, redirect_url } = transaction;

    await orderRef.update({
      "paymentDetails.midtransSnapToken": token,
      "paymentDetails.midtransRedirectUrl": redirect_url,
      "paymentDetails.midtransOrderId": midtransOrderIdForGateway,
      "paymentDetails.status": "pending_gateway_payment", // Konsisten dengan getStatus
      orderStatus: "AWAITING_PAYMENT",
      updatedAt: new Date().toISOString(),
    });

    console.log(
      `[PaymentController] Payment gateway transaction created for orderId: ${orderId}, Gateway Order ID: ${midtransOrderIdForGateway}, Token: ${token}`
    );
    return handleSuccess(
      res,
      201,
      "Transaksi pembayaran berhasil dibuat. Anda akan diarahkan ke halaman pembayaran.",
      { token, redirect_url, orderId: orderId }
    );
  } catch (error) {
    console.error(
      "[PaymentController] Error creating payment gateway transaction:",
      error.message ? JSON.stringify(error.message) : error
    );

    let userFacingErrorMessage =
      "Gagal membuat transaksi pembayaran. Silakan coba lagi.";
    let responseStatusCode = 500;

    if (error.ApiResponse && error.ApiResponse.status_message) {
      userFacingErrorMessage = error.ApiResponse.status_message;
      responseStatusCode = error.ApiResponse.status_code || responseStatusCode;
    } else if (error.message) {
      try {
        const parsedError = JSON.parse(error.message);
        if (
          parsedError &&
          parsedError.error_messages &&
          parsedError.error_messages.length > 0
        ) {
          userFacingErrorMessage = parsedError.error_messages.join(", ");
        } else if (parsedError && parsedError.status_message) {
          userFacingErrorMessage = parsedError.status_message;
        } else if (
          typeof error.message === "string" &&
          !error.message.startsWith("{")
        ) {
          userFacingErrorMessage = error.message;
        }
        if (error.httpStatusCode) responseStatusCode = error.httpStatusCode;
      } catch (e) {
        if (typeof error.message === "string" && error.message.length < 200) {
          userFacingErrorMessage = error.message;
        }
      }
    }

    return handleError(res, {
      statusCode: responseStatusCode,
      message: `Gagal membuat transaksi pembayaran: ${userFacingErrorMessage}`,
    });
  }
};

exports.getMidtransTransactionStatus = async (req, res) => {
  const customerId = req.user?.uid;
  const { orderId } = req.params;

  if (!customerId) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }
  if (!orderId) {
    return handleError(res, {
      statusCode: 400,
      message: "ID Pesanan diperlukan.",
    });
  }

  const orderRef = firestore.collection("orders").doc(orderId);

  try {
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) {
      return handleError(res, {
        statusCode: 404,
        message: "Pesanan tidak ditemukan.",
      });
    }
    const orderData = orderDoc.data();

    if (orderData.userId !== customerId) {
      return handleError(res, {
        statusCode: 403,
        message: "Anda tidak berhak melihat status pembayaran pesanan ini.",
      });
    }

    if (orderData.paymentDetails.method.toUpperCase() !== "ONLINE_PAYMENT") {
      return handleError(res, {
        statusCode: 400,
        message: "Pesanan ini tidak menggunakan metode pembayaran online.",
      });
    }

    // Menggunakan nama field yang konsisten seperti yang diupdate di createMidtransTransaction
    const gatewayAssignedOrderId =
      orderData.paymentDetails?.gatewayAssignedOrderId ||
      orderData.paymentDetails?.midtransOrderId;

    if (!gatewayAssignedOrderId) {
      return handleError(res, {
        statusCode: 404,
        message:
          "Informasi transaksi pembayaran tidak ditemukan untuk pesanan ini. Mohon untuk lakukan pembayaran segera agar dapat di proses pesanan Anda.",
      });
    }

    console.log(
      `[PaymentController] Getting payment gateway status for gateway-assigned order_id: ${gatewayAssignedOrderId} (Our orderId: ${orderId})`
    );
    const paymentGatewayStatusResponse = await snap.transaction.status(
      gatewayAssignedOrderId
    );
    console.log(
      "[PaymentController] Payment gateway status response:",
      paymentGatewayStatusResponse
    );

    const currentInternalPaymentStatus = orderData.paymentDetails.status;
    const currentInternalOrderStatus = orderData.orderStatus;

    let needsUpdate = false;
    let updateFields = {};

    const { transaction_status, fraud_status, payment_type, transaction_id } =
      paymentGatewayStatusResponse;

    if (transaction_status === "capture") {
      if (
        fraud_status === "accept" &&
        currentInternalPaymentStatus !== "paid"
      ) {
        updateFields["orderStatus"] = "PROCESSING";
        updateFields["paymentDetails.status"] = "paid";
        needsUpdate = true;
      }
    } else if (
      transaction_status === "settlement" &&
      currentInternalPaymentStatus !== "paid"
    ) {
      updateFields["orderStatus"] = "PROCESSING";
      updateFields["paymentDetails.status"] = "paid";
      needsUpdate = true;
    } else if (
      transaction_status === "pending" &&
      currentInternalPaymentStatus !== "pending_gateway_payment" // Konsisten dengan status di create
    ) {
      updateFields["orderStatus"] = "AWAITING_PAYMENT";
      updateFields["paymentDetails.status"] = "pending_gateway_payment";
      needsUpdate = true;
    } else if (
      (transaction_status === "deny" ||
        transaction_status === "expire" ||
        transaction_status === "cancel") &&
      currentInternalOrderStatus !== "PAYMENT_FAILED"
    ) {
      updateFields["orderStatus"] = "PAYMENT_FAILED";
      updateFields["paymentDetails.status"] = transaction_status;
      needsUpdate = true;
    }

    if (needsUpdate) {
      // Menggunakan nama field yang konsisten
      updateFields["paymentDetails.gatewayTransactionId"] =
        transaction_id || orderData.paymentDetails.gatewayTransactionId;
      updateFields["paymentDetails.paymentType"] =
        payment_type || orderData.paymentDetails.paymentType;
      updateFields.updatedAt = new Date().toISOString();
      console.log(
        `[PaymentController] Syncing order ${orderId} status with payment gateway response. Updates:`,
        updateFields
      );
      await orderRef.update(updateFields);
    }

    const finalOrderDoc = await orderRef.get();
    const finalOrderData = finalOrderDoc.data();

    let successMessageUserFacing;

    switch (transaction_status) {
      case "pending":
        successMessageUserFacing =
          "Pembayaran Anda sedang menunggu penyelesaian. Harap lakukan pembayaran jika belum.";
        break;
      case "expire":
        successMessageUserFacing =
          "Waktu pembayaran telah habis. Silakan coba lakukan pembayaran lagi jika pesanan masih diinginkan.";
        break;
      case "cancel":
        successMessageUserFacing =
          "Pembayaran telah dibatalkan. Anda dapat mencoba melakukan pembayaran lagi jika diperlukan.";
        break;
      case "deny":
        successMessageUserFacing = "Pembayaran ditolak oleh penyedia layanan.";
        break;
      case "settlement":
      case "capture":
        successMessageUserFacing = "Pembayaran berhasil dan telah diterima.";
        break;
      default:
        successMessageUserFacing = `Status transaksi: ${transaction_status}.`;
    }

    if (needsUpdate) {
      successMessageUserFacing += " Status pesanan Anda juga telah diperbarui.";
    }

    return handleSuccess(res, 200, successMessageUserFacing, {
      paymentGatewayStatus: paymentGatewayStatusResponse,
      internalOrderStatus: finalOrderData.orderStatus,
      internalPaymentStatus: finalOrderData.paymentDetails.status,
      orderId: orderId,
    });
  } catch (error) {
    console.error(
      "[PaymentController] DETAILED Error getting payment gateway transaction status:",
      "\nError Object:",
      error,
      "\nError Message:",
      error.message || "N/A",
      "\nGateway HTTP Status Code:",
      error.httpStatusCode || "N/A", // Properti ini spesifik dari library midtrans-client
      "\nGateway API Response:",
      error.ApiResponse || "N/A", // Properti ini spesifik dari library midtrans-client
      "\nStack Trace:",
      error.stack
    );

    let userFacingErrorMessage =
      "Terjadi kesalahan saat memeriksa status pembayaran Anda. Silakan coba lagi nanti.";
    let responseStatusCode = 500;

    if (error.ApiResponse && typeof error.ApiResponse === "object") {
      responseStatusCode =
        parseInt(error.ApiResponse.status_code, 10) || responseStatusCode;
      let apiResponseMessage =
        error.ApiResponse.status_message ||
        (Array.isArray(error.ApiResponse.error_messages)
          ? error.ApiResponse.error_messages.join(", ")
          : null);

      if (responseStatusCode === 404) {
        userFacingErrorMessage =
          "Transaksi pembayaran tidak ditemukan, Pastikan anda sudah membayar nya";
      } else if (responseStatusCode === 401) {
        userFacingErrorMessage =
          "Gagal otentikasi dengan sistem pembayaran. Harap hubungi administrator.";
        responseStatusCode = 500;
      } else if (responseStatusCode >= 500) {
        userFacingErrorMessage =
          "Sistem pembayaran sedang mengalami gangguan. Silakan coba beberapa saat lagi.";
      } else if (apiResponseMessage) {
        userFacingErrorMessage = `Gagal memuat status: ${apiResponseMessage}`;
      } else {
        userFacingErrorMessage =
          "Gagal memuat status pembayaran karena respons tidak dikenal dari sistem pembayaran.";
      }
    } else if (error.message) {
      try {
        const parsedError = JSON.parse(error.message);
        responseStatusCode =
          parseInt(parsedError.status_code, 10) ||
          error.httpStatusCode ||
          responseStatusCode;
        let parsedMessage =
          parsedError.status_message ||
          (Array.isArray(parsedError.error_messages)
            ? parsedError.error_messages.join(", ")
            : null);

        if (responseStatusCode === 404) {
          userFacingErrorMessage =
            "Transaksi pembayaran tidak ditemukan. Pastikan pembayaran telah diinisiasi.";
        } else if (responseStatusCode === 401) {
          userFacingErrorMessage =
            "Masalah otentikasi dengan layanan pembayaran. Hubungi dukungan.";
          responseStatusCode = 500;
        } else if (responseStatusCode >= 500) {
          userFacingErrorMessage =
            "Layanan pembayaran sedang gangguan. Coba lagi nanti.";
        } else if (parsedMessage) {
          userFacingErrorMessage = parsedMessage;
        } else if (
          typeof error.message === "string" &&
          !error.message.toLowerCase().includes("unexpected token")
        ) {
          userFacingErrorMessage = error.message; // Gunakan jika bukan error parsing JSON
        }
      } catch (e) {
        if (typeof error.message === "string") {
          if (
            error.message.toLowerCase().includes("fetch failed") ||
            error.message.toLowerCase().includes("network error") ||
            error.message.toLowerCase().includes("socket hang up")
          ) {
            userFacingErrorMessage =
              "Tidak dapat terhubung ke layanan pembayaran. Periksa koneksi internet Anda atau coba lagi nanti.";
            responseStatusCode = 503;
          } else if (
            error.message.length < 200 &&
            !error.message.toLowerCase().includes("unexpected token")
          ) {
            userFacingErrorMessage = error.message;
          } else {
            userFacingErrorMessage =
              "Terjadi kesalahan internal saat memproses permintaan status pembayaran.";
          }
        }
      }
    }

    return handleError(res, {
      statusCode: responseStatusCode,
      message: userFacingErrorMessage,
    });
  }
};

exports.retryMidtransPayment = async (req, res) => {
  const customerId = req.user?.uid;
  const { orderId } = req.params;
  const FRONTEND_BASE_URL = process.env.FRONTEND_APP_URL;
  console.log(
    `[PaymentController] Attempting to RETRY payment gateway transaction for orderId: ${orderId}, customerId: ${customerId}`
  );

  if (!customerId) {
    return handleError(res, {
      statusCode: 401,
      message: "Otentikasi diperlukan.",
    });
  }
  if (!orderId) {
    return handleError(res, {
      statusCode: 400,
      message: "ID Pesanan diperlukan.",
    });
  }

  const orderRef = firestore.collection("orders").doc(orderId);
  const usersCollection = firestore.collection("users");

  try {
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) {
      console.log(`[PaymentController-Retry] Order ${orderId} not found.`);
      return handleError(res, {
        statusCode: 404,
        message: "Pesanan tidak ditemukan.",
      });
    }
    const orderData = orderDoc.data();
    console.log(
      `[PaymentController-Retry] Order data fetched for ${orderId}:`,
      JSON.stringify(orderData.paymentDetails)
    );

    if (orderData.userId !== customerId) {
      console.log(
        `[PaymentController-Retry] Auth failed: Order ${orderId} does not belong to customer ${customerId}.`
      );
      return handleError(res, {
        statusCode: 403,
        message:
          "Anda tidak berhak melakukan pembayaran ulang untuk pesanan ini.",
      });
    }
    if (orderData.paymentDetails.method.toUpperCase() !== "ONLINE_PAYMENT") {
      console.log(
        `[PaymentController-Retry] Validation failed: Order ${orderId} is not ONLINE_PAYMENT.`
      );
      return handleError(res, {
        statusCode: 400,
        message: "Metode pembayaran pesanan ini bukan ONLINE_PAYMENT.",
      });
    }

    const allowedRetryStatuses = ["AWAITING_PAYMENT", "PAYMENT_FAILED"];
    if (orderData.paymentDetails.status === "paid") {
      console.log(`[PaymentController-Retry] Order ${orderId} already paid.`);
      return handleError(res, {
        statusCode: 400,
        message: "Pesanan ini sudah dibayar.",
      });
    }
    if (!allowedRetryStatuses.includes(orderData.orderStatus)) {
      console.log(
        `[PaymentController-Retry] Order ${orderId} has status "${orderData.orderStatus}", not allowed for retry.`
      );
      return handleError(res, {
        statusCode: 400,
        message: `Pesanan dengan status "${orderData.orderStatus}" tidak dapat dicoba bayar ulang saat ini.`,
      });
    }

    console.log(
      `[PaymentController-Retry] Fetching customer data for: ${customerId}`
    );
    const customerUserDoc = await usersCollection.doc(customerId).get();
    if (!customerUserDoc.exists) {
      console.log(
        `[PaymentController-Retry] Customer data not found for ${customerId}`
      );
      return handleError(res, {
        statusCode: 404,
        message: "Data customer tidak ditemukan.",
      });
    }
    const customerData = customerUserDoc.data();
    const nameParts = customerData.displayName
      ? customerData.displayName.split(" ")
      : ["Pelanggan"];
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

    const midtransOrderIdForGateway = `${orderId}-RETRY-${Date.now()}`;
    console.log(
      `[PaymentController-Retry] Generated NEW Gateway Order ID: ${midtransOrderIdForGateway}`
    );

    const parameter = {
      transaction_details: {
        order_id: midtransOrderIdForGateway,
        gross_amount: orderData.totalPrice,
      },
      item_details: orderData.items.map((item) => ({
        id: item.productId,
        price: item.price,
        quantity: item.quantity,
        name: item.name.substring(0, 50),
      })),
      customer_details: {
        first_name: firstName,
        last_name: lastName,
        email: customerData.email,
        phone: customerData.phoneNumber || undefined,
      },
      callbacks: {
        finish: `${FRONTEND_BASE_URL}/pesanan/${orderId}?payment_status=finish&transaction_id=${midtransOrderIdForGateway}`,
        unfinish: `${FRONTEND_BASE_URL}/pesanan/${orderId}?payment_status=unfinish&transaction_id=${midtransOrderIdForGateway}`,
        error: `${FRONTEND_BASE_URL}/pesanan/${orderId}?payment_status=error&transaction_id=${midtransOrderIdForGateway}`,
      },
    };
    console.log(
      "[PaymentController-Retry] Payment gateway transaction parameter prepared:",
      JSON.stringify(parameter)
    );

    console.log("[PaymentController-Retry] Calling snap.createTransaction...");
    const transaction = await snap.createTransaction(parameter);
    console.log(
      "[PaymentController-Retry] Payment gateway transaction (retry) created successfully:",
      transaction
    );
    const { token, redirect_url } = transaction;

    const updateFieldsRetry = {
      "paymentDetails.midtransSnapToken": token,
      "paymentDetails.midtransRedirectUrl": redirect_url,
      "paymentDetails.midtransOrderId": midtransOrderIdForGateway,
      "paymentDetails.status": "pending_gateway_payment",
      updatedAt: new Date().toISOString(),
    };

    if (orderData.orderStatus === "PAYMENT_FAILED") {
      updateFieldsRetry.orderStatus = "AWAITING_PAYMENT";
    } else {
      updateFieldsRetry.orderStatus = orderData.orderStatus; // Pertahankan status jika AWAITING_PAYMENT
    }

    console.log(
      `[PaymentController-Retry] Updating order ${orderId} with new payment gateway info.`
    );
    await orderRef.update(updateFieldsRetry);
    console.log(
      `[PaymentController-Retry] Order ${orderId} updated for retry.`
    );

    return handleSuccess(
      res,
      201,
      "Transaksi pembayaran ulang berhasil dibuat. Anda akan diarahkan ke halaman pembayaran.",
      { token, redirect_url, orderId: orderId }
    );
  } catch (error) {
    console.error(
      "[PaymentController-Retry] Error creating retry payment gateway transaction:",
      error.message ? JSON.stringify(error.message) : error
    );

    let userFacingErrorMessage =
      "Gagal membuat transaksi pembayaran ulang. Silakan coba lagi.";
    let responseStatusCode = 500;

    if (error.ApiResponse && error.ApiResponse.status_message) {
      userFacingErrorMessage = error.ApiResponse.status_message;
      responseStatusCode = error.ApiResponse.status_code || responseStatusCode;
    } else if (error.message) {
      try {
        const parsedError = JSON.parse(error.message);
        if (
          parsedError &&
          parsedError.error_messages &&
          parsedError.error_messages.length > 0
        ) {
          userFacingErrorMessage = parsedError.error_messages.join(", ");
        } else if (parsedError && parsedError.status_message) {
          userFacingErrorMessage = parsedError.status_message;
        } else if (
          typeof error.message === "string" &&
          !error.message.startsWith("{")
        ) {
          userFacingErrorMessage = error.message;
        }
        if (error.httpStatusCode) responseStatusCode = error.httpStatusCode;
      } catch (e) {
        if (typeof error.message === "string" && error.message.length < 200) {
          userFacingErrorMessage = error.message;
        }
      }
    }

    return handleError(res, {
      statusCode: responseStatusCode,
      message: `Gagal membuat transaksi pembayaran ulang: ${userFacingErrorMessage}`,
    });
  }
};
