const Product = require("../models/productModel");
const Shop = require("../models/shopModel");
const uploadImageToFirebase = require("../utils/fileUpload"); // Import image upload utility

// Validate productId
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

  if (role !== "admin") {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  try {
    // Ensure price and stock are correctly parsed to float and integer respectively
    const parsedPrice = parseFloat(price);
    const parsedStock = parseInt(stock, 10);

    if (isNaN(parsedPrice) || isNaN(parsedStock)) {
      return res.status(400).json({ message: "Invalid price or stock value." });
    }

    // Find the shop associated with the admin
    const shop = await Shop.findUnique({
      where: { adminId: id }, // The admin's associated shop
    });

    if (!shop) {
      return res.status(404).json({ message: "No shop found for this admin." });
    }

    // Upload the product image to Firebase and get the URL
    let photoUrl = null;
    if (photoProduct) {
      photoUrl = await uploadImageToFirebase(photoProduct);
    }

    // Create the new product for the shop
    const newProduct = await Product.create({
      data: {
        name,
        description,
        price: parsedPrice,
        stock: parsedStock,
        shopId: shop.id,
        photoProduct: photoUrl || null,
      },
    });

    res.status(201).json(newProduct); // Send the created product
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get all products for the admin's shop
exports.getProductsByAdmin = async (req, res) => {
  const { id, role } = req.auth;

  if (role !== "admin") {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  try {
    // Find the shop associated with the admin
    const shop = await Shop.findUnique({
      where: { adminId: id },
      include: { products: true },
    });

    if (!shop) {
      return res.status(404).json({ message: "No shop found for this admin." });
    }

    res.status(200).json(shop.products); // Return the products
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
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

  try {
    const parsedProductId = validateProductId(productId);
    const parsedPrice = parseFloat(price);
    const parsedStock = parseInt(stock, 10);

    if (isNaN(parsedPrice) || isNaN(parsedStock)) {
      return res.status(400).json({ message: "Invalid price or stock value." });
    }

    if (!parsedProductId) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    // Find the product and the associated shop
    const product = await Product.findUnique({
      where: { id: parsedProductId },
      include: { shop: true },
    });

    if (!product || product.shop.adminId !== id) {
      return res.status(404).json({
        message:
          "Product not found or you do not have permission to update it.",
      });
    }

    let photoUrl = null;
    if (photoProduct) {
      photoUrl = await uploadImageToFirebase(photoProduct);
    }

    const updatedProduct = await Product.update({
      where: { id: parsedProductId },
      data: {
        name: name || product.name,
        description: description || product.description,
        price: parsedPrice || product.price,
        stock: parsedStock || product.stock,
        photoProduct: photoUrl || product.photoProduct,
      },
    });

    res.status(200).json(updatedProduct); // Send the updated product data
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Delete a product
exports.deleteProduct = async (req, res) => {
  const { id, role } = req.auth;
  const { productId } = req.body;

  if (role !== "admin") {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  try {
    const parsedProductId = validateProductId(productId);

    if (!parsedProductId) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    const product = await Product.findUnique({
      where: { id: parsedProductId },
      include: { shop: true },
    });

    if (!product || product.shop.adminId !== id) {
      return res.status(404).json({
        message:
          "Product not found or you do not have permission to delete it.",
      });
    }

    await Product.delete({
      where: { id: parsedProductId },
    });

    res.status(200).json({ message: "Product deleted successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get all products for the user
exports.getProductsByUser = async (req, res) => {
  const { role } = req.auth; // Get the role from the token

  if (role !== "user") {
    return res.status(403).json({ message: "Access forbidden. Not a user." });
  }

  try {
    // Find all products in the system (no shop filtering for users)
    const products = await Product.findMany();

    if (products.length === 0) {
      return res.status(404).json({ message: "No products found." });
    }

    res.status(200).json(products); // Return the list of products
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};
