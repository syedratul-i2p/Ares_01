import { GoogleGenerativeAI } from "@google/generative-ai";

// ── Multiple API Keys for Rate-Limit (RPM) Bypass ──
// Keys are safely loaded from .env (VITE_GEMINI_KEYS) so GitHub will not block pushes.
const ENV_KEYS = (import.meta.env.VITE_GEMINI_KEYS as string || "")
    .split(",")
    .map((k: string) => k.trim())
    .filter(Boolean);

const API_KEYS = ENV_KEYS.length > 0 ? ENV_KEYS : [
    "YOUR_API_KEY_HERE"
];

let currentKeyIndex = 0;

// Dynamically get the model using the current active API key
const getActiveModel = () => {
    // Filter out placeholder keys
    const validKeys = API_KEYS.filter(k => k && !k.includes("ADD_YOUR_"));
    if (validKeys.length === 0) {
        throw new Error("Missing Gemini API Key. Please add valid keys to API_KEYS array.");
    }
    
    // Ensure the index is within bounds of valid keys
    const activeKey = validKeys[currentKeyIndex % validKeys.length];
    const genAI = new GoogleGenerativeAI(activeKey);
    return genAI.getGenerativeModel({ model: "gemini-robotics-er-2-preview" });
};

export const processAutonomousCommand = async (prompt: string, imageBase64?: string) => {
    const validKeys = API_KEYS.filter(k => k && !k.includes("ADD_YOUR_"));
    if (validKeys.length === 0) {
        throw new Error("Missing Gemini API Key. Please open 'src/services/geminiService.ts' and paste valid keys.");
    }

    const systemInstruction = `You are an autonomous rover AI. Analyze the image and respond strictly in raw JSON without markdown blocks.
JSON format required:
{
  "action": "TASK_COMPLETE" | "PICK" | "SCAN" | "DRIVING",
  "detected_objects": [
    { "name": "short descriptive name", "coordinates": [y_percent, x_percent] }
  ],
  "hardware_payload": {
    "target_coordinates": [y_percent, x_percent],
    "drive_direction": "FORWARD" | "BACKWARD" | "LEFT" | "RIGHT" | "STOP"
  }
}
Coordinates MUST be 0 to 100 representing percentage from top-left (y is top-to-bottom, x is left-to-right).`;

    const fullPrompt = `${systemInstruction}\n\nUser Directive: ${prompt}`;

    const parts: any[] = [{ text: fullPrompt }];
    if (imageBase64) {
        parts.push({
            inlineData: {
                data: imageBase64.split(',')[1] || imageBase64,
                mimeType: "image/jpeg"
            }
        });
    }

    let attempts = 0;
    let lastError: any = null;

    // Retry loop: will attempt as many times as there are valid keys
    while (attempts < validKeys.length) {
        try {
            const autonomousModel = getActiveModel();
            const result = await autonomousModel.generateContent(parts);
            const text = result.response.text();
            
            // Strip markdown backticks if present
            const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            return JSON.parse(jsonStr);
            
        } catch (error: any) {
            console.warn(`[Gemini API] Key ${currentKeyIndex + 1} failed (Attempt ${attempts + 1}/${validKeys.length}):`, error.message);
            lastError = error;
            
            // On failure (likely 429 Too Many Requests or 403 Quota Exceeded), rotate to the next key
            currentKeyIndex = (currentKeyIndex + 1) % validKeys.length;
            console.log(`[Gemini API] Switching to Fallback Key ${currentKeyIndex + 1}...`);
            attempts++;
        }
    }

    // If we break out of the loop, all keys failed
    console.error("[Gemini AI Error] All API keys exhausted or rate-limited.", lastError);
    throw new Error("All API keys are currently rate-limited (429). Please wait a minute or add more keys.");
};

