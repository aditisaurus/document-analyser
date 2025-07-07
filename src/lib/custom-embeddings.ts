import { OpenAI } from "openai";
import { Embeddings } from "langchain/embeddings/base";

export class CustomOpenAIEmbeddings extends Embeddings {
  private openai: OpenAI;
  private modelName: string;
  private dimensions: number;

  constructor(config: {
    openAIApiKey: string;
    modelName?: string;
    dimensions?: number;
  }) {
    super({});
    this.openai = new OpenAI({
      apiKey: config.openAIApiKey,
    });
    this.modelName = config.modelName || "text-embedding-3-small";
    this.dimensions = config.dimensions || 1024;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const response = await this.openai.embeddings.create({
      model: this.modelName,
      input: texts,
      dimensions: this.dimensions,
    });

    return response.data.map((embedding) => embedding.embedding);
  }

  async embedQuery(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: this.modelName,
      input: text,
      dimensions: this.dimensions,
    });

    return response.data[0].embedding;
  }
}
