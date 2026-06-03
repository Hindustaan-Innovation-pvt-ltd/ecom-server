import { Router, type Request, type Response } from "express";
import { TranslationService } from "../services/translation.js";

const router = Router();

router.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const { text, targetLanguage, sourceLanguage = "en" } = req.body;

    if (!text) {
      res.status(400).json({
        success: false,
        message: "Required field: 'text' (string or array of strings).",
      });
      return;
    }

    if (Array.isArray(text) && text.length === 0) {
      res.status(400).json({
        success: false,
        message: "'text' array cannot be empty.",
      });
      return;
    }

    if (!targetLanguage) {
      res.status(400).json({
        success: false,
        message: "Required field: 'targetLanguage'.",
      });
      return;
    }

    const translated = await TranslationService.translateText(
      text,
      targetLanguage,
      sourceLanguage
    );

    res.status(200).json({
      success: true,
      translatedText: translated,
      sourceLanguage,
      targetLanguage,
    });
  } catch (error) {
    console.error("Translation route error:", error);
    const errorMessage = error instanceof Error ? error.message : "Translation failed.";
    res.status(500).json({
      success: false,
      message: errorMessage,
    });
  }
});

export default router;
