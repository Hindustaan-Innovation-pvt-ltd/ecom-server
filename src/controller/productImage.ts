import type { Request, Response } from "express";
import fs from "fs";
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
  const files = (req as any).files as MulterFile[] | undefined;
  try {
    const id = req.params.id as string; // Product ID
    const seller = req.seller;

    if (!seller) {
      if (files) {
        for (const f of files) {
          if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
        }
      }
      res.status(403).json({ success: false, message: "Forbidden. Seller permissions required." });
      return;
    }

    const product = await Product.findById(id);
    if (!product) {
      if (files) {
        for (const f of files) {
          if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
        }
      }
      res.status(404).json({ success: false, message: "Product not found." });
      return;
    }

    // Enforce ownership
    const caller = req.user as IUser | undefined;
    if (
      product.sellerId?.toString() !== seller._id.toString() &&
      product.createdBy?.toString() !== caller?._id?.toString()
    ) {
      if (files) {
        for (const f of files) {
          if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
        }
      }
      res.status(403).json({ success: false, message: "Forbidden. You do not own this product." });
      return;
    }

    if (!files || files.length === 0) {
      res.status(400).json({ success: false, message: "Please upload at least one image file." });
      return;
    }

    const uploadedUrls: string[] = [];
    const imageDocuments = [];

    for (const [i, file] of files.entries()) {
      try {
        const cloudUrl = await uploadToCloudinary(file.path, `hmarketplace/products/${id}`);
        const finalUrl = cloudUrl || `/uploads/user_profile/${file.filename}`;

        if (cloudUrl && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }

        uploadedUrls.push(finalUrl);

        const newImage = new ProductImage({
          catalogProductId: id,
          imageUrl: finalUrl,
          type: "image",
          sortOrder: i,
          isPrimary: i === 0,
        });
        await newImage.save();
        imageDocuments.push(newImage);
      } catch (uploadErr) {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        console.error("Single image upload failed:", uploadErr);
      }
    }

    // Invalidate product details cache
    await deleteCache(`product:slug:${product.slug}`);

    res.status(201).json({
      success: true,
      message: `${imageDocuments.length} images uploaded and linked successfully.`,
      images: imageDocuments,
    });
  } catch (error: unknown) {
    if (files) {
      for (const f of files) {
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
      }
    }
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
