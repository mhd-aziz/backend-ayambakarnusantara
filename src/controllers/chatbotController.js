// src/controllers/chatbotController.js
const { geminiModel } = require("../config/geminiConfig");
const { handleSuccess, handleError } = require("../utils/responseHandler"); //
const { firestore } = require("../config/firebaseConfig"); //

// --- Fungsi Helper untuk Data Produk ---
async function getProductInfo(productName) {
  try {
    console.log(
      `[getProductInfo] Searching for exact product name: "${productName}"`
    );
    const productsRef = firestore.collection("products");
    const snapshot = await productsRef
      .where("name", "==", productName)
      .limit(1)
      .get();
    if (snapshot.empty) {
      console.log(
        `[getProductInfo] Product "${productName}" not found with exact match.`
      );
      return null;
    }
    const productData = snapshot.docs[0].data();
    productData._id = snapshot.docs[0].id;
    console.log(
      `[getProductInfo] Product "${productName}" found:`,
      productData
    );
    return productData;
  } catch (error) {
    console.error(
      `Error fetching product "${productName}" from Firestore:`,
      error
    );
    return null;
  }
}

async function getAllProductsInfo() {
  try {
    const productsSnapshot = await firestore.collection("products").get();
    if (productsSnapshot.empty) return [];
    return productsSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        _id: doc.id,
        name: data.name,
        price: data.price,
        description: data.description,
        category: data.category,
        stock: data.stock,
        productImageURL: data.productImageURL,
      };
    });
  } catch (error) {
    console.error("Error fetching all products from Firestore:", error);
    return [];
  }
}

// --- Fungsi Helper untuk Data Pesanan & Pembayaran ---
async function getUserOrderInfo(userId, orderIdQuery) {
  if (!userId) return null;
  try {
    let query = firestore.collection("orders").where("userId", "==", userId); //

    if (orderIdQuery) {
      const specificOrderDoc = await firestore
        .collection("orders")
        .doc(orderIdQuery)
        .get();
      if (
        specificOrderDoc.exists &&
        specificOrderDoc.data().userId === userId
      ) {
        return [specificOrderDoc.data()];
      }
      query = query.orderBy("createdAt", "desc").limit(10);
      const snapshot = await query.get();
      if (snapshot.empty) return [];
      const userOrders = snapshot.docs.map((doc) => doc.data());
      const specificOrder = userOrders.find(
        (order) =>
          order.orderId &&
          (order.orderId.toLowerCase() === orderIdQuery.toLowerCase() ||
            order.orderId.toLowerCase().includes(orderIdQuery.toLowerCase()))
      );
      return specificOrder ? [specificOrder] : [];
    } else {
      query = query.orderBy("createdAt", "desc").limit(3);
      const snapshot = await query.get();
      if (snapshot.empty) return [];
      return snapshot.docs.map((doc) => doc.data());
    }
  } catch (error) {
    console.error(
      `Error fetching orders for user ${userId} from Firestore:`,
      error
    );
    return [];
  }
}

// --- Fungsi Helper untuk Data Toko ---
async function getShopInfo(shopNameQuery) {
  try {
    const shopsRef = firestore.collection("shops");
    const snapshot = await shopsRef.get();
    if (snapshot.empty) return null;

    const allShops = snapshot.docs.map((doc) => doc.data());
    const foundShop = allShops.find(
      (shop) =>
        shop.shopName &&
        shop.shopName.toLowerCase().includes(shopNameQuery.toLowerCase())
    );

    if (foundShop) {
      return {
        shopName: foundShop.shopName,
        description: foundShop.description,
        shopAddress: foundShop.shopAddress,
        bannerImageURL: foundShop.bannerImageURL,
        operationalHours: foundShop.operationalHours,
      };
    }
    return null;
  } catch (error) {
    console.error("Error fetching shop info from Firestore:", error);
    return null;
  }
}

async function getAllShopsInfo() {
  try {
    const shopsSnapshot = await firestore.collection("shops").limit(10).get();
    if (shopsSnapshot.empty) return [];
    return shopsSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        shopName: data.shopName,
        description: data.description,
        shopAddress: data.shopAddress,
        operationalHours: data.operationalHours,
      };
    });
  } catch (error) {
    console.error("Error fetching all shops from Firestore:", error);
    return [];
  }
}

function capitalizeWords(str) {
  if (!str) return "";
  return str.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

exports.askGemini = async (req, res) => {
  const { question } = req.body;
  const userId = req.user?.uid;

  if (!question) {
    return handleError(res, {
      statusCode: 400,
      message: "Pertanyaan tidak boleh kosong.",
    });
  }

  if (!geminiModel) {
    return handleError(res, {
      statusCode: 503,
      message:
        "Layanan chatbot tidak tersedia saat ini karena masalah konfigurasi.",
    });
  }

  try {
    let firestoreContext = "";
    const lowerCaseQuestion = question.toLowerCase();
    let intent = "unknown";
    let extractedProductName = ""; // Variabel untuk menyimpan nama produk yang diekstrak

    // --- Deteksi Intent dan Ekstraksi Entitas (Lebih Terstruktur) ---
    if (
      lowerCaseQuestion.includes("menu apa saja") ||
      lowerCaseQuestion.includes("daftar menu") || 
      lowerCaseQuestion.includes("cari menu dong") ||
      lowerCaseQuestion.includes("apakah ada menu apa saja?")
    ) {
      intent = "list_all_products";
    } else {
      const productPatterns = [
        {
          regex: /^(?:menu|info|detail|produk|makanan|minuman|tentang|harga)\s+(.+?)(\s*\?|$)/i,
          groupIndex: 1,
        }, 
        {
          regex:
            /^(?:ada|jual|sedia|punya)\s+(.+?)(\s*ada|\s*gak|\s*ga|\s*\?|$)/i,
          groupIndex: 1,
        }, // ada X, jual X
        { regex: /^(.+?)(\s*ada|\s*gak|\s*ga|\s*\?|$)/i, groupIndex: 1 }, 
      ];

      for (const pattern of productPatterns) {
        const match = lowerCaseQuestion.match(pattern.regex);
        if (match && match[pattern.groupIndex]) {
          const potentialName = match[pattern.groupIndex].trim();
          if (
            potentialName.length > 2 &&
            potentialName.length < 50 &&
            !potentialName.match(
              /saya|kamu|siapa|apa|kapan|dimana|bagaimana|berapa|cara|status|pesanan|order|toko|lokasi|alamat|bayar/i
            )
          ) {
            extractedProductName = potentialName.replace(/\s*\?$/, "").trim();
            intent = "product_info";
            break;
          }
        }
      }

      // Jika intent belum terdeteksi sebagai product_info, cek intent lain
      if (intent === "unknown") {
        if (
          userId &&
          (lowerCaseQuestion.includes("pesanan saya") ||
            lowerCaseQuestion.includes("status pesanan") ||
            lowerCaseQuestion.includes("order saya") ||
            lowerCaseQuestion.includes("pembayaran saya") ||
            lowerCaseQuestion.includes("status pembayaran"))
        ) {
          intent = "order_status";
        } else if (
          !userId &&
          (lowerCaseQuestion.includes("pesanan saya") ||
            lowerCaseQuestion.includes("status pesanan") ||
            lowerCaseQuestion.includes("status pembayaran"))
        ) {
          intent = "order_status_unauthenticated";
        } else if (
          lowerCaseQuestion.includes("toko") ||
          lowerCaseQuestion.includes("lokasi") ||
          lowerCaseQuestion.includes("alamat") ||
          lowerCaseQuestion.includes("jam buka") ||
          lowerCaseQuestion.includes("operasional")
        ) {
          intent = "shop_info";
        } else if (
          lowerCaseQuestion.includes("cara pesan") ||
          lowerCaseQuestion.includes("cara order") ||
          lowerCaseQuestion.includes("metode pembayaran") ||
          lowerCaseQuestion.includes("cara bayar")
        ) {
          intent = "how_to_order_payment";
        }
      }
    }
    console.log(
      `[DEBUG] Detected Intent: ${intent}, Extracted Product Name: "${extractedProductName}"`
    );

    // --- Logika berdasarkan Intent ---
    if (intent === "list_all_products") {
      const products = await getAllProductsInfo();
      if (products.length > 0) {
        firestoreContext =
          "\n\nBerikut adalah beberapa menu yang kami miliki dari berbagai toko:\n";
        products.slice(0, 7).forEach((product) => {
          firestoreContext += `- ${product.name} (Kategori: ${product.category}, Harga: Rp ${product.price})\n`;
        });
        if (products.length > 7)
          firestoreContext +=
            "...dan masih banyak lagi. Sebutkan nama produk spesifik jika ingin detail.\n";
      } else {
        firestoreContext =
          "\n\nSaat ini kami belum memiliki informasi daftar menu untuk ditampilkan.";
      }
    } else if (intent === "product_info") {
      if (extractedProductName) {
        console.log(
          `[DEBUG] Searching product info for: "${extractedProductName}"`
        );
        let foundProduct = await getProductInfo(extractedProductName); // Coba dengan nama persis (seperti yang diekstrak)

        if (!foundProduct) {
          const capitalizedProductName = capitalizeWords(extractedProductName);
          if (extractedProductName !== capitalizedProductName) {
            // Hanya coba kapitalisasi jika berbeda
            console.log(
              `[DEBUG] Product not found with exact match. Trying capitalized: "${capitalizedProductName}"`
            );
            foundProduct = await getProductInfo(capitalizedProductName);
          }
        }

        if (foundProduct) {
          firestoreContext = `\n\nYa, kami ada ${
            foundProduct.name
          }. Berikut detailnya:
          Harga: Rp ${foundProduct.price}
          Deskripsi: ${foundProduct.description || "Tidak ada deskripsi."}
          Kategori: ${foundProduct.category}
          Stok tersedia: ${
            foundProduct.stock !== undefined
              ? foundProduct.stock
              : "Tidak ada info stok."
          }`;
          if (foundProduct.productImageURL) {
            firestoreContext += `\nLihat gambar: ${foundProduct.productImageURL}`;
          }
        } else {
          console.log(
            `[DEBUG] Product not found with direct queries. Fallback to 'includes' search for: "${extractedProductName}"`
          );
          const allProducts = await getAllProductsInfo();
          const foundProductsByInclude = allProducts.filter(
            (p) =>
              p.name.toLowerCase().includes(extractedProductName.toLowerCase()) // Gunakan extractedProductName yang sudah di-lowercase
          );

          if (foundProductsByInclude.length === 1) {
            const product = foundProductsByInclude[0];
            firestoreContext = `\n\nYa, kami ada ${
              product.name
            }. Berikut detailnya:
            Harga: Rp ${product.price}
            Deskripsi: ${product.description || "Tidak ada deskripsi."}
            Kategori: ${product.category}
            Stok tersedia: ${
              product.stock !== undefined
                ? product.stock
                : "Tidak ada info stok."
            }`;
            if (product.productImageURL) {
              firestoreContext += `\nLihat gambar: ${product.productImageURL}`;
            }
          } else if (foundProductsByInclude.length > 1) {
            firestoreContext = `\n\nKami menemukan beberapa produk yang mungkin cocok dengan pencarian Anda untuk "${extractedProductName}":\n`;
            foundProductsByInclude.slice(0, 3).forEach((p) => {
              firestoreContext += `- ${p.name} (Harga: Rp ${p.price})\n`;
            });
            if (foundProductsByInclude.length > 3)
              firestoreContext += `... dan lainnya.`;
            firestoreContext += `\nMohon sebutkan lebih spesifik produk mana yang Anda maksud untuk detail lebih lanjut.`;
          } else {
            firestoreContext = `\n\nMaaf, kami tidak menemukan produk yang cocok dengan nama "${extractedProductName}". Mungkin Anda bisa coba kata kunci lain atau lihat daftar menu kami?`;
          }
        }
      } else {
        // Jika intent product_info tapi nama produk tidak berhasil diekstrak
        firestoreContext =
          "\n\nProduk apa yang ingin Anda ketahui informasinya? Mohon sebutkan nama produknya dengan lebih jelas.";
      }
    }
    else if (intent === "order_status") {
      let orderIdQuery = null;
      const orderIdMatch = lowerCaseQuestion.match(
        /(?:pesanan|order|pembayaran)\s+([a-z0-9\-_]+)/i
      );
      if (orderIdMatch && orderIdMatch[1]) {
        orderIdQuery = orderIdMatch[1];
      }

      const orders = await getUserOrderInfo(userId, orderIdQuery);
      if (orders && orders.length > 0) {
        firestoreContext =
          "\n\nBerikut informasi terkait pesanan dan pembayaran Anda:\n";
        orders.forEach((order) => {
          firestoreContext += `\nPesanan ID: ${order.orderId}\n`;
          firestoreContext += `Status Pesanan: ${order.orderStatus}\n`;
          firestoreContext += `Total Harga: Rp ${order.totalPrice}\n`;
          if (order.paymentDetails) {
            //
            firestoreContext += `Metode Pembayaran: ${order.paymentDetails.method}\n`; //
            firestoreContext += `Status Pembayaran: ${order.paymentDetails.status}\n`; //
            if (order.paymentDetails.method === "ONLINE_PAYMENT") {
              //
              if (
                order.paymentDetails.status === "pending_gateway_payment" ||
                order.paymentDetails.status === "pending" ||
                order.orderStatus === "AWAITING_PAYMENT"
              ) {
                firestoreContext += `Pembayaran Anda sedang diproses atau menunggu penyelesaian. `;
                if (order.paymentDetails.midtransRedirectUrl) {
                  //
                  firestoreContext += `Anda dapat melanjutkan atau mengecek pembayaran di: ${order.paymentDetails.midtransRedirectUrl}\n`; //
                } else {
                  firestoreContext += `Silakan tunggu konfirmasi atau coba cek kembali nanti.\n`;
                }
              } else if (
                order.paymentDetails.status === "paid" ||
                order.paymentDetails.status === "settlement" ||
                order.paymentDetails.status === "capture"
              ) {
                //
                firestoreContext += `Pembayaran Anda telah berhasil dan lunas.\n`;
              } else if (
                order.paymentDetails.status === "failed" ||
                order.paymentDetails.status === "deny" ||
                order.paymentDetails.status === "expire" ||
                order.paymentDetails.status === "cancel" ||
                order.orderStatus === "PAYMENT_FAILED"
              ) {
                firestoreContext += `Pembayaran Anda gagal atau dibatalkan. `;
                if (order.paymentDetails.midtransRedirectUrl) {
                  //
                  firestoreContext += `Anda mungkin bisa mencoba melakukan pembayaran ulang. Cek link berikut jika tersedia: ${order.paymentDetails.midtransRedirectUrl}\n`; //
                } else {
                  firestoreContext += `Silakan coba buat pesanan baru jika masih berminat.\n`;
                }
              }
            } else if (order.paymentDetails.method === "PAY_AT_STORE") {
              if (order.paymentDetails.status === "pay_on_pickup") {
                firestoreContext += `Anda akan melakukan pembayaran saat mengambil pesanan di toko.\n`;
              } else if (order.paymentDetails.status === "paid") {
                firestoreContext += `Pembayaran di toko telah dikonfirmasi lunas.\n`;
              }
            }
          } else {
            firestoreContext += `Informasi detail pembayaran tidak tersedia.\n`;
          }
          firestoreContext += "Item:\n";
          order.items.forEach((item) => {
            firestoreContext += `  - ${item.name} (Jumlah: ${item.quantity}, Harga: Rp ${item.price})\n`;
          });
          firestoreContext +=
            "Semua pesanan diambil sendiri oleh pelanggan di toko.\n";
        });
      } else if (orderIdQuery) {
        firestoreContext = `\n\nMaaf, kami tidak menemukan pesanan dengan ID atau kata kunci "${orderIdQuery}" milik Anda. Pastikan ID yang Anda masukkan benar.`;
      } else {
        firestoreContext =
          "\n\nMaaf, sepertinya Anda belum memiliki pesanan atau kami tidak dapat menemukannya saat ini. Anda bisa mencoba menyebutkan ID pesanan jika ada.";
      }
    } else if (intent === "order_status_unauthenticated") {
      firestoreContext =
        "\n\nUntuk memeriksa status pesanan atau pembayaran, silakan login terlebih dahulu.";
    } else if (intent === "shop_info") {
      let shopNameQuery = null;
      const shopNameMatch = lowerCaseQuestion.match(
        /(?:toko|gerai|outlet)\s+([^?.\n]+)/i
      );
      if (shopNameMatch && shopNameMatch[1]) {
        shopNameQuery = shopNameMatch[1]
          .replace(/milik siapa|punya siapa|di mana|bagaimana/gi, "")
          .trim();
      }

      if (shopNameQuery) {
        const shop = await getShopInfo(shopNameQuery);
        if (shop) {
          firestoreContext = `\n\nInformasi untuk ${shop.shopName}:
                Alamat: ${shop.shopAddress || "Belum ada informasi alamat."}
                Deskripsi: ${shop.description || "Selamat datang di toko kami!"}
                Jam Operasional: ${
                  shop.operationalHours ||
                  "Jam operasional bervariasi, silakan cek detail toko atau hubungi langsung jika tersedia."
                }`;
        } else {
          firestoreContext = `\n\nMaaf, kami tidak menemukan informasi untuk toko bernama "${shopNameQuery}". Anda bisa melihat daftar toko kami.`;
          const allShops = await getAllShopsInfo();
          if (allShops.length > 0) {
            firestoreContext += "\nBerikut beberapa toko yang terdaftar:\n";
            allShops
              .slice(0, 3)
              .forEach(
                (s) =>
                  (firestoreContext += `- ${s.shopName} (${
                    s.shopAddress || "Alamat belum tersedia"
                  })\n`)
              );
          }
        }
      } else if (
        lowerCaseQuestion.includes("daftar toko") ||
        lowerCaseQuestion.includes("semua toko")
      ) {
        const allShops = await getAllShopsInfo();
        if (allShops.length > 0) {
          firestoreContext =
            "\n\nBerikut beberapa toko yang terdaftar di Ayam Bakar Nusantara:\n";
          allShops.forEach((s) => {
            firestoreContext += `- Nama Toko: ${s.shopName}\n  Alamat: ${
              s.shopAddress || "Alamat belum tersedia."
            }\n  Deskripsi: ${s.description || ""}\n  Jam Operasional: ${
              s.operationalHours || "Hubungi toko untuk info jam operasional."
            }\n\n`;
          });
        } else {
          firestoreContext = "\n\nSaat ini belum ada toko yang terdaftar.";
        }
      } else {
        const allShops = await getAllShopsInfo();
        if (allShops.length > 0) {
          firestoreContext = `\n\nKami memiliki beberapa toko yang terdaftar di platform Ayam Bakar Nusantara. Contohnya, ${
            allShops[0].shopName
          } yang beralamat di ${
            allShops[0].shopAddress || "alamat belum diatur"
          }. Untuk detail jam operasional atau informasi toko spesifik, silakan sebutkan nama toko yang Anda maksud. Anda juga bisa bertanya "daftar semua toko".`;
        } else {
          firestoreContext =
            "\n\nInformasi jam operasional dan toko akan segera kami sediakan. Anda bisa menanyakan tentang menu atau cara pemesanan.";
        }
      }
    } else if (intent === "how_to_order_payment") {
      firestoreContext = `\n\nPemesanan di Ayam Bakar Nusantara mudah!
1.  Cari produk atau toko yang Anda inginkan.
2.  Tambahkan produk ke keranjang belanja Anda.
3.  Saat checkout, Anda bisa memilih metode pembayaran:
    a.  **Bayar di Tempat**: Bayar tunai atau dengan metode lain yang diterima toko saat Anda mengambil pesanan langsung di lokasi toko.
    b.  **Pembayaran Online**: Bayar aman melalui Midtrans menggunakan berbagai pilihan (kartu kredit/debit, e-wallet, transfer bank, dll).
4.  Setelah pesanan dikonfirmasi (dan pembayaran online berhasil), Anda akan menerima notifikasi kapan pesanan Anda siap untuk diambil.
5.  **PENTING**: Semua pesanan diambil sendiri oleh pelanggan di lokasi toko penjual. Kami tidak menyediakan layanan pengantaran saat ini.

Apakah ada hal lain yang bisa saya bantu terkait pemesanan atau pembayaran?`;
    }

    const prompt = `Anda adalah "Asisten Nusantara", chatbot AI untuk platform e-commerce "Ayam Bakar Nusantara". Platform ini adalah marketplace di mana berbagai penjual/toko ayam bakar dapat mendaftar dan menjual produk mereka.

Karakteristik Utama Platform:
- Marketplace: Banyak penjual/toko berbeda.
- Ambil Sendiri (Self Pickup): Pelanggan selalu mengambil pesanan mereka langsung di lokasi toko penjual. TIDAK ADA LAYANAN PENGANTARAN.
- Metode Pembayaran:
    1. Bayar di Tempat (Pay at Store): Pelanggan membayar saat mengambil pesanan di toko.
    2. Pembayaran Online: Pelanggan membayar di muka melalui gateway pembayaran Midtrans.

Tugas Anda sebagai Asisten Nusantara:
1.  Jawab pertanyaan pelanggan dengan ramah, sopan, jelas, dan informatif.
2.  Selalu gunakan informasi dari bagian '[Informasi Tambahan dari Database]' jika relevan dan tersedia untuk menjawab pertanyaan. Ini adalah sumber kebenaran utama Anda untuk data spesifik.
3.  Jika pelanggan bertanya tentang pesanan atau pembayaran spesifik mereka, dan Anda tidak diberi informasi pengguna (artinya mereka belum login), minta mereka untuk LOGIN terlebih dahulu untuk mengakses informasi tersebut.
4.  Jika pelanggan bertanya tentang sesuatu yang Anda tidak ketahui jawabannya (baik dari informasi tambahan maupun pengetahuan umum Anda), sampaikan dengan jujur bahwa Anda tidak memiliki informasi tersebut saat ini. Anda bisa menyarankan agar pelanggan "mencoba bertanya dengan kata kunci lain", "memeriksa daftar produk atau toko yang tersedia", atau jika benar-benar tidak ada solusi, katakan "Saya akan mencatat pertanyaan ini agar kami bisa tingkatkan layanan ke depannya." HINDARI mengarahkan ke layanan pelanggan lain karena ANDA ADALAH layanan pelanggan tersebut.
5.  Jangan pernah mengarang informasi, harga, status, atau detail lainnya jika tidak ada dalam konteks yang diberikan atau pengetahuan umum yang valid.
6.  Jika ada URL pembayaran yang relevan dan aktif untuk pesanan online yang belum dibayar atau gagal, sebutkan URL tersebut dengan jelas.
7.  Tekankan bahwa semua pesanan adalah untuk diambil sendiri di toko.
8.  Jika pengguna bertanya tentang ketersediaan produk umum (misalnya "ada tempe?", "jual tahu?", "menu nasi box"), carilah produk yang namanya mengandung kata kunci tersebut. Jika ada satu yang cocok persis (setelah normalisasi case) atau satu yang cocok via 'includes', berikan detailnya. Jika ada beberapa yang cocok via 'includes', sebutkan beberapa nama dan minta pengguna lebih spesifik. Jika tidak ada, informasikan demikian.

[Informasi Tambahan dari Database]
${
  firestoreContext ||
  "Tidak ada informasi spesifik dari database yang relevan untuk pertanyaan ini."
}
[/Informasi Tambahan dari Database]

Pertanyaan Pelanggan: "${question}"

Jawaban Anda:`;

    console.log("--- PROMPT TO GEMINI ---");
    console.log(prompt);
    console.log("--- END PROMPT ---");

    const result = await geminiModel.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    return handleSuccess(res, 200, "Jawaban berhasil diterima.", {
      question: question,
      answer: text,
    });
  } catch (error) {
    console.error(
      "Error calling Gemini API or interacting with Firestore:",
      error
    );
    let errorMessage = "Gagal mendapatkan jawaban dari chatbot.";
    if (error.message) {
      errorMessage += ` Detail: ${error.message}`;
    }
    if (error.response && error.response.data) {
      console.error("Gemini API Error Response:", error.response.data);
    }
    return handleError(res, { statusCode: 500, message: errorMessage });
  }
};
