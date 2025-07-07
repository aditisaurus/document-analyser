// Temporary test version - /app/api/message/route.ts

import { db } from "@/db";
import { getPineconeClient } from "@/lib/pinecone";
import { SendMessageValidator } from "@/lib/validators/SendMessageValidator";
import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import { PineconeStore } from "langchain/vectorstores/pinecone";
import { NextRequest } from "next/server";
import { CustomOpenAIEmbeddings } from "@/lib/custom-embeddings";

export const POST = async (req: NextRequest) => {
  try {
    console.log("🚀 Message API called");

    const body = await req.json();
    console.log("📦 Request body received");

    const { getUser } = getKindeServerSession();
    const user = getUser();

    if (!user || !user.id) {
      console.log("❌ User not authenticated");
      return new Response("Unauthorized", { status: 401 });
    }

    console.log("✅ User authenticated:", user.id);

    const { fileId, message } = SendMessageValidator.parse(body);
    console.log("📁 File ID:", fileId);
    console.log("💬 Message:", message);

    const file = await db.file.findFirst({
      where: {
        id: fileId,
        userId: user.id,
      },
    });

    if (!file) {
      console.log("❌ File not found");
      return new Response("File not found", { status: 404 });
    }

    console.log("📄 File found:", file.name, "Status:", file.uploadStatus);

    // Save user message
    await db.message.create({
      data: {
        text: message,
        isUserMessage: true,
        userId: user.id,
        fileId,
      },
    });

    console.log("✅ User message saved");

    // Check if file is ready for chat
    if (file.uploadStatus !== "SUCCESS") {
      console.log("⚠️ File not ready for chat");

      const response =
        "I can see you've uploaded a PDF, but it's still being processed. Please wait a moment and try again.";

      await db.message.create({
        data: {
          text: response,
          isUserMessage: false,
          fileId,
          userId: user.id,
        },
      });

      return new Response(response, {
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Test vectorization search (without OpenAI chat)
    console.log("🔍 Testing vector search...");

    try {
      const embeddings = new CustomOpenAIEmbeddings({
        openAIApiKey: process.env.OPENAI_API_KEY!,
        modelName: "text-embedding-3-small",
        dimensions: 1024,
      });

      const pinecone = await getPineconeClient();
      const pineconeIndex = pinecone.Index("quill");

      const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
        pineconeIndex,
        namespace: file.id,
      });

      const results = await vectorStore.similaritySearch(message, 2);
      console.log("📊 Found", results.length, "relevant chunks");

      // Create a simple response based on the search results
      let response = `I found ${results.length} relevant sections in your PDF "${file.name}" related to "${message}". `;

      if (results.length > 0) {
        response += `Here's what I found:\n\n`;
        results.forEach((result, index) => {
          response += `**Section ${
            index + 1
          }:**\n${result.pageContent.substring(0, 200)}...\n\n`;
        });
      } else {
        response +=
          "I couldn't find specific content related to your question.";
      }

      response +=
        "\n\n*Note: Full AI responses are temporarily unavailable due to OpenAI quota limits.*";

      await db.message.create({
        data: {
          text: response,
          isUserMessage: false,
          fileId,
          userId: user.id,
        },
      });

      return new Response(response, {
        headers: { "Content-Type": "text/plain" },
      });
    } catch (vectorError) {
      console.error("❌ Vector search failed:", vectorError);

      const response = `I can see your PDF "${file.name}" but I'm having trouble searching through it right now. The error was: ${vectorError.message}`;

      await db.message.create({
        data: {
          text: response,
          isUserMessage: false,
          fileId,
          userId: user.id,
        },
      });

      return new Response(response, {
        headers: { "Content-Type": "text/plain" },
      });
    }
  } catch (error) {
    console.error("💥 Error in message API:", error);

    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};
