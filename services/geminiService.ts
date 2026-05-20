
import { GoogleGenAI, Type } from "@google/genai";
import { Conversation, EvaluationResult, Role, Criteria } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Step 1: Verify facts using Google Search Grounding
 */
export const performFactCheck = async (conversation: Conversation): Promise<{ text: string, sources: Array<{uri: string, title: string}> }> => {
  const model = "gemini-2.5-flash"; // Flash is good for fast search/retrieval
  
  // Extract only model claims or the full flow to check
  const transcript = conversation.messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

  const prompt = `
    Analyze the following conversation for factual accuracy. 
    Use Google Search to verify specific claims made by the 'MODEL'.
    
    Conversation:
    ${transcript}

    Provide a concise "Fact Check Report" listing any inaccuracies found. 
    If all claims are accurate, state that.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }], // Enable Search Tool
        // responseMimeType cannot be JSON when using tools in this SDK version context
      }
    });

    // Extract sources from grounding metadata
    const sources: Array<{uri: string, title: string}> = [];
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    
    if (chunks) {
      chunks.forEach((chunk: any) => {
        if (chunk.web?.uri && chunk.web?.title) {
          sources.push({
            uri: chunk.web.uri,
            title: chunk.web.title
          });
        }
      });
    }

    return {
      text: response.text || "No fact check analysis generated.",
      sources
    };

  } catch (error) {
    console.warn("Fact check failed", error);
    return { text: "Fact check could not be completed.", sources: [] };
  }
};

/**
 * Step 2: Evaluate using LLM-as-a-Judge (G-Eval) with optional context and fact check report
 */
export const evaluateConversation = async (
  conversation: Conversation, 
  criteria: Criteria[],
  factCheckData?: { text: string, sources: any[] }
): Promise<EvaluationResult> => {
  // Use Pro for complex reasoning if available, otherwise Flash
  const model = "gemini-2.5-flash"; 
  
  const transcript = conversation.messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

  // Build dynamic criteria string
  const criteriaText = criteria.map((c, i) => `${i + 1}. ${c.name}: ${c.description}`).join('\n    ');

  // Construct context blocks
  let contextBlock = "";
  if (conversation.domainContext) {
    contextBlock += `\n    DOMAIN CONTEXT / KNOWLEDGE BASE:\n    ${conversation.domainContext}\n`;
  }
  if (conversation.referenceContext) {
    contextBlock += `\n    GROUND TRUTH / REFERENCE ANSWER:\n    ${conversation.referenceContext}\n`;
  }
  if (factCheckData) {
    contextBlock += `\n    FACT CHECK REPORT (Verified via Google Search):\n    ${factCheckData.text}\n`;
  }

  const systemInstruction = `
    You are an expert AI Conversation Evaluator (LLM-as-a-Judge). 
    Your task is to evaluate the provided Multi-turn conversation between a User and an AI Assistant.
    
    ${contextBlock ? `Use the following context to inform your judgment:${contextBlock}` : ''}

    Assess the conversation based strictly on the following evaluation criteria (scale 1-10):
    ${criteriaText}

    Instructions:
    - If "Ground Truth" is provided, penalized the model if it deviates significantly from the intent or facts of the ground truth.
    - If "Fact Check Report" indicates inaccuracies, strictly penalize the 'Accuracy' or 'Safety' or 'Trustfulness' scores.
    - Provide a JSON response with scores, reasoning for each score, an overall summary, and a weighted overall score.
  `;

  const prompt = `Evaluate the following conversation transcript:\n\n${transcript}`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overallScore: { type: Type.NUMBER, description: "Overall weighted score from 1-10" },
            summary: { type: Type.STRING, description: "A concise executive summary of the conversation performance." },
            suggestedImprovements: { type: Type.STRING, description: "Actionable feedback for improvement." },
            metrics: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  score: { type: Type.NUMBER },
                  reasoning: { type: Type.STRING }
                },
                required: ["name", "score", "reasoning"]
              }
            }
          },
          required: ["overallScore", "summary", "metrics"]
        }
      }
    });

    if (response.text) {
      const result = JSON.parse(response.text) as Omit<EvaluationResult, 'timestamp'>;
      return {
        ...result,
        timestamp: Date.now(),
        // Pass through the fact check data to the result object for display
        factCheckReport: factCheckData?.text,
        factCheckSources: factCheckData?.sources
      };
    }
    
    throw new Error("No response text from Gemini");

  } catch (error) {
    console.error("Evaluation failed", error);
    throw error;
  }
};

export const generateSampleConversation = async (): Promise<Conversation> => {
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: "Generate a sample multi-turn conversation JSON between a user asking about the history of the Eiffel Tower and a helpful AI. The JSON should be an array of objects with 'role' (user/model) and 'content'. Make it about 4 turns long.",
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        role: { type: Type.STRING },
                        content: { type: Type.STRING }
                    }
                }
            }
        }
    });

    const messagesRaw = JSON.parse(response.text || "[]");
    
    const messages = messagesRaw.map((m: any, idx: number) => ({
        id: `msg-${Date.now()}-${idx}`,
        role: m.role === 'model' ? Role.MODEL : Role.USER,
        content: m.content,
        comments: []
    }));

    return {
        id: `conv-${Date.now()}`,
        title: "Eiffel History Check",
        messages,
        createdAt: Date.now(),
        domainContext: "The Eiffel Tower was constructed in 1887-1889 as the entrance to the 1889 World's Fair. It is named after engineer Gustave Eiffel.",
        referenceContext: "Model should mention 1889 World's Fair, Gustave Eiffel, and the initial criticism from artists."
    };
};
