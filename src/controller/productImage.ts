import type { Request, Response } from "express";
import fs from "node:fs";
import { Product } from "../models/product.js";
import { ProductImage } from "../models/productImage.js";
import type { IUser } from "../models/user.js";
import { uploadToCloudinary } from "../utils/cloudinary.js";
import { deleteCache } from "../utils/redis.js";

interface MulterFile {
  path: string;
  filename: string;
}

export async function uploadProductImages(req: Request, res: Response): Promise<void> {
  const reqFiles = req.files as { [fieldname: string]: MulterFile[] } | undefined;
  const thumbnailFiles = reqFiles?.thumbnail || [];
  const imageFiles = reqFiles?.images || [];
  const allFiles = [...thumbnailFiles, ...imageFiles];

  const cleanupFiles = () => {
    for (const f of allFiles) {
      if (fs.existsSync(f.path)) {
        try {
          fs.unlinkSync(f.path);
        } catch (err) {
          console.warn("Failed to delete temp file:", f.path, err);
        }
      }
    }
  };

  try {
    const id = req.params.id as string; // Product ID
    const seller = req.seller;

    if (!seller) {
      cleanupFiles();
      res.status(403).json({ success: false, message: "Forbidden. Seller permissions required." });
      return;
    }

    const product = await Product.findById(id);
    if (!product) {
      cleanupFiles();
      res.status(404).json({ success: false, message: "Product not found." });
      return;
    }

    // Enforce ownership
    const caller = req.user as IUser | undefined;
    if (
      product.sellerId?.toString() !== seller._id.toString() &&
      product.createdBy?.toString() !== caller?._id?.toString()
    ) {
      cleanupFiles();
      res.status(403).json({ success: false, message: "Forbidden. You do not own this product." });
      return;
    }

    if (allFiles.length === 0) {
      res.status(400).json({ success: false, message: "Please upload a thumbnail image or at least one product details image." });
      return;
    }

    // 1. Enforce max limit of 10 images total for a single product
    const existingCount = await ProductImage.countDocuments({ catalogProductId: id });
    if (existingCount + allFiles.length > 10) {
      cleanupFiles();
      res.status(400).json({
        success: false,
        message: `A single product cannot have more than 10 images. Current image count is ${existingCount}, attempted to upload ${allFiles.length}.`,
      });
      return;
    }

    const imageDocuments: any[] = [];

    // 2. Process thumbnail upload (if provided)
    if (thumbnailFiles.length > 0) {
      const thumbnailFile = thumbnailFiles[0];
      if (thumbnailFile) {
        const cloudUrl = await uploadToCloudinary(thumbnailFile.path, `hmarketplace/products/${id}`);
        if (!cloudUrl) {
          throw new Error("Cloudinary upload for thumbnail failed.");
        }

        // Reset any existing primary images for this product
        await ProductImage.updateMany({ catalogProductId: id }, { isPrimary: false });

        const newThumbnail = new ProductImage({
          catalogProductId: id,
          imageUrl: cloudUrl,
          images: [cloudUrl],
          type: "image",
          angle: "front", // Thumbnail is typically front angle
          sortOrder: 0,   // Start primary at sortOrder 0
          isPrimary: true,
        });
        await newThumbnail.save();
        imageDocuments.push(newThumbnail);
      }
    }

    // 3. Process supplementary info images (if provided)
    if (imageFiles.length > 0) {
      // Parse camera angles/perspectives from body parameter (e.g. string or array)
      const bodyAngles = req.body.angles;
      let anglesArray: string[] = [];
      if (bodyAngles) {
        if (Array.isArray(bodyAngles)) {
          anglesArray = bodyAngles.map((a) => String(a).trim().toLowerCase());
        } else if (typeof bodyAngles === "string") {
          try {
            const parsed = JSON.parse(bodyAngles);
            if (Array.isArray(parsed)) {
              anglesArray = parsed.map((a) => String(a).trim().toLowerCase());
            } else {
              anglesArray = [bodyAngles.trim().toLowerCase()];
            }
          } catch {
            anglesArray = [bodyAngles.trim().toLowerCase()];
          }
        }
      }

      const validAngles = ["front", "back", "side", "top", "isometric", "detail", "lifestyle", "other"];

      // Process all supplementary image uploads and database links concurrently
      const uploadPromises = imageFiles.map(async (file, i) => {
        try {
          const cloudUrl = await uploadToCloudinary(file.path, `hmarketplace/products/${id}`);
          if (!cloudUrl) {
            throw new Error("Cloudinary upload failed.");
          }

          // Map index to the specified angle, defaulting to null if not specified or invalid
          const rawAngle = anglesArray[i];
          const angleValue =
            rawAngle && validAngles.includes(rawAngle)
              ? (rawAngle as "front" | "back" | "side" | "top" | "isometric" | "detail" | "lifestyle" | "other")
              : null;

          // If no thumbnail was uploaded and the product has no existing images, mark the first supplementary image as primary
          const isFirstAndNoThumbnail = existingCount === 0 && thumbnailFiles.length === 0 && i === 0;

          const newImage = new ProductImage({
            catalogProductId: id,
            imageUrl: cloudUrl,
            images: [cloudUrl],
            type: "image",
            angle: angleValue,
            sortOrder: existingCount + i + 1,
            isPrimary: isFirstAndNoThumbnail,
          });
          await newImage.save();
          return newImage;
        } catch (uploadErr) {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
          console.error("Single image upload failed:", uploadErr);
          return null;
        }
      });

      const results = await Promise.all(uploadPromises);
      const uploadedImages = results.filter((img): img is NonNullable<typeof img> => img !== null);
      imageDocuments.push(...uploadedImages);
    }

    // Invalidate product details cache
    await deleteCache(`product:slug:${product.slug}`);

    res.status(201).json({
      success: true,
      message: `${imageDocuments.length} images uploaded and linked successfully.`,
      images: imageDocuments,
    });
  } catch (error: unknown) {
    cleanupFiles();
    console.error("Upload product images error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to upload images.";
    res.status(500).json({ success: false, message: errorMessage });
  }
}

export async function deleteProductImage(req: Request, res: Response): Promise<void> {
  try {
    const imageId = req.params.imageId as string;
    const seller = req.seller;

    if (!seller) {
      res.status(403).json({ success: false, message: "Forbidden. Seller permissions required." });
      return;
    }

    const image = await ProductImage.findById(imageId);
    if (!image) {
      res.status(404).json({ success: false, message: "Image not found." });
      return;
    }

    // Verify ownership of the product
    const product = await Product.findById(image.catalogProductId);
    const caller = req.user as IUser | undefined;
    if (
      !product ||
      (product.sellerId?.toString() !== seller._id.toString() &&
        product.createdBy?.toString() !== caller?._id?.toString())
    ) {
      res.status(403).json({ success: false, message: "Forbidden. Access denied." });
      return;
    }

    await ProductImage.findByIdAndDelete(imageId);

    // Invalidate product details cache
    if (product) {
      await deleteCache(`product:slug:${product.slug}`);
    }

    res.status(200).json({ success: true, message: "Product image deleted successfully." });
  } catch (error: unknown) {
    console.error("Delete image error:", error);
    res.status(500).json({ success: false, message: "Failed to delete product image." });
  }
}
