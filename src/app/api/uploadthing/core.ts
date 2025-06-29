import { db } from "@/db";
import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import { createUploadthing, type FileRouter } from "uploadthing/next";

import { PDFLoader } from "langchain/document_loaders/fs/pdf";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { PineconeStore } from "langchain/vectorstores/pinecone";
import { getPineconeClient } from "@/lib/pinecone";
import { getUserSubscriptionPlan } from "@/lib/stripe";
import { PLANS } from "@/config/stripe";

const f = createUploadthing();

const middleware = async () => {
  const { getUser } = getKindeServerSession();
  const user = getUser();

  if (!user || !user.id) throw new Error("Unauthorized");

  const subscriptionPlan = await getUserSubscriptionPlan();

  return { userId: user.id, subscriptionPlan };
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
  console.log("=== UPLOAD COMPLETE CALLBACK STARTED ===");
  console.log("File details:", file);
  console.log("Metadata:", metadata);

  const isFileExist = await db.file.findFirst({
    where: {
      key: file.key,
    },
  });

  if (isFileExist) {
    console.log("File already exists in database");
    return;
  }

  // CREATE THE DATABASE RECORD
  const createdFile = await db.file.create({
    data: {
      key: file.key,
      name: file.name,
      userId: metadata.userId,
      url: file.url,
      uploadStatus: "PROCESSING",
    },
  });

  console.log("Created file record:", createdFile);

  try {
    console.log("Starting PDF processing...");

    // Try multiple approaches to fetch the file
    let blob: Blob;

    try {
      // First try: Direct fetch with proper headers
      const response = await fetch(file.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; PDF-Processor/1.0)",
          Accept: "application/pdf,*/*",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      blob = await response.blob();
      console.log("File downloaded successfully, size:", blob.size);
    } catch (fetchError) {
      console.error("Direct fetch failed:", fetchError);

      // Fallback: Try constructing the S3 URL manually (sometimes UploadThing URLs have issues)
      const s3Url = `https://uploadthing-prod.s3.us-west-2.amazonaws.com/${file.key}`;
      console.log("Trying S3 URL:", s3Url);

      const s3Response = await fetch(s3Url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; PDF-Processor/1.0)",
          Accept: "application/pdf,*/*",
        },
      });

      if (!s3Response.ok) {
        throw new Error(
          `S3 fetch failed: ${s3Response.status} ${s3Response.statusText}`
        );
      }

      blob = await s3Response.blob();
      console.log("File downloaded from S3, size:", blob.size);
    }

    // Validate that we got a PDF
    if (
      !blob.type.includes("pdf") &&
      blob.type !== "application/octet-stream"
    ) {
      console.warn("File type is not PDF:", blob.type);
    }

    const loader = new PDFLoader(blob);
    const pageLevelDocs = await loader.load();
    const pagesAmt = pageLevelDocs.length;

    console.log("PDF loaded successfully, pages:", pagesAmt);

    const { subscriptionPlan } = metadata;
    const { isSubscribed } = subscriptionPlan;

    const isProExceeded =
      pagesAmt > PLANS.find((plan) => plan.name === "Pro")!.pagesPerPdf;
    const isFreeExceeded =
      pagesAmt > PLANS.find((plan) => plan.name === "Free")!.pagesPerPdf;

    if ((isSubscribed && isProExceeded) || (!isSubscribed && isFreeExceeded)) {
      console.log(
        `Page limit exceeded: ${pagesAmt} pages, isSubscribed: ${isSubscribed}`
      );

      await db.file.update({
        data: {
          uploadStatus: "FAILED",
        },
        where: {
          id: createdFile.id,
        },
      });

      // Don't throw an error here, just return - the client will handle the FAILED status
      return { fileId: createdFile.id, error: "PAGE_LIMIT_EXCEEDED" };
    }

    console.log("Page limit check passed, starting vectorization...");

    // vectorize and index entire document
    const pinecone = await getPineconeClient();
    const pineconeIndex = pinecone.Index("document-analyser");

    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    await PineconeStore.fromDocuments(pageLevelDocs, embeddings, {
      pineconeIndex,
      namespace: createdFile.id,
    });

    console.log("Vectorization complete, updating status to SUCCESS");

    await db.file.update({
      data: {
        uploadStatus: "SUCCESS",
      },
      where: {
        id: createdFile.id,
      },
    });

    console.log("=== UPLOAD COMPLETE CALLBACK FINISHED SUCCESSFULLY ===");
  } catch (err) {
    console.error("=== ERROR IN UPLOAD COMPLETE CALLBACK ===", err);

    // More detailed error logging
    if (err instanceof Error) {
      console.error("Error name:", err.name);
      console.error("Error message:", err.message);
      console.error("Error stack:", err.stack);
    }

    await db.file.update({
      data: {
        uploadStatus: "FAILED",
      },
      where: {
        id: createdFile.id,
      },
    });
  }

  return { fileId: createdFile.id };
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