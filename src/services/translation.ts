import crypto from "node:crypto";
import { getCache, setCache, isRedisActive } from "../utils/redis.js";
import { Translation } from "../models/translation.js";

// A small dictionary of common e-commerce words for mock fallback
const MOCK_DICTIONARY: Record<string, Record<string, string>> = {
  es: {
    "electronics": "electrónica",
    "clothing": "ropa",
    "home": "hogar",
    "books": "libros",
    "active": "activo",
    "draft": "borrador",
    "pending": "pendiente",
    "approved": "aprobado",
    "product": "producto",
    "cart": "carrito",
    "order": "orden",
    "price": "precio",
    "description": "descripción",
    "search": "buscar",
    "category": "categoría",
    "brand": "marca",
    "seller": "vendedor",
    "inventory": "inventario",
    "address": "dirección",
    "coupon": "cupón",
    "wishlist": "lista de deseos",
  },
  fr: {
    "electronics": "électronique",
    "clothing": "vêtements",
    "home": "maison",
    "books": "livres",
    "active": "actif",
    "draft": "brouillon",
    "pending": "en attente",
    "approved": "approuvé",
    "product": "produit",
    "cart": "panier",
    "order": "commande",
    "price": "prix",
    "description": "description",
    "search": "recherche",
    "category": "catégorie",
    "brand": "marque",
    "seller": "vendeur",
    "inventory": "inventaire",
    "address": "adresse",
    "coupon": "coupon",
    "wishlist": "liste de souhaits",
  },
  hi: {
    "electronics": "इलेक्ट्रॉनिक्स",
    "clothing": "कपड़े",
    "home": "घर",
    "books": "पुस्तकें",
    "active": "सक्रिय",
    "draft": "प्रारूप",
    "pending": "लंबित",
    "approved": "अनुमोदित",
    "product": "उत्पाद",
    "cart": "कार्ट",
    "order": "ऑर्डर",
    "price": "कीमत",
    "description": "विवरण",
    "search": "खोज",
    "category": "श्रेणी",
    "brand": "ब्रांड",
    "seller": "विक्रेता",
    "inventory": "माल सूची",
    "address": "पता",
    "coupon": "कूपन",
    "wishlist": "इच्छा सूची",
  },
  pa: {
    "electronics": "ਇਲੈਕਟ੍ਰਾਨਿਕਸ",
    "clothing": "ਕੱਪੜੇ",
    "home": "ਘਰ",
    "books": "ਕਿਤਾਬਾਂ",
    "active": "ਸਰਗਰਮ",
    "draft": "ਡਰਾਫਟ",
    "pending": "ਲੰਬਿਤ",
    "approved": "ਮਨਜ਼ੂਰ",
    "product": "ਉਤਪਾਦ",
    "cart": "ਕਾਰਟ",
    "order": "ਆਰਡਰ",
    "price": "ਕੀਮਤ",
    "description": "ਵੇਰਵਾ",
    "search": "ਖੋਜ",
    "category": "ਸ਼੍ਰੇਣੀ",
    "brand": "ਬ੍ਰਾਂਡ",
    "seller": "ਵਿਕਰੇਤਾ",
    "inventory": "ਇਨਵੈਂਟਰੀ",
    "address": "ਪਤਾ",
    "coupon": "ਕੂਪਨ",
    "wishlist": "ਇੱਛਾ ਸੂਚੀ",
  },
  mr: {
    "electronics": "इलेक्ट्रॉनिक्स",
    "clothing": "कपडे",
    "home": "घर",
    "books": "पुस्तके",
    "active": "सक्रिय",
    "draft": "मसुदा",
    "pending": "प्रलंबित",
    "approved": "मंजूर",
    "product": "उत्पादन",
    "cart": "कार्ट",
    "order": "ऑर्डर",
    "price": "किंमत",
    "description": "वर्णन",
    "search": "शोध",
    "category": "श्रेणी",
    "brand": "ब्रँड",
    "seller": "विक्रेता",
    "inventory": "इन्व्हेंटरी",
    "address": "पत्ता",
    "coupon": "कूपन",
    "wishlist": "इच्छा सूची",
  },
  te: {
    "electronics": "ఎలక్ట్రానిక్స్",
    "clothing": "దుస్తులు",
    "home": "ఇల్లు",
    "books": "పుస్తకాలు",
    "active": "క్రియాశీల",
    "draft": "డ్రాఫ్ట్",
    "pending": "పెండింగ్",
    "approved": "ఆమోదించబడింది",
    "product": "ఉత్పత్తి",
    "cart": "కార్ట్",
    "order": "ఆర్డర్",
    "price": "ధర",
    "description": "వివరణ",
    "search": "శోధన",
    "category": "వర్గం",
    "brand": "బ్రాండ్",
    "seller": "విక్రేత",
    "inventory": "ఇన్వెంటరీ",
    "address": "చిరునామా",
    "coupon": "కూపన్",
    "wishlist": "కోరికల జాబితా",
  },
};

/**
 * Generate a cache key for a specific translation request
 */
function getTranslationCacheKey(text: string, targetLanguage: string): string {
  const hash = crypto.createHash("md5").update(text).digest("hex");
  return `translation:${targetLanguage.toLowerCase()}:${hash}`;
}

/**
 * Perform a fetch with a specified timeout using AbortController.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 2000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(id);
  }
}

/**
 * Perform translation on a single text string using external APIs or local mock fallback
 */
async function translateSingleText(
  text: string,
  targetLanguage: string,
  sourceLanguage = "en"
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return text;

  // 1. Check if same language
  if (targetLanguage.toLowerCase() === sourceLanguage.toLowerCase()) {
    return text;
  }

  // 2. Check cache first
  const cacheKey = getTranslationCacheKey(trimmed, targetLanguage);
  const cached = await getCache<string>(cacheKey);
  if (cached) {
    return cached;
  }

  // 2.5 Check MongoDB database next
  const dbHash = crypto.createHash("md5").update(`${trimmed}:${targetLanguage.toLowerCase()}`).digest("hex");
  try {
    const existingTranslation = await Translation.findOne({ hash: dbHash }).lean();
    if (existingTranslation?.translatedText) {
      // Warm up Redis cache for future O(1) hits
      await setCache(cacheKey, existingTranslation.translatedText, 86400);
      return existingTranslation.translatedText;
    }
  } catch (err) {
    console.warn("Translation database lookup failed:", err);
  }

  let translated = "";
  const apiKey = process.env.GOOGLE_TRANSLATION_API_KEY;

  // 3. Try official Google Cloud Translation API
  if (apiKey) {
    try {
      const response = await fetchWithTimeout(
        `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            q: trimmed,
            target: targetLanguage,
            source: sourceLanguage,
            format: "text",
          }),
        },
        2000
      );

      if (response.ok) {
        const data = (await response.json()) as any;
        const translations = data?.data?.translations;
        if (Array.isArray(translations) && translations[0]?.translatedText) {
          translated = translations[0].translatedText;
        }
      } else {
        console.warn(`Official Google Translate API returned status ${response.status}`);
      }
    } catch (err: any) {
      if (err.name === "AbortError" || err.code === "UND_ERR_CONNECT_TIMEOUT" || err.cause?.code === "UND_ERR_CONNECT_TIMEOUT") {
        console.warn(`[Translation Service] Official Google Translate API timed out or connection failed for '${targetLanguage}'`);
      } else {
        console.warn("[Translation Service] Official Google Translate API request failed:", err.message || err);
      }
    }
  }

  // 4. Try Free Google Translate Web Client Fallback
  if (!translated) {
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=${sourceLanguage}&tl=${targetLanguage}&q=${encodeURIComponent(
        trimmed
      )}`;
      const response = await fetchWithTimeout(url, {}, 2000);
      if (response.ok) {
        const data = (await response.json()) as any;
        if (Array.isArray(data) && Array.isArray(data[0])) {
          translated = data[0]
            .map((part: any) => part[0])
            .filter((part: any) => typeof part === "string")
            .join("");
        }
      } else {
        console.warn(`Free Google Translate API returned status ${response.status}`);
      }
    } catch (err: any) {
      if (err.name === "AbortError" || err.code === "UND_ERR_CONNECT_TIMEOUT" || err.cause?.code === "UND_ERR_CONNECT_TIMEOUT") {
        console.warn(`[Translation Service] Free Google Translate API timed out or connection failed for '${targetLanguage}'`);
      } else {
        console.warn("[Translation Service] Free Google Translate API request failed:", err.message || err);
      }
    }
  }

  // 5. Fallback to Local Mock Dictionary
  let isFallbackToOriginal = false;
  if (!translated) {
    const targetDict = MOCK_DICTIONARY[targetLanguage.toLowerCase()];
    const lowerTrimmed = trimmed.toLowerCase();
    if (targetDict && targetDict[lowerTrimmed]) {
      translated = targetDict[lowerTrimmed];
    } else {
      translated = trimmed; // fallback to original word/text
      isFallbackToOriginal = true;
    }
  }

  // 6. Cache the result
  if (translated) {
    if (isFallbackToOriginal) {
      // Short-lived Redis cache (60 seconds) to prevent hammering, but do not write to MongoDB
      await setCache(cacheKey, translated, 60);
    } else {
      // Full 24-hour Redis cache
      await setCache(cacheKey, translated, 86400);

      // Save to MongoDB database persistently
      try {
        await Translation.findOneAndUpdate(
          { hash: dbHash },
          {
            hash: dbHash,
            originalText: trimmed,
            translatedText: translated,
            sourceLanguage,
            targetLanguage: targetLanguage.toLowerCase(),
          },
          { upsert: true, returnDocument: 'after' }
        );
      } catch (err) {
        console.warn("Failed to persist translation to MongoDB:", err);
      }
    }
  }

  return translated;
}

export const SUPPORTED_LANGUAGES = [
  "hi", // Hindi
  "pa", // Punjabi
  "mr", // Marathi
  "te", // Telugu
  "ta", // Tamil
  "bn", // Bengali
  "gu", // Gujarati
  "kn", // Kannada
  "ml", // Malayalam
  "ur", // Urdu
  "es", // Spanish
  "fr", // French
  "de", // German
  "it", // Italian
  "ja", // Japanese
  "zh", // Chinese (Simplified)
];

/**
 * Service to translate text with caching and fallback capabilities.
 */
export class TranslationService {
  /**
   * Translate a single text string or an array of text strings.
   */
  public static async translateText(
    text: string | string[],
    targetLanguage: string,
    sourceLanguage = "en"
  ): Promise<string | string[]> {
    if (!targetLanguage || targetLanguage.toLowerCase() === sourceLanguage.toLowerCase()) {
      return text;
    }

    if (Array.isArray(text)) {
      // Run translations in parallel for efficiency
      const promises = text.map((item) =>
        translateSingleText(item, targetLanguage, sourceLanguage)
      );
      return Promise.all(promises);
    }

    return translateSingleText(text, targetLanguage, sourceLanguage);
  }

  /**
   * Translate text into all supported languages in the background.
   * Runs asynchronously without blocking the main event loop.
   * In production, offloads the work to a BullMQ queue, keeping the HTTP worker light.
   */
  public static proactivelyTranslate(
    text: string | string[],
    sourceLanguage = "en"
  ): void {
    if (!text || (Array.isArray(text) && text.length === 0)) return;

    const strings = Array.isArray(text) ? text : [text];

    if (process.env.NODE_ENV === "production" && isRedisActive) {
      // Dynamic import to avoid circular dependency
      import("../workers/bullmq.js")
        .then(({ translationQueue }) => {
          translationQueue.add(
            "translateTextBatch",
            { strings, sourceLanguage },
            { attempts: 3, backoff: 5000 }
          ).then((job) => {
            console.log(`[Proactive Translation] Enqueued translation job ${job.id} to BullMQ queue`);
          }).catch((err) => {
            console.error("[Proactive Translation] Failed to add translation job to queue:", err);
          });
        })
        .catch((err) => {
          console.error("[Proactive Translation] Failed to load translationQueue:", err);
        });
      return;
    }

    // In development or if Redis is offline, run in-process asynchronously
    this.executeProactiveTranslation(strings, sourceLanguage).catch((err) => {
      console.error("[Proactive Translation] In-process execution failed:", err);
    });
  }

  /**
   * The actual execution logic for proactive background translations.
   * Iterates through supported languages and triggers translation.
   */
  public static async executeProactiveTranslation(
    strings: string[],
    sourceLanguage = "en"
  ): Promise<void> {
    const promises = SUPPORTED_LANGUAGES.map(async (lang) => {
      if (lang.toLowerCase() === sourceLanguage.toLowerCase()) return;
      try {
        await this.translateText(strings, lang, sourceLanguage);
        console.log(`[Proactive Translation] Successfully cached translation in '${lang}'`);
      } catch (err: any) {
        console.error(`[Proactive Translation] Failed translation in '${lang}':`, err.message || err);
      }
    });
    await Promise.all(promises);
  }
}

export default TranslationService;
