import { GoogleGenerativeAI } from "@google/generative-ai";
import type { IAiSummarizer } from "./interfaces.js";

export class GeminiSummarizer implements IAiSummarizer {
  private readonly client: GoogleGenerativeAI;
  private readonly model = "gemini-2.5-flash";
  private readonly maxOutputTokens = 1024;

  public constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    this.client = new GoogleGenerativeAI(apiKey);
  }

  public async summarizeVietnamese(input: string): Promise<string> {
    const cleaned = input.replace(/\s+/g, " ").trim();
    if (!cleaned) {
      return "";
    }

    // eslint-disable-next-line no-console
    console.log(`[gemini] summarizeVietnamese start model=${this.model} input_len=${cleaned.length}`);
    // Note: avoid logging full content for large inputs

    try {
      const model = this.client.getGenerativeModel({
        model: this.model
      });

      const prompt = `You are an expert summarizer. Please provide a concise and clear summary of the following Vietnamese workshop description in English. 
Keep the summary to 2-3 paragraphs maximum.

Content to summarize:
${cleaned}

Provide only the summary without any additional explanation.`;

      // eslint-disable-next-line no-console
      console.log(`[gemini] generateContent request model=${this.model} maxOutputTokens=${this.maxOutputTokens}`);
      const response = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          maxOutputTokens: this.maxOutputTokens,
          temperature: 0.7
        }
      });

      const summary = response.response.text();
      // eslint-disable-next-line no-console
      console.log(`[gemini] generateContent finished length=${summary?.length ?? 0}`);
      if (!summary || summary.trim().length === 0) {
        throw new Error("Empty response from Gemini API");
      }

      return summary.trim();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      // eslint-disable-next-line no-console
      console.error(`[gemini] summarizeVietnamese error model=${this.model} reason=${message}`);
      // Re-throw with context for retry logic in service layer
      throw new Error(`Gemini API error: ${message}`);
    }
  }

  public async summarizeFromPdf(pdfBytes: Buffer): Promise<string> {
    if (!pdfBytes || pdfBytes.length === 0) {
      return "";
    }
    // Convert to base64 and send as part of the prompt. Note: large PDFs may exceed model input limits.
    // eslint-disable-next-line no-console
    console.log(`[gemini] summarizeFromPdf start model=${this.model} pdf_bytes=${pdfBytes.length}`);
    const prompt = `You are an Expert Educational Content Analyst. Your task is to analyze the provided workshop document and generate a professional summary.

Please follow these instructions strictly:
1. Language: English.
2. Tone: Professional, engaging, and concise.
3. Content: The summary must cover:
   - Main Topic: What is the workshop about?
   - Target Audience: Who should attend this workshop?
   - Key Highlights: List 3-4 most valuable takeaways or activities.
4. Constraints:
   - Length: Between 100 - 150 words.
   - Do not mention page numbers or administrative details unless relevant to the content.
   - If the document is not a workshop proposal, reply with: "Error: Invalid document."`;
    try {
      const model = this.client.getGenerativeModel({ model: this.model });

      // eslint-disable-next-line no-console
      console.log(`[gemini] generateContent request (pdf) model=${this.model} maxOutputTokens=${this.maxOutputTokens}`);
      const response = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt }, 
              {
                inlineData: {  
                  data: pdfBytes.toString("base64"),
                  mimeType: "application/pdf"
                }
              }
            ]
          }
        ],
        generationConfig: {
          maxOutputTokens: this.maxOutputTokens,
          temperature: 0.7
        }
      });

      const summary = response.response.text();
      // eslint-disable-next-line no-console
      console.log(`[gemini] generateContent finished (pdf) length=${summary?.length ?? 0}`);
      if (!summary || summary.trim().length === 0) {
        throw new Error("Empty response from Gemini API");
      }
      return summary.trim();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      // eslint-disable-next-line no-console
      console.error(`[gemini] summarizeFromPdf error model=${this.model} reason=${message}`);
      throw new Error(`Gemini API error: ${message}`);
    }
  }
}
