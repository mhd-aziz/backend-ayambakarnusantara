const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Helper function to validate rating value
const validateRating = (rating) => {
  const parsedRating = parseInt(rating, 10);
  if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
    return false;
  }
  return parsedRating;
};

// Helper function to validate productId
const validateProductId = (productId) => {
  const parsedProductId = parseInt(productId, 10);
  if (isNaN(parsedProductId)) {
    return false;
  }
  return parsedProductId;
};

// Create or update a rating
exports.createOrUpdateRating = async (req, res) => {
  const { id, role } = req.auth; // Get user ID and role from the token
  const { productId, value, comment } = req.body;

  // Only users can create ratings
  if (role !== "user") {
    return res.status(403).json({ message: "Access forbidden. Not a user." });
  }

  // Validate required inputs
  if (!productId || value === undefined) {
    return res
      .status(400)
      .json({ message: "Product ID and rating value are required." });
  }

  try {
    const parsedProductId = validateProductId(productId);
    const parsedRating = validateRating(value);

    if (!parsedProductId) {
      return res.status(400).json({ message: "Invalid product ID." });
    }

    if (!parsedRating) {
      return res
        .status(400)
        .json({ message: "Invalid rating value. Must be between 1 and 5." });
    }

    // Check if the product exists
    const product = await prisma.product.findUnique({
      where: { id: parsedProductId },
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found." });
    }

    // Check if the user has purchased this product
    const hasPurchased = await prisma.orderItem.findFirst({
      where: {
        productId: parsedProductId,
        order: {
          userId: id,
          status: "paid", // Only count completed orders
        },
      },
    });

    if (!hasPurchased) {
      return res.status(403).json({
        message: "You can only rate products you have purchased.",
      });
    }

    // Check if the user has already rated this product
    const existingRating = await prisma.rating.findUnique({
      where: {
        userId_productId: {
          userId: id,
          productId: parsedProductId,
        },
      },
    });

    let rating;
    if (existingRating) {
      // Update existing rating
      rating = await prisma.rating.update({
        where: {
          id: existingRating.id,
        },
        data: {
          value: parsedRating,
          comment: comment || existingRating.comment,
        },
      });
      res.status(200).json({
        message: "Rating updated successfully",
        rating,
      });
    } else {
      // Create new rating
      rating = await prisma.rating.create({
        data: {
          value: parsedRating,
          comment: comment || "",
          userId: id,
          productId: parsedProductId,
        },
      });
      res.status(201).json({
        message: "Rating created successfully",
        rating,
      });
    }
  } catch (error) {
    console.error("Create/update rating error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all ratings for a product with pagination
exports.getProductRatings = async (req, res) => {
  const { productId } = req.params;
  const { page = 1, limit = 10, sort = "newest" } = req.query;

  try {
    const parsedProductId = validateProductId(productId);
    if (!parsedProductId) {
      return res.status(400).json({ message: "Invalid product ID." });
    }

    const parsedPage = parseInt(page, 10) || 1;
    const parsedLimit = parseInt(limit, 10) || 10;
    const skip = (parsedPage - 1) * parsedLimit;

    // Check if the product exists
    const product = await prisma.product.findUnique({
      where: { id: parsedProductId },
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found." });
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
      case "highest":
        orderBy = { value: "desc" };
        break;
      case "lowest":
        orderBy = { value: "asc" };
        break;
      default:
        orderBy = { createdAt: "desc" };
        break;
    }

    // Count total ratings for this product
    const totalRatings = await prisma.rating.count({
      where: { productId: parsedProductId },
    });

    // Calculate average rating
    const ratingStats = await prisma.rating.aggregate({
      where: { productId: parsedProductId },
      _avg: { value: true },
      _count: true,
    });

    // Get ratings with user details
    const ratings = await prisma.rating.findMany({
      where: { productId: parsedProductId },
      orderBy,
      skip,
      take: parsedLimit,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            photoUser: true,
          },
        },
      },
    });

    // Count ratings by value (1-5 stars)
    const ratingDistributionRaw = await prisma.$queryRaw`
      SELECT value, COUNT(*) as count 
      FROM Rating 
      WHERE productId = ${parsedProductId} 
      GROUP BY value 
      ORDER BY value ASC
    `;

    // Convert BigInt to Number for JSON serialization
    const ratingDistribution = ratingDistributionRaw.map((item) => ({
      value: Number(item.value),
      count: Number(item.count),
    }));

    res.status(200).json({
      ratings,
      statistics: {
        totalRatings,
        averageRating: ratingStats._avg.value || 0,
        distribution: ratingDistribution,
      },
      pagination: {
        total: totalRatings,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(totalRatings / parsedLimit),
      },
    });
  } catch (error) {
    console.error("Get product ratings error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get a user's rating for a specific product
exports.getUserProductRating = async (req, res) => {
  const { id, role } = req.auth;
  const { productId } = req.params;

  if (role !== "user") {
    return res.status(403).json({ message: "Access forbidden. Not a user." });
  }

  try {
    const parsedProductId = validateProductId(productId);
    if (!parsedProductId) {
      return res.status(400).json({ message: "Invalid product ID." });
    }

    const rating = await prisma.rating.findUnique({
      where: {
        userId_productId: {
          userId: id,
          productId: parsedProductId,
        },
      },
    });

    if (!rating) {
      return res.status(404).json({ message: "Rating not found." });
    }

    res.status(200).json(rating);
  } catch (error) {
    console.error("Get user rating error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Delete a rating
exports.deleteRating = async (req, res) => {
  const { id, role } = req.auth;
  const { ratingId } = req.params;

  if (role !== "user") {
    return res.status(403).json({ message: "Access forbidden. Not a user." });
  }

  try {
    const parsedRatingId = parseInt(ratingId, 10);
    if (isNaN(parsedRatingId)) {
      return res.status(400).json({ message: "Invalid rating ID." });
    }

    // Verify the rating exists and belongs to the user
    const rating = await prisma.rating.findUnique({
      where: { id: parsedRatingId },
    });

    if (!rating) {
      return res.status(404).json({ message: "Rating not found." });
    }

    if (rating.userId !== id) {
      return res.status(403).json({
        message: "You do not have permission to delete this rating.",
      });
    }

    // Delete the rating
    await prisma.rating.delete({
      where: { id: parsedRatingId },
    });

    res.status(200).json({ message: "Rating deleted successfully." });
  } catch (error) {
    console.error("Delete rating error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get rating summary for a shop (aggregated across all products)
exports.getShopRatings = async (req, res) => {
  const { shopId } = req.params;

  try {
    const parsedShopId = parseInt(shopId, 10);
    if (isNaN(parsedShopId)) {
      return res.status(400).json({ message: "Invalid shop ID." });
    }

    // Check if the shop exists
    const shop = await prisma.shop.findUnique({
      where: { id: parsedShopId },
    });

    if (!shop) {
      return res.status(404).json({ message: "Shop not found." });
    }

    // Get all product IDs for this shop
    const products = await prisma.product.findMany({
      where: { shopId: parsedShopId },
      select: { id: true },
    });

    const productIds = products.map((product) => product.id);

    // If shop has no products, return zero ratings
    if (productIds.length === 0) {
      return res.status(200).json({
        shopId: parsedShopId,
        totalRatings: 0,
        averageRating: 0,
        totalProducts: 0,
        productsWithRatings: 0,
      });
    }

    // Calculate rating statistics for all products in the shop
    const ratingStats = await prisma.rating.aggregate({
      where: {
        productId: { in: productIds },
      },
      _avg: { value: true },
      _count: true,
    });

    // Count how many products have at least one rating
    const productsWithRatings = await prisma.rating.groupBy({
      by: ["productId"],
      where: {
        productId: { in: productIds },
      },
    });

    res.status(200).json({
      shopId: parsedShopId,
      totalRatings: ratingStats._count,
      averageRating: ratingStats._avg.value || 0,
      totalProducts: productIds.length,
      productsWithRatings: productsWithRatings.length,
    });
  } catch (error) {
    console.error("Get shop ratings error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get top rated products
exports.getTopRatedProducts = async (req, res) => {
  const { limit = 10 } = req.query;

  try {
    const parsedLimit = parseInt(limit, 10) || 10;

    // This query finds products with ratings, calculates their average rating,
    // and orders them by average rating (descending)
    const topRatedProducts = await prisma.$queryRaw`
      SELECT 
        p.id,
        p.name,
        p.price,
        p.photoProduct,
        p.shopId,
        AVG(r.value) as averageRating,
        COUNT(r.id) as ratingCount
      FROM 
        Product p
      JOIN 
        Rating r ON p.id = r.productId
      GROUP BY 
        p.id
      HAVING 
        COUNT(r.id) >= 3 -- Only include products with at least 3 ratings
      ORDER BY 
        averageRating DESC, ratingCount DESC
      LIMIT ${parsedLimit}
    `;

    // Get shop details for each product
    const productsWithShopDetails = await Promise.all(
      topRatedProducts.map(async (product) => {
        const shop = await prisma.shop.findUnique({
          where: { id: product.shopId },
          select: {
            id: true,
            name: true,
            photoShop: true,
          },
        });

        return {
          ...product,
          shop,
        };
      })
    );

    res.status(200).json({
      topRatedProducts: productsWithShopDetails,
    });
  } catch (error) {
    console.error("Get top rated products error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get recent ratings (useful for a review feed or admin dashboard)
exports.getRecentRatings = async (req, res) => {
  const { limit = 10 } = req.query;
  const { role } = req.auth || {}; // role might be undefined for public routes

  try {
    const parsedLimit = parseInt(limit, 10) || 10;

    const recentRatings = await prisma.rating.findMany({
      take: parsedLimit,
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            photoUser: true,
          },
        },
        product: {
          select: {
            id: true,
            name: true,
            photoProduct: true,
            shop: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    // For non-admin users, filter out sensitive information
    const filteredRatings = recentRatings.map((rating) => {
      // If non-admin request, remove potentially sensitive user data
      if (role !== "admin") {
        return {
          ...rating,
          user: {
            username: rating.user.username,
            photoUser: rating.user.photoUser,
          },
        };
      }
      return rating;
    });

    res.status(200).json({
      recentRatings: filteredRatings,
    });
  } catch (error) {
    console.error("Get recent ratings error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
