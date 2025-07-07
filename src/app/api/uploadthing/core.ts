import { db } from "@/db";
import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import { createUploadthing, type FileRouter } from "uploadthing/next";

import { PDFLoader } from "langchain/document_loaders/fs/pdf";
import { PineconeStore } from "langchain/vectorstores/pinecone";
import { getPineconeClient } from "@/lib/pinecone";
import { CustomOpenAIEmbeddings } from "@/lib/custom-embeddings";

const f = createUploadthing();

const middleware = async () => {
  const { getUser } = getKindeServerSession();
  const user = getUser();

  if (!user || !user.id) throw new Error("Unauthorized");

  return { userId: user.id };
};

const onUploadComplete = async ({
  metadata,
  file,
}: {
  metadata: Awaited<ReturnType<typeof middleware>>;
  file: {
    key: string;
    name: string;
    url: string;
  };
}) => {
  console.log("🚀 Upload complete callback started");
  console.log("📁 File details:", file);
  console.log("👤 User ID:", metadata.userId);

  let createdFile: any = null; // Declare outside try block

  try {
    const isFileExist = await db.file.findFirst({
      where: {
        key: file.key,
      },
    });

    if (isFileExist) {
      console.log("⚠️ File already exists");
      return;
    }

    console.log("💾 Creating database record...");
    createdFile = await db.file.create({
      data: {
        key: file.key,
        name: file.name,
        userId: metadata.userId,
        url: file.url,
        uploadStatus: "PROCESSING",
      },
    });

    console.log("✅ Created file record:", createdFile.id);

    // Step 1: Validate environment variables
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    if (!process.env.PINECONE_API_KEY) {
      throw new Error("PINECONE_API_KEY is not configured");
    }

    console.log("✅ Environment variables validated");

    // Step 2: Fetch and load PDF
    console.log("📄 Fetching PDF from:", file.url);
    const response = await fetch(file.url);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch file: ${response.status} ${response.statusText}`
      );
    }

    const blob = await response.blob();
    console.log("✅ File downloaded, size:", blob.size, "bytes");

    // Step 3: Parse PDF
    console.log("📖 Loading PDF with LangChain...");
    const loader = new PDFLoader(blob);
    const pageLevelDocs = await loader.load();
    const pagesAmt = pageLevelDocs.length;

    console.log("✅ PDF loaded successfully, pages:", pagesAmt);
    console.log(
      "📄 Sample content:",
      pageLevelDocs[0]?.pageContent?.substring(0, 100) + "..."
    );

    // Step 4: Initialize embeddings with CustomOpenAIEmbeddings
    console.log("🧠 Initializing OpenAI embeddings...");
    const embeddings = new CustomOpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
      modelName: "text-embedding-3-small",
      dimensions: 1024, // Match your Pinecone index
    });

    // Step 5: Initialize Pinecone
    console.log("📌 Initializing Pinecone...");
    const pinecone = await getPineconeClient();

    const indexName = "quill";
    console.log("🔍 Using Pinecone index:", indexName);

    const pineconeIndex = pinecone.Index(indexName);

    // Step 6: Test Pinecone connection
    try {
      const indexStats = await pineconeIndex.describeIndexStats();
      console.log(
        "✅ Pinecone connection successful, index stats:",
        indexStats
      );
    } catch (pineconeError) {
      console.error("❌ Pinecone connection failed:", pineconeError);
      throw new Error(`Pinecone connection failed: ${pineconeError.message}`);
    }

    // Step 7: Vectorize and store
    console.log("🧮 Starting vectorization process...");
    console.log("📊 Processing", pageLevelDocs.length, "document chunks");

    await PineconeStore.fromDocuments(pageLevelDocs, embeddings, {
      pineconeIndex,
      namespace: createdFile.id,
      textKey: "text",
    });

    console.log("✅ Vectorization completed successfully");

    // Step 8: Mark as successful
    await db.file.update({
      data: {
        uploadStatus: "SUCCESS",
      },
      where: {
        id: createdFile.id,
      },
    });

    console.log(
      "🎉 File processing completed successfully with full vectorization"
    );
  } catch (error) {
    console.error("❌ Error during file processing:", error);
    console.error("Error details:", {
      name: error.name,
      message: error.message,
      stack: error.stack,
    });

    // Update file status to failed (only if createdFile exists)
    if (createdFile) {
      await db.file.update({
        data: {
          uploadStatus: "FAILED",
        },
        where: {
          id: createdFile.id,
        },
      });
    }
  }
};

export const ourFileRouter = {
  freePlanUploader: f({ pdf: { maxFileSize: "4MB" } })
    .middleware(middleware)
    .onUploadComplete(onUploadComplete),
  proPlanUploader: f({ pdf: { maxFileSize: "16MB" } })
    .middleware(middleware)
    .onUploadComplete(onUploadComplete),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;