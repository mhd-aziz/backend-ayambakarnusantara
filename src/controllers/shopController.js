const Shop = require("../models/shopModel");
const Admin = require("../models/adminModel");
const { bucket } = require("../firebaseConfig");
const path = require("path");
const fs = require("fs");

// Function to upload shop image to Firebase Storage
const uploadImageToFirebase = async (imageFile) => {
  const filePath = imageFile.path; // Path to the temporary file
  const fileName = Date.now() + path.extname(imageFile.originalname); // Create a unique file name
  const file = bucket.file(fileName);

  // Upload the file to Firebase Storage
  await file.save(fs.readFileSync(filePath), {
    contentType: imageFile.mimetype,
    public: true, // Make the file publicly accessible
  });

  // Get the file's public URL
  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
  return publicUrl;
};

// Helper function to check if the user is an admin
const isAdmin = (role) => role === "admin";

// Helper function to check if the user is a regular user
const isUser = (role) => role === "user";

// Create a new shop
exports.createShop = async (req, res) => {
  const { name, address } = req.body;
  const { id, role } = req.auth; // Get the admin ID and role from the token
  const photoShop = req.file; // Get the shop image

  if (!isAdmin(role)) {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  try {
    // Check if the admin exists
    const admin = await Admin.findUnique({
      where: { id },
    });
    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    // Check if the user (admin) already has a shop
    const existingShop = await Shop.findUnique({
      where: { adminId: id }, // Check if a shop already exists for this admin
    });

    if (existingShop) {
      return res
        .status(400)
        .json({
          message:
            "This admin already has a shop. A user can only create one shop.",
        });
    }

    // Upload the shop image to Firebase and get the URL
    let photoUrl = null;
    if (photoShop) {
      photoUrl = await uploadImageToFirebase(photoShop);
    }

    // Create the new shop
    const newShop = await Shop.create({
      data: {
        name,
        address,
        adminId: id,
        photoShop: photoUrl || null, // Set to null if no photo
      },
    });

    res.status(201).json(newShop); // Send the created shop
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get the shop by admin ID
exports.getShopByAdmin = async (req, res) => {
  const { id, role } = req.auth; // Get the admin ID and role from the token

  if (!isAdmin(role)) {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  try {
    const shop = await Shop.findUnique({
      where: { adminId: id }, // Find the shop by adminId
      include: {
        products: true, // Include products associated with the shop
      },
    });

    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    res.status(200).json(shop); // Send the shop data
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Update the shop information
exports.updateShop = async (req, res) => {
  const { id, role } = req.auth; // Get the admin ID and role from the token
  const { name, address } = req.body;
  const photoShop = req.file; // Get the shop image

  if (!isAdmin(role)) {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  try {
    // Check if the shop exists
    const shop = await Shop.findUnique({
      where: { id },
    });

    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    // Upload the new shop image to Firebase and get the URL
    let photoUrl = null;
    if (photoShop) {
      photoUrl = await uploadImageToFirebase(photoShop);
    }

    // Update the shop information
    const updatedShop = await Shop.update({
      where: { id },
      data: {
        name: name || shop.name, // If no name is provided, retain the existing one
        address: address || shop.address, // If no address is provided, retain the existing one
        photoShop: photoUrl || shop.photoShop, // If no new photo is provided, retain the existing photo
      },
    });

    res.status(200).json(updatedShop); // Send the updated shop data
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get all shops (for a user role)
exports.getShopByUser = async (req, res) => {
  const { role } = req.auth; // Get the role from the token

  if (!isUser(role)) {
    return res.status(403).json({ message: "Access forbidden. Not a user." });
  }

  try {
    // Fetch all shops from the database
    const shops = await Shop.findMany({
      include: {
        products: true, // Include products associated with each shop
      },
    });

    if (shops.length === 0) {
      return res.status(404).json({ message: "No shops found" });
    }

    res.status(200).json(shops); // Send the list of shops
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};
