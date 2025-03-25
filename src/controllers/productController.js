const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const uploadImageToFirebase = require("../utils/fileUpload"); // Import image upload utility

// Validasi productId
const validateProductId = (productId) => {
  const parsedProductId = parseInt(productId, 10);
  if (isNaN(parsedProductId)) {
    return false;
  }
  return parsedProductId;
};

// Create a new product
exports.createProduct = async (req, res) => {
  const { name, description, price, stock } = req.body;
  const { id, role } = req.auth; // Get the admin ID and role from the token
  const photoProduct = req.file; // Get the product image

  // Validasi role
  if (role !== "admin") {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  // Validasi input yang diperlukan
  if (!name || price === undefined) {
    return res.status(400).json({ message: "Name and price are required." });
  }

  try {
    // Ensure price and stock are correctly parsed to float and integer respectively
    const parsedPrice = parseFloat(price);
    const parsedStock = parseInt(stock, 10) || 0; // Default to 0 if not provided

    if (isNaN(parsedPrice)) {
      return res.status(400).json({ message: "Invalid price value." });
    }

    // Find the shop associated with the admin
    const shop = await prisma.shop.findUnique({
      where: { adminId: id }, // The admin's associated shop
      select: { id: true }, // Hanya ambil id shop untuk optimasi query
    });

    if (!shop) {
      return res.status(404).json({ message: "No shop found for this admin." });
    }

    // Upload the product image to Firebase and get the URL
    let photoUrl = null;
    if (photoProduct) {
      try {
        photoUrl = await uploadImageToFirebase(photoProduct);
      } catch (uploadError) {
        console.error("Image upload error:", uploadError);
        return res
          .status(400)
          .json({ message: "Failed to upload product image." });
      }
    }

    // Create the new product for the shop
    const newProduct = await prisma.product.create({
      data: {
        name,
        description: description || "",
        price: parsedPrice,
        stock: parsedStock,
        shopId: shop.id,
        photoProduct: photoUrl,
      },
    });

    res.status(201).json(newProduct); // Send the created product
  } catch (error) {
    console.error("Create product error:", error);

    if (error.code) {
      if (error.code === "P2002") {
        return res
          .status(400)
          .json({ message: "A product with this name already exists." });
      }
    }

    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all products for the admin's shop with pagination
exports.getProductsByAdmin = async (req, res) => {
  const { id, role } = req.auth;
  const { page = 1, limit = 10, search = "" } = req.query;

  if (role !== "admin") {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  try {
    const parsedPage = parseInt(page, 10) || 1;
    const parsedLimit = parseInt(limit, 10) || 10;
    const skip = (parsedPage - 1) * parsedLimit;

    // Find the shop associated with the admin
    const shop = await prisma.shop.findUnique({
      where: { adminId: id },
      select: { id: true }, // Hanya ambil ID shop
    });

    if (!shop) {
      return res.status(404).json({ message: "No shop found for this admin." });
    }

    // Prepare search condition if provided
    const whereCondition = {
      shopId: shop.id,
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { description: { contains: search } },
            ],
          }
        : {}),
    };

    // Count total products for pagination
    const totalProducts = await prisma.product.count({
      where: whereCondition,
    });

    // Ambil produk berdasarkan shopId dengan pagination dan search
    const products = await prisma.product.findMany({
      where: whereCondition,
      orderBy: { updatedAt: "desc" },
      skip,
      take: parsedLimit,
    });

    // Return with pagination info
    res.status(200).json({
      products,
      pagination: {
        total: totalProducts,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(totalProducts / parsedLimit),
      },
    });
  } catch (error) {
    console.error("Get products error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update a product
exports.updateProduct = async (req, res) => {
  const { id, role } = req.auth; // Get the admin ID and role from the token
  const { name, description, price, stock, productId } = req.body; // Get product details
  const photoProduct = req.file; // Get the product image

  if (role !== "admin") {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  // Validasi apakah ada yang perlu diupdate
  if (
    !name &&
    description === undefined &&
    price === undefined &&
    stock === undefined &&
    !photoProduct
  ) {
    return res.status(400).json({ message: "No data provided for update." });
  }

  try {
    const parsedProductId = validateProductId(productId);

    if (!parsedProductId) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    // Parse nilai hanya jika disediakan
    let updateData = {};

    if (name !== undefined) {
      updateData.name = name;
    }

    if (description !== undefined) {
      updateData.description = description;
    }

    if (price !== undefined) {
      const parsedPrice = parseFloat(price);
      if (isNaN(parsedPrice)) {
        return res.status(400).json({ message: "Invalid price value." });
      }
      updateData.price = parsedPrice;
    }

    if (stock !== undefined) {
      const parsedStock = parseInt(stock, 10);
      if (isNaN(parsedStock)) {
        return res.status(400).json({ message: "Invalid stock value." });
      }
      updateData.stock = parsedStock;
    }

    // Find the product and confirm the admin has permission
    const product = await prisma.product.findUnique({
      where: { id: parsedProductId },
      include: { shop: { select: { adminId: true } } },
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found." });
    }

    if (product.shop.adminId !== id) {
      return res.status(403).json({
        message: "You do not have permission to update this product.",
      });
    }

    // Upload the product image if provided
    if (photoProduct) {
      try {
        const photoUrl = await uploadImageToFirebase(photoProduct);
        updateData.photoProduct = photoUrl;
      } catch (uploadError) {
        console.error("Image upload error:", uploadError);
        return res
          .status(400)
          .json({ message: "Failed to upload product image." });
      }
    }

    // Update the product
    const updatedProduct = await prisma.product.update({
      where: { id: parsedProductId },
      data: updateData,
    });

    res.status(200).json(updatedProduct);
  } catch (error) {
    console.error("Update product error:", error);

    if (error.code) {
      if (error.code === "P2002") {
        return res
          .status(400)
          .json({ message: "A product with this name already exists." });
      }
    }

    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Delete a product
exports.deleteProduct = async (req, res) => {
  const { id, role } = req.auth;
  const { productId } = req.params; // Gunakan params untuk REST API convention

  if (role !== "admin") {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  try {
    const parsedProductId = validateProductId(productId);

    if (!parsedProductId) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    // Check if product exists and admin has permission
    const product = await prisma.product.findUnique({
      where: { id: parsedProductId },
      include: { shop: { select: { adminId: true } } },
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found." });
    }

    if (product.shop.adminId !== id) {
      return res.status(403).json({
        message: "You do not have permission to delete this product.",
      });
    }

    // Check if product has related orderItems
    const orderItemsCount = await prisma.orderItem.count({
      where: { productId: parsedProductId },
    });

    // If product has order items, we shouldn't allow deletion or should handle differently
    if (orderItemsCount > 0) {
      // Option 1: Don't allow deletion
      // return res.status(400).json({
      //   message: "Cannot delete product with existing orders. Consider updating stock to 0 instead."
      // });

      // Option 2: Soft delete by setting stock to 0
      await prisma.product.update({
        where: { id: parsedProductId },
        data: { stock: 0 },
      });

      return res.status(200).json({
        message:
          "Product has existing orders. Stock has been set to 0 instead of deleting.",
        softDeleted: true,
      });
    }

    // Remove product from all carts first to maintain referential integrity
    await prisma.cartItem.deleteMany({
      where: { productId: parsedProductId },
    });

    // Delete the product
    await prisma.product.delete({
      where: { id: parsedProductId },
    });

    res.status(200).json({ message: "Product deleted successfully." });
  } catch (error) {
    console.error("Delete product error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all products for the user with pagination, filtering and sorting
exports.getProductsByUser = async (req, res) => {
  const { role } = req.auth; // Get the role from the token
  const {
    limit = 20,
    page = 1,
    sort = "newest",
    search = "",
    minPrice,
    maxPrice,
    shopId,
  } = req.query; // Query parameters for filtering and pagination

  if (role !== "user") {
    return res.status(403).json({ message: "Access forbidden. Not a user." });
  }

  try {
    const parsedLimit = parseInt(limit, 10) || 20;
    const parsedPage = parseInt(page, 10) || 1;
    const skip = (parsedPage - 1) * parsedLimit;

    // Build the where condition based on filters
    let whereCondition = {
      stock: { gt: 0 }, // Only show products with stock
    };

    // Add search filter if provided
    if (search) {
      whereCondition.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
      ];
    }

    // Add price range filter if provided
    if (minPrice !== undefined || maxPrice !== undefined) {
      whereCondition.price = {};

      if (minPrice !== undefined) {
        whereCondition.price.gte = parseFloat(minPrice);
      }

      if (maxPrice !== undefined) {
        whereCondition.price.lte = parseFloat(maxPrice);
      }
    }

    // Add shop filter if provided
    if (shopId) {
      whereCondition.shopId = parseInt(shopId, 10);
    }

    // Determine sorting
    let orderBy = {};
    switch (sort) {
      case "newest":
        orderBy = { createdAt: "desc" };
        break;
      case "oldest":
        orderBy = { createdAt: "asc" };
        break;
      case "price-low":
        orderBy = { price: "asc" };
        break;
      case "price-high":
        orderBy = { price: "desc" };
        break;
      case "name-asc":
        orderBy = { name: "asc" };
        break;
      case "name-desc":
        orderBy = { name: "desc" };
        break;
      default:
        orderBy = { createdAt: "desc" };
        break;
    }

    // Count total products for pagination info
    const totalProducts = await prisma.product.count({
      where: whereCondition,
    });

    // Find products with pagination
    const products = await prisma.product.findMany({
      where: whereCondition,
      orderBy,
      skip,
      take: parsedLimit,
      include: {
        shop: {
          select: {
            id: true,
            name: true,
            photoShop: true,
            address:true
          },
        },
      },
    });

    res.status(200).json({
      products,
      pagination: {
        total: totalProducts,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(totalProducts / parsedLimit),
      },
      filters: {
        search: search || null,
        minPrice: minPrice ? parseFloat(minPrice) : null,
        maxPrice: maxPrice ? parseFloat(maxPrice) : null,
        shopId: shopId ? parseInt(shopId, 10) : null,
        sort,
      },
    });
  } catch (error) {
    console.error("Get products error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all products for public users (without authentication)
exports.getPublicProducts = async (req, res) => {
  const {
    limit = 20,
    page = 1,
    sort = "newest",
    search = "",
    minPrice,
    maxPrice,
    shopId,
    category,
  } = req.query; // Query parameters for filtering and pagination

  try {
    const parsedLimit = parseInt(limit, 10) || 20;
    const parsedPage = parseInt(page, 10) || 1;
    const skip = (parsedPage - 1) * parsedLimit;

    // Build the where condition based on filters
    let whereCondition = {
      stock: { gt: 0 }, // Only show products with stock
    };

    // Add search filter if provided
    if (search) {
      whereCondition.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
      ];
    }

    // Add price range filter if provided
    if (minPrice !== undefined || maxPrice !== undefined) {
      whereCondition.price = {};

      if (minPrice !== undefined) {
        whereCondition.price.gte = parseFloat(minPrice);
      }

      if (maxPrice !== undefined) {
        whereCondition.price.lte = parseFloat(maxPrice);
      }
    }

    // Add shop filter if provided
    if (shopId) {
      whereCondition.shopId = parseInt(shopId, 10);
    }

    // Determine sorting
    let orderBy = {};
    switch (sort) {
      case "newest":
        orderBy = { createdAt: "desc" };
        break;
      case "oldest":
        orderBy = { createdAt: "asc" };
        break;
      case "price-low":
        orderBy = { price: "asc" };
        break;
      case "price-high":
        orderBy = { price: "desc" };
        break;
      case "name-asc":
        orderBy = { name: "asc" };
        break;
      case "name-desc":
        orderBy = { name: "desc" };
        break;
      default:
        orderBy = { createdAt: "desc" };
        break;
    }

    // Count total products for pagination info
    const totalProducts = await prisma.product.count({
      where: whereCondition,
    });

    // Find products with pagination
    const products = await prisma.product.findMany({
      where: whereCondition,
      orderBy,
      skip,
      take: parsedLimit,
      include: {
        shop: {
          select: {
            id: true,
            name: true,
            photoShop: true,
            address: true,
          },
        },
      },
    });

    res.status(200).json({
      products,
      pagination: {
        total: totalProducts,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(totalProducts / parsedLimit),
      },
      filters: {
        search: search || null,
        minPrice: minPrice ? parseFloat(minPrice) : null,
        maxPrice: maxPrice ? parseFloat(maxPrice) : null,
        shopId: shopId ? parseInt(shopId, 10) : null,
        sort,
      },
    });
  } catch (error) {
    console.error("Get public products error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get product details
exports.getProductDetails = async (req, res) => {
  const { productId } = req.params;

  try {
    const parsedProductId = validateProductId(productId);

    if (!parsedProductId) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    const product = await prisma.product.findUnique({
      where: { id: parsedProductId },
      include: {
        shop: {
          select: {
            id: true,
            name: true,
            photoShop: true,
            address: true,
          },
        },
      },
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found." });
    }

    // Get related products from the same shop (optional)
    const relatedProducts = await prisma.product.findMany({
      where: {
        shopId: product.shopId,
        id: { not: parsedProductId }, // Exclude current product
        stock: { gt: 0 },
      },
      take: 5,
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      product,
      relatedProducts,
    });
  } catch (error) {
    console.error("Get product details error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// New endpoint: Get product stock status (useful for real-time stock checking)
exports.getProductStock = async (req, res) => {
  const { productId } = req.params;

  try {
    const parsedProductId = validateProductId(productId);

    if (!parsedProductId) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    const product = await prisma.product.findUnique({
      where: { id: parsedProductId },
      select: { id: true, name: true, stock: true },
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found." });
    }

    res.status(200).json({
      id: product.id,
      name: product.name,
      stock: product.stock,
      isAvailable: product.stock > 0,
    });
  } catch (error) {
    console.error("Get product stock error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// New endpoint: Update product stock (useful for inventory management)
exports.updateProductStock = async (req, res) => {
  const { id, role } = req.auth;
  const { productId } = req.params;
  const { stock } = req.body;

  if (role !== "admin") {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  if (stock === undefined) {
    return res.status(400).json({ message: "Stock value is required." });
  }

  try {
    const parsedProductId = validateProductId(productId);
    const parsedStock = parseInt(stock, 10);

    if (!parsedProductId) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    if (isNaN(parsedStock) || parsedStock < 0) {
      return res.status(400).json({
        message: "Invalid stock value. Must be a non-negative integer.",
      });
    }

    // Verify admin has permission to update this product
    const product = await prisma.product.findUnique({
      where: { id: parsedProductId },
      include: { shop: { select: { adminId: true } } },
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found." });
    }

    if (product.shop.adminId !== id) {
      return res.status(403).json({
        message: "You do not have permission to update this product.",
      });
    }

    // Update stock
    const updatedProduct = await prisma.product.update({
      where: { id: parsedProductId },
      data: { stock: parsedStock },
      select: { id: true, name: true, stock: true },
    });

    res.status(200).json({
      ...updatedProduct,
      message: "Stock updated successfully.",
    });
  } catch (error) {
    console.error("Update stock error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Bulk update products (batch operations)
exports.bulkUpdateProducts = async (req, res) => {
  const { id, role } = req.auth;
  const { products } = req.body;

  if (role !== "admin") {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  if (!Array.isArray(products) || products.length === 0) {
    return res
      .status(400)
      .json({ message: "Valid products array is required." });
  }

  try {
    // Get admin's shop
    const shop = await prisma.shop.findUnique({
      where: { adminId: id },
      select: { id: true },
    });

    if (!shop) {
      return res.status(404).json({ message: "No shop found for this admin." });
    }

    // Validate product IDs and prepare updates
    const updatePromises = [];
    const results = { success: [], failed: [] };

    for (const item of products) {
      const { id: productId, price, stock } = item;
      const parsedProductId = validateProductId(productId);

      if (!parsedProductId) {
        results.failed.push({ id: productId, reason: "Invalid product ID" });
        continue;
      }

      // Check if product belongs to admin's shop
      const product = await prisma.product.findUnique({
        where: { id: parsedProductId },
        select: { id: true, shopId: true },
      });

      if (!product || product.shopId !== shop.id) {
        results.failed.push({
          id: parsedProductId,
          reason: "Product not found or does not belong to your shop",
        });
        continue;
      }

      // Prepare update data
      const updateData = {};

      if (price !== undefined) {
        const parsedPrice = parseFloat(price);
        if (isNaN(parsedPrice)) {
          results.failed.push({
            id: parsedProductId,
            reason: "Invalid price value",
          });
          continue;
        }
        updateData.price = parsedPrice;
      }

      if (stock !== undefined) {
        const parsedStock = parseInt(stock, 10);
        if (isNaN(parsedStock) || parsedStock < 0) {
          results.failed.push({
            id: parsedProductId,
            reason: "Invalid stock value",
          });
          continue;
        }
        updateData.stock = parsedStock;
      }

      if (Object.keys(updateData).length === 0) {
        results.failed.push({
          id: parsedProductId,
          reason: "No valid data provided for update",
        });
        continue;
      }

      // Add to update promises
      updatePromises.push(
        prisma.product
          .update({
            where: { id: parsedProductId },
            data: updateData,
            select: { id: true },
          })
          .then((updated) => {
            results.success.push(updated.id);
          })
          .catch((error) => {
            results.failed.push({
              id: parsedProductId,
              reason: "Database error",
            });
          })
      );
    }

    // Execute all updates
    await Promise.all(updatePromises);

    res.status(200).json({
      message: `Updated ${results.success.length} products, failed to update ${results.failed.length} products.`,
      results,
    });
  } catch (error) {
    console.error("Bulk update error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
