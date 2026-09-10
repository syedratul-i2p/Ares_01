import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize the SDK with the project API Key
const API_KEY = "YOUR_API_KEY_HERE";
const genAI = new GoogleGenerativeAI(API_KEY);

// Define the precise robotics model endpoint
export const autonomousModel = genAI.getGenerativeModel({ 
    model: "gemini-robotics-er-2-preview" 
});

export const processAutonomousCommand = async (prompt: string, imageBase64?: string) => {
    try {
        const systemInstruction = "Analyze the image. If the user asks to pick an object, return a JSON array containing the object's precise normalized [y, x] coordinates (0-1000) and an action plan. Format: { \"action\": \"PICK\", \"target\": \"red object\", \"coordinates\": [y, x], \"drive_direction\": \"FORWARD\" }. If no action, return { \"action\": \"TASK_COMPLETE\" }. Reply strictly with ONLY raw JSON, no markdown blocks.";
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
        const result = await autonomousModel.generateContent(parts);
        const text = result.response.text();
        
        // Strip markdown backticks if present
        const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(jsonStr);
    } catch (error) {
        console.error("[Gemini AI Error]", error);
        throw error;
    }
};
