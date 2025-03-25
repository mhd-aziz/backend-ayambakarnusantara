const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { bucket } = require("../firebaseConfig");
const path = require("path");
const fs = require("fs");

// Function to upload shop image to Firebase Storage
const uploadImageToFirebase = async (imageFile) => {
  try {
    const filePath = imageFile.path; // Path to the temporary file
    const fileName = `shops/${Date.now()}-${imageFile.originalname}`; // Create a unique file name with folder structure
    const file = bucket.file(fileName);

    // Upload the file to Firebase Storage
    await file.save(fs.readFileSync(filePath), {
      contentType: imageFile.mimetype,
      public: true, // Make the file publicly accessible
    });

    // Get the file's public URL
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

    // Delete temporary file after upload
    fs.unlinkSync(filePath);

    return publicUrl;
  } catch (error) {
    console.error("Error uploading to Firebase:", error);
    throw new Error("Failed to upload image");
  }
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
    const admin = await prisma.admin.findUnique({
      where: { id: parseInt(id) },
    });

    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    // Check if the admin already has a shop
    const existingShop = await prisma.shop.findUnique({
      where: { adminId: parseInt(id) },
    });

    if (existingShop) {
      return res.status(400).json({
        message:
          "This admin already has a shop. An admin can only create one shop.",
      });
    }

    // Validate required fields
    if (!name || !address) {
      return res
        .status(400)
        .json({ message: "Shop name and address are required" });
    }

    // Upload the shop image to Firebase and get the URL
    let photoUrl = null;
    if (photoShop) {
      photoUrl = await uploadImageToFirebase(photoShop);
    }

    // Create the new shop
    const newShop = await prisma.shop.create({
      data: {
        name,
        address,
        adminId: parseInt(id),
        photoShop: photoUrl || null, // Set to null if no photo
      },
    });

    res.status(201).json({
      success: true,
      message: "Shop created successfully",
      data: newShop,
    });
  } catch (error) {
    console.error("Error creating shop:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get the shop by admin ID
exports.getShopByAdmin = async (req, res) => {
  const { id, role } = req.auth; // Get the admin ID and role from the token

  if (!isAdmin(role)) {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  try {
    const shop = await prisma.shop.findUnique({
      where: { adminId: parseInt(id) },
      include: {
        products: {
          orderBy: {
            createdAt: "desc", // Get newest products first
          },
        },
        admin: {
          select: {
            username: true,
            email: true,
            fullName: true,
            photoAdmin: true,
          },
        },
      },
    });

    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    res.status(200).json({
      success: true,
      data: shop,
    });
  } catch (error) {
    console.error("Error fetching shop:", error);
    res.status(500).json({ message: "Server error", error: error.message });
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
    // Check if the shop exists for this admin
    const shop = await prisma.shop.findUnique({
      where: { adminId: parseInt(id) },
    });

    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    // Prepare update data
    const updateData = {};
    if (name) updateData.name = name;
    if (address) updateData.address = address;

    // Upload the new shop image to Firebase and get the URL
    if (photoShop) {
      try {
        const photoUrl = await uploadImageToFirebase(photoShop);
        updateData.photoShop = photoUrl;
      } catch (uploadError) {
        return res.status(400).json({
          message: "Failed to upload image",
          error: uploadError.message,
        });
      }
    }

    // Update the shop information
    const updatedShop = await prisma.shop.update({
      where: { id: shop.id },
      data: updateData,
    });

    res.status(200).json({
      success: true,
      message: "Shop updated successfully",
      data: updatedShop,
    });
  } catch (error) {
    console.error("Error updating shop:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all shops (for a user role)
exports.getShopByUser = async (req, res) => {
  const { role } = req.auth; // Get the role from the token

  if (!isUser(role)) {
    return res.status(403).json({ message: "Access forbidden. Not a user." });
  }

  try {
    // Pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Filter parameters
    const search = req.query.search || "";

    // Fetch shops with pagination and filtering
    const shops = await prisma.shop.findMany({
      where: {
        OR: [{ name: { contains: search } }, { address: { contains: search } }],
      },
      include: {
        products: {
          take: 5, // Only include 5 most recent products per shop
          orderBy: {
            createdAt: "desc",
          },
        },
        _count: {
          select: { products: true },
        },
      },
      skip,
      take: limit,
      orderBy: {
        createdAt: "desc",
      },
    });

    // Get total count for pagination
    const totalShops = await prisma.shop.count({
      where: {
        OR: [{ name: { contains: search } }, { address: { contains: search } }],
      },
    });

    res.status(200).json({
      success: true,
      data: shops,
      pagination: {
        total: totalShops,
        page,
        limit,
        pages: Math.ceil(totalShops / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching shops:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get shop details by ID (for users)
exports.getShopById = async (req, res) => {
  const shopId = parseInt(req.params.id);

  try {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      include: {
        products: {
          orderBy: {
            createdAt: "desc",
          },
        },
        admin: {
          select: {
            username: true,
            fullName: true,
          },
        },
      },
    });

    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    res.status(200).json({
      success: true,
      data: shop,
    });
  } catch (error) {
    console.error("Error fetching shop details:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Delete a shop (for admin only)
exports.deleteShop = async (req, res) => {
  const { id, role } = req.auth; // Get the admin ID and role from the token

  if (!isAdmin(role)) {
    return res.status(403).json({ message: "Access forbidden. Not an admin." });
  }

  try {
    // Check if the shop exists for this admin
    const shop = await prisma.shop.findUnique({
      where: { adminId: parseInt(id) },
    });

    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    // Before deleting the shop, you might want to handle related data
    // This depends on your data model, but you might need to delete:
    // 1. All products associated with the shop
    // 2. Delete the shop image from Firebase Storage

    // If the shop has a photo, delete it from Firebase Storage
    if (shop.photoShop) {
      try {
        // Extract the file path from the URL
        const fileUrl = shop.photoShop;
        const fileName = fileUrl.split(
          `https://storage.googleapis.com/${bucket.name}/`
        )[1];

        // Delete the file from Firebase Storage
        await bucket.file(fileName).delete();
        console.log(`Successfully deleted shop image: ${fileName}`);
      } catch (deleteError) {
        console.error("Error deleting shop image from Firebase:", deleteError);
        // Continue with shop deletion even if image deletion fails
      }
    }

    // Delete all products associated with the shop
    await prisma.product.deleteMany({
      where: { shopId: shop.id },
    });

    // Delete the shop
    const deletedShop = await prisma.shop.delete({
      where: { id: shop.id },
    });

    res.status(200).json({
      success: true,
      message: "Shop and all associated products deleted successfully",
      data: deletedShop,
    });
  } catch (error) {
    console.error("Error deleting shop:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
