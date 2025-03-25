const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/**
 * Get user's cart
 * @returns User's cart with items and product details
 */
exports.getCart = async (req, res) => {
  const { id, role } = req.auth;

  if (role !== "user") {
    return res.status(403).json({ message: "Access forbidden. Not a user." });
  }

  try {
    // Find or create cart for the user
    let cart = await prisma.cart.findUnique({
      where: { userId: id },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                photoProduct: true,
                price: true,
                stock: true,
                shopId: true,
                shop: {
                  select: {
                    id: true,
                    name: true,
                    photoShop: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!cart) {
      // Create a new cart if the user doesn't have one
      cart = await prisma.cart.create({
        data: {
          userId: id,
          items: {},
        },
        include: {
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  photoProduct: true,
                  price: true,
                  stock: true,
                  shopId: true,
                  shop: {
                    select: {
                      id: true,
                      name: true,
                      photoShop: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
    }

    // Group items by shop
    const itemsByShop = {};
    let totalPrice = 0;

    cart.items.forEach((item) => {
      // Calculate subtotal for each item
      const subtotal = item.product.price * item.quantity;
      totalPrice += subtotal;

      // Set subtotal property
      item.subtotal = subtotal;

      // Group by shop
      const shopId = item.product.shopId;
      if (!itemsByShop[shopId]) {
        itemsByShop[shopId] = {
          shop: item.product.shop,
          items: [],
        };
      }
      itemsByShop[shopId].items.push(item);
    });

    // Transform to array
    const groupedItemsArray = Object.values(itemsByShop);

    res.status(200).json({
      id: cart.id,
      userId: cart.userId,
      itemsByShop: groupedItemsArray,
      allItems: cart.items,
      totalPrice,
      totalItems: cart.items.length,
      createdAt: cart.createdAt,
      updatedAt: cart.updatedAt,
    });
  } catch (error) {
    console.error("Get cart error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Add product to cart
 * @param {number} productId - Product ID
 * @param {number} quantity - Quantity to add
 */
exports.addToCart = async (req, res) => {
  const { id, role } = req.auth;
  const { productId, quantity = 1 } = req.body;

  if (role !== "user") {
    return res.status(403).json({ message: "Access forbidden. Not a user." });
  }

  if (!productId) {
    return res.status(400).json({ message: "Product ID is required." });
  }

  const parsedProductId = parseInt(productId, 10);
  const parsedQuantity = parseInt(quantity, 10);

  if (isNaN(parsedProductId) || isNaN(parsedQuantity) || parsedQuantity < 1) {
    return res.status(400).json({ message: "Invalid product ID or quantity." });
  }

  try {
    // Check if product exists and has stock
    const product = await prisma.product.findUnique({
      where: { id: parsedProductId },
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found." });
    }

    if (product.stock < parsedQuantity) {
      return res.status(400).json({
        message: "Not enough stock available.",
        availableStock: product.stock,
      });
    }

    // Find or create user's cart
    let cart = await prisma.cart.findUnique({
      where: { userId: id },
    });

    if (!cart) {
      cart = await prisma.cart.create({
        data: { userId: id },
      });
    }

    // Check if product already in cart
    const existingCartItem = await prisma.cartItem.findUnique({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId: parsedProductId,
        },
      },
    });

    if (existingCartItem) {
      // Update existing cart item quantity
      const newQuantity = existingCartItem.quantity + parsedQuantity;

      // Check if new quantity exceeds stock
      if (newQuantity > product.stock) {
        return res.status(400).json({
          message: "Cannot add more of this item to cart. Stock limit reached.",
          availableStock: product.stock,
          currentlyInCart: existingCartItem.quantity,
        });
      }

      const updatedCartItem = await prisma.cartItem.update({
        where: { id: existingCartItem.id },
        data: { quantity: newQuantity },
        include: {
          product: {
            select: {
              name: true,
              price: true,
            },
          },
        },
      });

      return res.status(200).json({
        message: "Cart updated successfully",
        item: updatedCartItem,
        added: parsedQuantity,
      });
    }

    // Add new item to cart
    const newCartItem = await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId: parsedProductId,
        quantity: parsedQuantity,
      },
      include: {
        product: {
          select: {
            name: true,
            price: true,
          },
        },
      },
    });

    res.status(201).json({
      message: "Product added to cart",
      item: newCartItem,
    });
  } catch (error) {
    console.error("Add to cart error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Update cart item quantity
 * @param {number} cartItemId - Cart item ID
 * @param {number} quantity - New quantity
 */
exports.updateCartItem = async (req, res) => {
  const { id, role } = req.auth;
  const { cartItemId, quantity } = req.body;

  if (role !== "user") {
    return res.status(403).json({ message: "Access forbidden. Not a user." });
  }

  if (!cartItemId || quantity === undefined) {
    return res
      .status(400)
      .json({ message: "Cart item ID and quantity are required." });
  }

  const parsedCartItemId = parseInt(cartItemId, 10);
  const parsedQuantity = parseInt(quantity, 10);

  if (isNaN(parsedCartItemId) || isNaN(parsedQuantity)) {
    return res
      .status(400)
      .json({ message: "Invalid cart item ID or quantity." });
  }

  try {
    // Find the cart item
    const cartItem = await prisma.cartItem.findUnique({
      where: { id: parsedCartItemId },
      include: {
        cart: true,
        product: true,
      },
    });

    if (!cartItem) {
      return res.status(404).json({ message: "Cart item not found." });
    }

    // Check if the cart belongs to the user
    if (cartItem.cart.userId !== id) {
      return res
        .status(403)
        .json({ message: "You cannot modify this cart item." });
    }

    // Handle removal if quantity is 0
    if (parsedQuantity === 0) {
      await prisma.cartItem.delete({
        where: { id: parsedCartItemId },
      });

      return res.status(200).json({ message: "Item removed from cart." });
    }

    // Check stock availability
    if (parsedQuantity > cartItem.product.stock) {
      return res.status(400).json({
        message: "Not enough stock available.",
        availableStock: cartItem.product.stock,
      });
    }

    // Update the cart item
    const updatedCartItem = await prisma.cartItem.update({
      where: { id: parsedCartItemId },
      data: { quantity: parsedQuantity },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            price: true,
          },
        },
      },
    });

    res.status(200).json({
      message: "Cart item updated",
      item: updatedCartItem,
      subtotal: updatedCartItem.product.price * updatedCartItem.quantity,
    });
  } catch (error) {
    console.error("Update cart item error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Remove item from cart
 * @param {number} cartItemId - Cart item ID to remove
 */
exports.removeFromCart = async (req, res) => {
  const { id, role } = req.auth;
  const { cartItemId } = req.params;

  if (role !== "user") {
    return res.status(403).json({ message: "Access forbidden. Not a user." });
  }

  if (!cartItemId) {
    return res.status(400).json({ message: "Cart item ID is required." });
  }

  const parsedCartItemId = parseInt(cartItemId, 10);

  if (isNaN(parsedCartItemId)) {
    return res.status(400).json({ message: "Invalid cart item ID." });
  }

  try {
    // Find the cart item
    const cartItem = await prisma.cartItem.findUnique({
      where: { id: parsedCartItemId },
      include: { cart: true },
    });

    if (!cartItem) {
      return res.status(404).json({ message: "Cart item not found." });
    }

    // Check if the cart belongs to the user
    if (cartItem.cart.userId !== id) {
      return res
        .status(403)
        .json({ message: "You cannot modify this cart item." });
    }

    // Delete the cart item
    await prisma.cartItem.delete({
      where: { id: parsedCartItemId },
    });

    res.status(200).json({ message: "Item removed from cart." });
  } catch (error) {
    console.error("Remove from cart error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Clear cart (remove all items)
 */
exports.clearCart = async (req, res) => {
  const { id, role } = req.auth;

  if (role !== "user") {
    return res.status(403).json({ message: "Access forbidden. Not a user." });
  }

  try {
    // Find user's cart
    const cart = await prisma.cart.findUnique({
      where: { userId: id },
      select: { id: true },
    });

    if (!cart) {
      return res.status(404).json({ message: "Cart not found." });
    }

    // Delete all cart items
    await prisma.cartItem.deleteMany({
      where: { cartId: cart.id },
    });

    res.status(200).json({ message: "Cart cleared successfully." });
  } catch (error) {
    console.error("Clear cart error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get cart summary (for checkout)
 */
exports.getCartSummary = async (req, res) => {
  const { id, role } = req.auth;

  if (role !== "user") {
    return res.status(403).json({ message: "Access forbidden. Not a user." });
  }

  try {
    // Find user's cart with items
    const cart = await prisma.cart.findUnique({
      where: { userId: id },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                price: true,
                stock: true,
                shopId: true,
                shop: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: "Cart is empty." });
    }

    // Check stock availability and group by shop
    const itemsByShop = {};
    let totalPrice = 0;
    const stockIssues = [];

    cart.items.forEach((item) => {
      // Check stock
      if (item.quantity > item.product.stock) {
        stockIssues.push({
          productId: item.product.id,
          productName: item.product.name,
          requestedQuantity: item.quantity,
          availableStock: item.product.stock,
        });
      }

      // Calculate subtotal
      const subtotal = item.product.price * item.quantity;
      totalPrice += subtotal;

      // Group by shop
      const shopId = item.product.shopId;
      if (!itemsByShop[shopId]) {
        itemsByShop[shopId] = {
          shop: item.product.shop,
          items: [],
          subtotal: 0,
        };
      }
      itemsByShop[shopId].items.push({
        id: item.id,
        product: item.product,
        quantity: item.quantity,
        subtotal,
      });
      itemsByShop[shopId].subtotal += subtotal;
    });

    // If there are stock issues, return error
    if (stockIssues.length > 0) {
      return res.status(400).json({
        message: "Some items in your cart have stock issues.",
        stockIssues,
      });
    }

    // Transform to array
    const groupedItemsArray = Object.values(itemsByShop);

    res.status(200).json({
      cartId: cart.id,
      shops: groupedItemsArray,
      totalItems: cart.items.length,
      totalPrice,
      validForCheckout: true,
    });
  } catch (error) {
    console.error("Get cart summary error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
