import { Pinecone } from "@pinecone-database/pinecone";

export const getPineconeClient = async () => {
  return new Pinecone({
    apiKey: process.env.PINECONE_API_KEY!,
  });
};
