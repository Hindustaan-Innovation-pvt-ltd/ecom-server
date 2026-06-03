import type { Schema } from "mongoose";
import { TranslationService } from "../services/translation.js";

const EXCLUDED_KEYS = new Set([
  "_id",
  "id",
  "__v",
  "slug",
  "email",
  "phone",
  "password",
  "url",
  "status",
  "role",
  "gstnumber",
  "barcode",
  "sku",
  "postalcode",
  "pincode",
  "country",
  "state",
  "city",
  "coordinates",
  "condition",
  "events",
  "secret",
  "webhooksecret",
  "token",
  "createdby",
  "updatedby",
  "approvedby",
  "moderatedby",
  "createdat",
  "updatedat",
]);

/**
 * Recursively extracts all string values from an object,
 * excluding system, config, ID, and numeric properties.
 */
function extractTranslatableStrings(obj: any): string[] {
  const strings: string[] = [];
  if (!obj || typeof obj !== "object") return strings;

  for (const key of Object.keys(obj)) {
    const lowerKey = key.toLowerCase();
    if (EXCLUDED_KEYS.has(lowerKey)) continue;

    const val = obj[key];
    if (typeof val === "string") {
      const trimmed = val.trim();
      // Ignore Mongo ObjectIds, pure numbers, and empty strings
      if (trimmed && !/^[0-9a-fA-F]{24}$/.test(trimmed) && Number.isNaN(Number(trimmed))) {
        strings.push(trimmed);
      }
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === "string") {
          const trimmed = item.trim();
          if (trimmed && !/^[0-9a-fA-F]{24}$/.test(trimmed) && Number.isNaN(Number(trimmed))) {
            strings.push(trimmed);
          }
        } else if (typeof item === "object") {
          strings.push(...extractTranslatableStrings(item));
        }
      }
    } else if (typeof val === "object") {
      strings.push(...extractTranslatableStrings(val));
    }
  }

  // De-duplicate strings to optimize batch translate calls
  return Array.from(new Set(strings));
}

/**
 * Universal Mongoose plugin to automatically trigger background proactive translations
 * for all modified/written string fields on post-save and post-findOneAndUpdate database operations.
 */
export function translationPlugin(schema: Schema) {
  // 1. Post Save Hook (Insert & Document Updates)
  schema.post("save", function (doc) {
    if (doc) {
      try {
        const strings = extractTranslatableStrings(doc.toObject());
        if (strings.length > 0) {
          TranslationService.proactivelyTranslate(strings);
        }
      } catch (err) {
        console.error("Plugin post-save translation error:", err);
      }
    }
  });

  // 2. Post findOneAndUpdate Hook (Query Updates)
  schema.post("findOneAndUpdate", function (doc) {
    if (doc) {
      try {
        const docObj = typeof doc.toObject === "function" ? doc.toObject() : doc;
        const strings = extractTranslatableStrings(docObj);
        if (strings.length > 0) {
          TranslationService.proactivelyTranslate(strings);
        }
      } catch (err) {
        console.error("Plugin post-findOneAndUpdate translation error:", err);
      }
    }
  });
}

export default translationPlugin;
