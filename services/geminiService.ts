import { GoogleGenAI, Type } from "@google/genai";
import { Conversation, EvaluationResult, Role, Criteria } from "../types";

export interface LLMConfig {
  provider: 'gemini' | 'openai' | 'anthropic';
  geminiKey: string;
  geminiModel: string;
  geminiBaseUrl: string;
  openaiKey: string;
  openaiModel: string;
  openaiBaseUrl: string;
  anthropicKey: string;
  anthropicModel: string;
  anthropicBaseUrl: string;
}

/**
 * Dynamically retrieves user configuration from LocalStorage or environment fallback
 */
export const getLLMConfig = (): LLMConfig => {
  if (typeof window === 'undefined') {
    return {
      provider: 'gemini',
      geminiKey: process.env.API_KEY || process.env.GEMINI_API_KEY || '',
      geminiModel: 'gemini-2.5-flash',
      geminiBaseUrl: '',
      openaiKey: '',
      openaiModel: 'gpt-4o-mini',
      openaiBaseUrl: '',
      anthropicKey: '',
      anthropicModel: 'claude-3-5-sonnet-20241022',
      anthropicBaseUrl: '',
    };
  }

  // Backwards compatibility with previous key 'evalai_api_key'
  const fallbackGeminiKey = localStorage.getItem('evalai_api_key') || '';
  
  return {
    provider: (localStorage.getItem('evalai_provider') as any) || 'gemini',
    geminiKey: localStorage.getItem('evalai_gemini_api_key') || fallbackGeminiKey || process.env.API_KEY || process.env.GEMINI_API_KEY || '',
    geminiModel: localStorage.getItem('evalai_gemini_model') || 'gemini-3.5-flash',
    geminiBaseUrl: localStorage.getItem('evalai_gemini_base_url') || '',
    openaiKey: localStorage.getItem('evalai_openai_api_key') || '',
    openaiModel: localStorage.getItem('evalai_openai_model') || 'gpt-4o-mini',
    openaiBaseUrl: localStorage.getItem('evalai_openai_base_url') || '',
    anthropicKey: localStorage.getItem('evalai_anthropic_api_key') || '',
    anthropicModel: localStorage.getItem('evalai_anthropic_model') || 'claude-3-5-sonnet-20241022',
    anthropicBaseUrl: localStorage.getItem('evalai_anthropic_base_url') || '',
  };
};

/**
 * Instantiates the Gemini SDK client dynamically
 */
const getAI = (): GoogleGenAI => {
  const config = getLLMConfig();
  const apiKey = config.geminiKey;
  if (!apiKey) {
    throw new Error("Gemini API Key is missing. Please configure it in your Settings dashboard.");
  }
  
  const options: any = {
    apiKey,
  };
  
  if (config.geminiBaseUrl) {
    options.baseURL = config.geminiBaseUrl;
  }

  options.httpOptions = {
    headers: {
      'User-Agent': 'aistudio-build'
    }
  };

  return new GoogleGenAI(options);
};

/**
 * Step 1: Verify facts using Google Search Grounding (Gemini) or LLM self-fact checking (OpenAI/Anthropic)
 */
export const performFactCheck = async (conversation: Conversation): Promise<{ text: string, sources: Array<{uri: string, title: string}> }> => {
  const config = getLLMConfig();
  const transcript = conversation.messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

  const prompt = `
    Analyze the following conversation for factual accuracy. 
    Use your available knowledge to verify specific claims made by the 'MODEL'.
    
    Conversation:
    ${transcript}

    Provide a concise "Fact Check Report" listing any inaccuracies or hallucinations found. 
    If all claims are accurate, state that explicitly.
  `;

  // Gemini uses Web Search Grounding if configured
  if (config.provider === 'gemini') {
    try {
      const model = config.geminiModel || "gemini-3.5-flash";
      const response = await getAI().models.generateContent({
        model,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }], // Enable real-time Google Search Grounding
        }
      });

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
    } catch (error: any) {
      console.warn("Gemini Fact check with Google Search grounding failed, falling back to basic self-check", error);
      try {
        const model = config.geminiModel || "gemini-3.5-flash";
        const response = await getAI().models.generateContent({
          model,
          contents: prompt,
        });
        return {
          text: (response.text || "No fact check analysis generated.") + "\n\n*(Note: Ran model-native self-check because Google Search grounding was unavailable with this API Key or model)*",
          sources: []
        };
      } catch (fallbackError: any) {
        console.error("Gemini basic self-check also failed", fallbackError);
        return {
          text: `Fact check failed: ${fallbackError?.message || fallbackError || "Unknown error"}. Please check if your Gemini API key is configured correctly in System Settings.`,
          sources: []
        };
      }
    }
  }

  // OpenAI self-check
  if (config.provider === 'openai') {
    try {
      if (!config.openaiKey) {
        return { text: "OpenAI API Key is missing. Cannot perform fact check.", sources: [] };
      }
      const endpoint = config.openaiBaseUrl 
        ? `${config.openaiBaseUrl.replace(/\/$/, '')}/chat/completions` 
        : 'https://api.openai.com/v1/chat/completions';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.openaiKey}`
        },
        body: JSON.stringify({
          model: config.openaiModel || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are an objective Fact Verification Assistant.' },
            { role: 'user', content: prompt }
          ]
        })
      });

      if (!response.ok) {
        let errSnippet = `OpenAI status ${response.status}`;
        try {
          const errText = await response.text();
          const parsed = JSON.parse(errText);
          if (parsed.error?.message) {
            errSnippet += `: ${parsed.error.message}`;
          } else {
            errSnippet += `: ${errText}`;
          }
        } catch (_) {}
        if (response.status === 401) {
          errSnippet += " (Please check that your character-exact OpenAI API Key is valid and correctly configured under Settings -> API Settings)";
        }
        throw new Error(errSnippet);
      }
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || "No analysis provided.";
      return { text, sources: [] };
    } catch (e: any) {
      console.error("OpenAI Fact check failed", e);
      return { text: `OpenAI Fact check failed: ${e?.message || e || "Unknown error"}. Please check your OpenAI configuration in System Settings.`, sources: [] };
    }
  }

  // Anthropic Claude self-check
  if (config.provider === 'anthropic') {
    try {
      if (!config.anthropicKey) {
        return { text: "Anthropic API Key is missing. Cannot perform fact check.", sources: [] };
      }
      const endpoint = config.anthropicBaseUrl 
        ? `${config.anthropicBaseUrl.replace(/\/$/, '')}/messages` 
        : 'https://api.anthropic.com/v1/messages';

      const headers: Record<string, string> = {
        'content-type': 'application/json'
      };
      if (config.anthropicBaseUrl && (config.anthropicBaseUrl.includes('openai') || config.anthropicBaseUrl.includes('openrouter'))) {
        headers['Authorization'] = `Bearer ${config.anthropicKey}`;
      } else {
        headers['X-API-Key'] = config.anthropicKey;
        headers['anthropic-version'] = '2023-06-01';
      }

      let payload: any;
      if (config.anthropicBaseUrl && (config.anthropicBaseUrl.includes('openrouter') || config.anthropicBaseUrl.includes('openai'))) {
        payload = {
          model: config.anthropicModel || 'claude-3-5-sonnet-20241022',
          messages: [
            { role: 'system', content: 'You are an objective Fact Verification Assistant.' },
            { role: 'user', content: prompt }
          ]
        };
      } else {
        payload = {
          model: config.anthropicModel || 'claude-3-5-sonnet-20241022',
          max_tokens: 1500,
          system: 'You are an objective Fact Verification Assistant.',
          messages: [
            { role: 'user', content: prompt }
          ]
        };
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error(`Claude status ${response.status}`);
      const data = await response.json();
      let text = "No analysis provided.";
      if (data.content && Array.isArray(data.content)) {
        text = data.content[0]?.text;
      } else if (data.choices?.[0]?.message?.content) {
        text = data.choices[0].message.content;
      }
      return { text, sources: [] };
    } catch (e: any) {
      console.error("Anthropic Fact check failed", e);
      return { text: `Anthropic Fact check failed: ${e?.message || e || "Unknown error"}. Please check your Anthropic configuration in System Settings.`, sources: [] };
    }
  }

  return { text: "Fact check could not be completed.", sources: [] };
};

/**
 * Normalizes evaluation results to ensure consistent and safe structure.
 * Robustly addresses differences in LLM outputs (such as suggestedImprovements returning as an Array).
 */
const normalizeResult = (raw: any, factCheckData?: { text: string, sources: any[] }): Omit<EvaluationResult, 'timestamp'> => {
  let suggested = raw.suggestedImprovements;
  if (Array.isArray(suggested)) {
    suggested = suggested.join('\n');
  } else if (suggested && typeof suggested !== 'string') {
    suggested = String(suggested);
  }
  return {
    overallScore: typeof raw.overallScore === 'number' ? raw.overallScore : parseFloat(raw.overallScore) || 0,
    summary: String(raw.summary || ""),
    metrics: Array.isArray(raw.metrics) ? raw.metrics.map((m: any) => ({
      name: String(m.name || ""),
      score: typeof m.score === 'number' ? m.score : parseInt(m.score) || 0,
      reasoning: String(m.reasoning || "")
    })) : [],
    suggestedImprovements: suggested || "",
    factCheckReport: factCheckData?.text,
    factCheckSources: factCheckData?.sources
  };
};

/**
 * Step 2: Evaluate using G-Eval with custom criteria and context and fact check
 */
export const evaluateConversation = async (
  conversation: Conversation, 
  criteria: Criteria[],
  factCheckData?: { text: string, sources: any[] }
): Promise<EvaluationResult> => {
  const config = getLLMConfig();
  const transcript = conversation.messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
  const criteriaText = criteria.map((c, i) => `${i + 1}. ${c.name}: ${c.description}`).join('\n    ');

  let contextBlock = "";
  if (conversation.domainContext) {
    contextBlock += `\n    DOMAIN CONTEXT / KNOWLEDGE BASE:\n    ${conversation.domainContext}\n`;
  }
  if (conversation.referenceContext) {
    contextBlock += `\n    GROUND TRUTH / REFERENCE ANSWER:\n    ${conversation.referenceContext}\n`;
  }
  if (factCheckData) {
    contextBlock += `\n    FACT CHECK REPORT:\n    ${factCheckData.text}\n`;
  }

  const systemInstruction = `
You are an expert, objective AI Conversation Evaluator acting as an LLM-as-a-Judge.
Your task is to evaluate the ENTIRE multi-turn conversation (typically 3–15 turns) between a USER and an AI ASSISTANT — not any single turn in isolation.

${contextBlock ? `Use the following context to inform your judgment:\n${contextBlock}` : ''}

━━━ STEP 1: ANALYZE BEFORE SCORING (Chain-of-Thought) ━━━
Before assigning any score, carefully read the full conversation from start to finish.
For each criterion below, identify 1–2 specific moments or patterns from the conversation that support your judgment. Only then assign a score.
This reasoning step is mandatory — do not skip it.

━━━ STEP 2: EVALUATION CRITERIA ━━━
Score each criterion from 1 to 10 using these anchors:
  1–3 = Poor       (major failure, clearly inadequate)
  4–5 = Weak       (partially meets expectations, inconsistent)
  6–7 = Acceptable (meets basic expectations, minor gaps)
  8–9 = Good       (strong performance, only minor issues)
  10  = Excellent  (no meaningful flaws)

${criteriaText}

━━━ STEP 3: SCORING RULES ━━━
1. HOLISTIC EVALUATION: Score the full conversation arc, not just the last reply. Consider how well the AI maintained quality across all turns.
2. NO VERBOSITY BIAS: Do NOT reward responses for being long, detailed, or confident-sounding. A concise, accurate answer scores higher than a long, vague one.
3. GROUND TRUTH: If provided, penalize proportionally when the AI contradicts or significantly omits key facts from it.
4. FACT CHECK: If a Fact Check Report confirms inaccuracies, reduce the relevant Accuracy score by at least 2 points. If the AI stated false claims confidently, also reduce Trustworthiness by 1 point.
5. EDGE CASES: If the AI appropriately refused to answer, do not penalize. If the conversation is fewer than 3 AI turns, apply scores conservatively and note this in the summary.

━━━ STEP 4: OVERALL SCORE ━━━
Compute the overall score as the simple arithmetic mean of all metric scores, rounded to one decimal place.

━━━ OUTPUT FORMAT ━━━
Return ONLY a single valid JSON object. No markdown, no text outside the JSON.
{
  "overallScore": <number 1.0–10.0, arithmetic mean of all metric scores>,
  "summary": "<2–3 sentences summarizing overall conversation quality, citing specific evidence>",
  "suggestedImprovements": "<3–5 specific, actionable bullet points each starting with a verb>",
  "metrics": [
    {
      "name": "<exact criterion name as given>",
      "score": <integer 1–10>,
      "reasoning": "<2–3 sentences citing specific evidence from the conversation that justifies this score>"
    }
  ]
}
`;

  const prompt = `Evaluate the following conversation transcript:\n\n${transcript}`;

  // 1. GEMINI EVALUATION
  if (config.provider === 'gemini') {
    const model = config.geminiModel || "gemini-3.5-flash"; 
    const response = await getAI().models.generateContent({
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
      const result = JSON.parse(response.text);
      return {
        ...normalizeResult(result, factCheckData),
        timestamp: Date.now()
      };
    }
    throw new Error("No response text from Gemini");
  }

  // 2. OPENAI EVALUATION
  if (config.provider === 'openai') {
    if (!config.openaiKey) {
      throw new Error("OpenAI API Key is missing in Settings.");
    }
    const endpoint = config.openaiBaseUrl 
      ? `${config.openaiBaseUrl.replace(/\/$/, '')}/chat/completions` 
      : 'https://api.openai.com/v1/chat/completions';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.openaiKey}`
      },
      body: JSON.stringify({
        model: config.openaiModel || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: prompt }
        ],
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("Empty response from OpenAI");

    const result = JSON.parse(text);
    return {
      ...normalizeResult(result, factCheckData),
      timestamp: Date.now()
    };
  }

  // 3. ANTHROPIC EVALUATION
  if (config.provider === 'anthropic') {
    if (!config.anthropicKey) {
      throw new Error("Anthropic API Key is missing in Settings.");
    }
    const endpoint = config.anthropicBaseUrl 
      ? `${config.anthropicBaseUrl.replace(/\/$/, '')}/messages` 
      : 'https://api.anthropic.com/v1/messages';

    const headers: Record<string, string> = {
      'content-type': 'application/json'
    };

    const isOpenAiProxy = config.anthropicBaseUrl && (config.anthropicBaseUrl.includes('openai') || config.anthropicBaseUrl.includes('openrouter'));

    if (isOpenAiProxy) {
      headers['Authorization'] = `Bearer ${config.anthropicKey}`;
    } else {
      headers['X-API-Key'] = config.anthropicKey;
      headers['anthropic-version'] = '2023-06-01';
    }

    let payload: any;
    if (isOpenAiProxy) {
      payload = {
        model: config.anthropicModel || 'claude-3-5-sonnet-20241022',
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: prompt }
        ],
        response_format: { type: "json_object" }
      };
    } else {
      payload = {
        model: config.anthropicModel || 'claude-3-5-sonnet-20241022',
        max_tokens: 4000,
        system: systemInstruction,
        messages: [
          { role: 'user', content: `${prompt}\n\nPlease respond with valid JSON only.` }
        ]
      };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    let text = "";
    if (data.content && Array.isArray(data.content)) {
      text = data.content[0]?.text;
    } else if (data.choices?.[0]?.message?.content) {
      text = data.choices[0].message.content;
    }

    if (!text) throw new Error("Empty response from Claude");

    // Clean JSON block if markdown wrapping was used
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const cleanJson = jsonMatch ? jsonMatch[0] : text;

    const result = JSON.parse(cleanJson);
    return {
      ...normalizeResult(result, factCheckData),
      timestamp: Date.now()
    };
  }

  throw new Error("Selected LLM provider is unsupported.");
};

/**
 * Generates Eiffel Tower history dialog sample from preferred provider
 */
export const generateSampleConversation = async (): Promise<Conversation> => {
  const config = getLLMConfig();
  const basePrompt = "Generate a sample multi-turn conversation JSON between a user asking about the history of the Eiffel Tower and a helpful AI. The JSON should be a flat array of message objects, each containing exactly 'role' (either 'user' or 'model') and 'content'. Make it about 4 turns long.";

  // 1. GEMINI SAMPLE GENERATION
  if (config.provider === 'gemini') {
    const response = await getAI().models.generateContent({
      model: config.geminiModel || "gemini-3.5-flash",
      contents: basePrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              role: { type: Type.STRING },
              content: { type: Type.STRING }
            },
            required: ["role", "content"]
          }
        }
      }
    });

    const messagesRaw = JSON.parse(response.text || "[]");
    const messages = messagesRaw.map((m: any, idx: number) => ({
      id: `msg-${Date.now()}-${idx}`,
      role: m.role === 'model' || m.role === 'assistant' ? Role.MODEL : Role.USER,
      content: m.content || "",
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
  }

  // 2. OPENAI SAMPLE GENERATION
  if (config.provider === 'openai') {
    if (!config.openaiKey) {
      throw new Error("OpenAI API Key is required to generate samples. Configure OpenAI in Settings or select Gemini.");
    }
    const endpoint = config.openaiBaseUrl 
      ? `${config.openaiBaseUrl.replace(/\/$/, '')}/chat/completions` 
      : 'https://api.openai.com/v1/chat/completions';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.openaiKey}`
      },
      body: JSON.stringify({
        model: config.openaiModel || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a helpful data generator. Always output valid JSON only.' },
          { role: 'user', content: `${basePrompt}\n\nIMPORTANT: Return ONLY a raw JSON array matching: [{"role": "user"|"model", "content": "..."}]` }
        ],
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) throw new Error(`OpenAI status ${response.status}`);
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("Empty generation response from OpenAI");

    // OpenAI sometimes wraps structured array in a key or yields directly.
    let parsed = JSON.parse(text);
    if (!Array.isArray(parsed) && parsed.messages) {
      parsed = parsed.messages;
    } else if (!Array.isArray(parsed) && typeof parsed === 'object') {
      const keys = Object.keys(parsed);
      if (keys.length === 1 && Array.isArray(parsed[keys[0]])) {
        parsed = parsed[keys[0]];
      }
    }

    if (!Array.isArray(parsed)) {
      throw new Error("OpenAI returned object instead of array.");
    }

    const messages = parsed.map((m: any, idx: number) => ({
      id: `msg-${Date.now()}-${idx}`,
      role: m.role === 'model' || m.role === 'assistant' || m.role === 'ai' ? Role.MODEL : Role.USER,
      content: m.content || "",
      comments: []
    }));

    return {
      id: `conv-${Date.now()}`,
      title: "Eiffel History (GPT-generated)",
      messages,
      createdAt: Date.now(),
      domainContext: "The Eiffel Tower was constructed in 1887-1889 as the entrance to the 1889 World's Fair. It is named after engineer Gustave Eiffel.",
      referenceContext: "Model should mention 1889 World's Fair, Gustave Eiffel, and the initial criticism from artists."
    };
  }

  // 3. ANTHROPIC SAMPLE GENERATION
  if (config.provider === 'anthropic') {
    if (!config.anthropicKey) {
      throw new Error("Anthropic API Key is required to generate samples. Configure Anthropic in Settings or select Gemini.");
    }
    const endpoint = config.anthropicBaseUrl 
      ? `${config.anthropicBaseUrl.replace(/\/$/, '')}/messages` 
      : 'https://api.anthropic.com/v1/messages';

    const headers: Record<string, string> = {
      'content-type': 'application/json'
    };

    const isOpenAiProxy = config.anthropicBaseUrl && (config.anthropicBaseUrl.includes('openai') || config.anthropicBaseUrl.includes('openrouter'));

    if (isOpenAiProxy) {
      headers['Authorization'] = `Bearer ${config.anthropicKey}`;
    } else {
      headers['X-API-Key'] = config.anthropicKey;
      headers['anthropic-version'] = '2023-06-01';
    }

    let payload: any;
    if (isOpenAiProxy) {
      payload = {
        model: config.anthropicModel || 'claude-3-5-sonnet-20241022',
        messages: [
          { role: 'user', content: `${basePrompt}\n\nIMPORTANT: Return ONLY a raw JSON array matching: [{"role": "user"|"model", "content": "..."}]` }
        ],
        response_format: { type: "json_object" }
      };
    } else {
      payload = {
        model: config.anthropicModel || 'claude-3-5-sonnet-20241022',
        max_tokens: 2500,
        system: "You are a helpful JSON data generator. Always output valid JSON only.",
        messages: [
          { role: 'user', content: `${basePrompt}\n\nIMPORTANT: Return ONLY a raw JSON array. Do not put markdown blocks unless they contain exactly the JSON array.` }
        ]
      };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(`Claude status ${response.status}`);
    const data = await response.json();
    let text = "";
    if (data.content && Array.isArray(data.content)) {
      text = data.content[0]?.text;
    } else if (data.choices?.[0]?.message?.content) {
      text = data.choices[0].message.content;
    }

    if (!text) throw new Error("Empty generation response from Claude");

    const jsonMatch = text.match(/\[[\s\S]*\]/) || text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Could not parse JSON array from Claude response");

    let parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed) && parsed.messages) {
      parsed = parsed.messages;
    } else if (!Array.isArray(parsed) && typeof parsed === 'object') {
      const keys = Object.keys(parsed);
      if (keys.length === 1 && Array.isArray(parsed[keys[0]])) {
        parsed = parsed[keys[0]];
      }
    }

    if (!Array.isArray(parsed)) {
      throw new Error("Claude returned object instead of array.");
    }

    const messages = parsed.map((m: any, idx: number) => ({
      id: `msg-${Date.now()}-${idx}`,
      role: m.role === 'model' || m.role === 'assistant' || m.role === 'ai' ? Role.MODEL : Role.USER,
      content: m.content || "",
      comments: []
    }));

    return {
      id: `conv-${Date.now()}`,
      title: "Eiffel History (Claude-generated)",
      messages,
      createdAt: Date.now(),
      domainContext: "The Eiffel Tower was constructed in 1887-1889 as the entrance to the 1889 World's Fair. It is named after engineer Gustave Eiffel.",
      referenceContext: "Model should mention 1889 World's Fair, Gustave Eiffel, and the initial criticism from artists."
    };
  }

  throw new Error("Unsupported LLM provider.");
};
