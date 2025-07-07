// /app/api/debug/pinecone/route.ts

import { getPineconeClient } from "@/lib/pinecone";

export async function GET() {
  try {
    console.log("Testing Pinecone connection...");
    console.log("API Key exists:", !!process.env.PINECONE_API_KEY);

    const pinecone = await getPineconeClient();
    console.log("Pinecone client created");

    const index = pinecone.Index("quill");
    console.log("Index retrieved");

    const stats = await index.describeIndexStats();
    console.log("Stats retrieved:", stats);

    return Response.json({
      success: true,
      stats,
      message: "Pinecone connected successfully",
    });
  } catch (error) {
    console.error("Pinecone test failed:", error);
    return Response.json(
      {
        success: false,
        error: error.message,
        stack: error.stack,
      },
      { status: 500 }
    );
  }
}
