import { type Request, type Response } from "express";
import { OpenAI } from "openai";

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

export const handleChat = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user; // from authenticateUser
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ success: false, message: "Messages array is required." });
      return;
    }

    // Prepare system prompt with basic user context
    const systemPrompt = `You are a helpful customer support AI for HindustaanMart, an eCommerce platform in India.
Your goal is to help users with their shopping queries, return policies, order tracking, and general questions.
Be concise, polite, and use a friendly tone. You can use Hindi words written in English (Hinglish) occasionally to connect better with Indian users.
The user you are talking to is named: ${user?.name || "Customer"}.
Email: ${user?.email || "Unknown"}.
If they ask about an order and you don't have the order details, tell them to check the "My Orders" section in their profile or provide their Order ID.
`;

    // Construct full message list
    const apiMessages = [
      { role: "system", content: systemPrompt },
      ...messages
    ];

    const response = await client.chat.completions.create({
      model: "llama3-8b-8192",
      messages: apiMessages,
      temperature: 0.7,
      max_tokens: 500,
    });

    res.status(200).json({
      success: true,
      message: response.choices[0]?.message?.content || "I'm sorry, I couldn't process that right now."
    });
  } catch (error: any) {
    console.error("Chat API Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to process chat query."
    });
  }
};
