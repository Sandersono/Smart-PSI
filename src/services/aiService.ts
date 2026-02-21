import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function processAudioToNote(audioBase64: string, mimeType: string) {
  const model = "gemini-2.5-flash"; // Using 2.5 flash for audio support as per guidelines

  const prompt = `
    Você é um assistente especializado em transcrição e síntese de sessões de psicoterapia.
    Analise o áudio da sessão e gere uma nota clínica estruturada com os seguintes campos:
    1. Queixa: O que o paciente trouxe como demanda principal.
    2. Intervenção: O que o terapeuta fez ou pontuou.
    3. Próximo Foco: O que deve ser trabalhado na próxima sessão.

    Se não conseguir identificar algum campo, escreva "Não identificado — revisar".
    Responda estritamente em formato JSON.
  `;

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: mimeType,
                data: audioBase64,
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            complaint: { type: Type.STRING },
            intervention: { type: Type.STRING },
            next_focus: { type: Type.STRING },
          },
          required: ["complaint", "intervention", "next_focus"],
        },
      },
    });

    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("AI Processing Error:", error);
    throw error;
  }
}
