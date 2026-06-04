import mongoose, { Schema, type Document } from "mongoose";

export interface ITranslation extends Document {
  hash: string;
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  createdAt: Date;
  updatedAt: Date;
}

const TranslationSchema = new Schema<ITranslation>(
  {
    hash: {
      type: String,
      required: [true, "Translation hash is required"],
      unique: true,
      trim: true,
    },
    originalText: {
      type: String,
      required: [true, "Original text is required"],
      trim: true,
    },
    translatedText: {
      type: String,
      required: [true, "Translated text is required"],
      trim: true,
    },
    sourceLanguage: {
      type: String,
      required: [true, "Source language is required"],
      default: "en",
      trim: true,
    },
    targetLanguage: {
      type: String,
      required: [true, "Target language is required"],
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes — unique index is implicit on the hash property, but we add an index on targetLanguage for catalog filters if needed
TranslationSchema.index({ targetLanguage: 1 });

export const Translation = mongoose.model<ITranslation>("Translation", TranslationSchema);
export default Translation;
