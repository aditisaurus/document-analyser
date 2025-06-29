"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "./ui/dialog";
import { Button } from "./ui/button";

import Dropzone from "react-dropzone";
import { Cloud, File, Loader2 } from "lucide-react";
import { Progress } from "./ui/progress";
import { useUploadThing } from "@/lib/uploadthing";
import { useToast } from "./ui/use-toast";
import { trpc } from "@/app/_trpc/client";
import { useRouter } from "next/navigation";
import { DialogTitle } from "@radix-ui/react-dialog";

const UploadDropzone = ({ isSubscribed }: { isSubscribed: boolean }) => {
  const router = useRouter();

  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const { toast } = useToast();

  const { startUpload } = useUploadThing(
    isSubscribed ? "proPlanUploader" : "freePlanUploader"
  );

  const { mutate: startPolling } = trpc.getFile.useMutation({
    onSuccess: (file) => {
      console.log("File found successfully:", file);
      setIsUploading(false);
      router.push(`/dashboard/${file.id}`);
    },
    onError: (error) => {
      console.error("Error while polling for file upload status:", error);
      setIsUploading(false);
      toast({
        title: "Upload processing failed",
        description: `Error: ${error.message}. The file was uploaded but couldn't be processed.`,
        variant: "destructive",
      });
    },
    retry: (failureCount, error) => {
      console.log(`Retry attempt ${failureCount}, error:`, error);
      // Retry up to 10 times for NOT_FOUND errors (file might still be processing)
      if (error.data?.code === "NOT_FOUND" && failureCount < 10) {
        return true;
      }
      return false;
    },
    retryDelay: (attemptIndex) => {
      // Exponential backoff: 500ms, 1s, 2s, 4s, etc.
      return Math.min(1000 * 2 ** attemptIndex, 10000);
    },
  });

  const startSimulatedProgress = () => {
    setUploadProgress(0);

    const interval = setInterval(() => {
      setUploadProgress((prevProgress) => {
        if (prevProgress >= 95) {
          clearInterval(interval);
          return prevProgress;
        }
        return prevProgress + 5;
      });
    }, 500);

    return interval;
  };

  return (
    <Dropzone
      multiple={false}
      accept={{
        "application/pdf": [".pdf"],
      }}
      maxSize={isSubscribed ? 16 * 1024 * 1024 : 4 * 1024 * 1024}
      onDrop={async (acceptedFiles, rejectedFiles) => {
        console.log("=== UPLOAD STARTED ===");
        console.log("Accepted files:", acceptedFiles);
        console.log("Rejected files:", rejectedFiles);

        // Handle rejected files
        if (rejectedFiles.length > 0) {
          const rejection = rejectedFiles[0];
          let errorMessage = "File rejected";

          if (rejection.errors.some((e) => e.code === "file-too-large")) {
            errorMessage = `File is too large. Maximum size is ${
              isSubscribed ? "16MB" : "4MB"
            }.`;
          } else if (
            rejection.errors.some((e) => e.code === "file-invalid-type")
          ) {
            errorMessage = "Please select a PDF file.";
          }

          return toast({
            title: "Invalid file",
            description: errorMessage,
            variant: "destructive",
          });
        }

        if (acceptedFiles.length === 0) {
          console.log("No files accepted");
          return;
        }

        const file = acceptedFiles[0];
        console.log("Processing file:", {
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified,
        });

        setIsUploading(true);
        const progressInterval = startSimulatedProgress();

        try {
          console.log("=== STARTING UPLOADTHING UPLOAD ===");
          const res = await startUpload(acceptedFiles);
          console.log("UploadThing response:", res);

          if (!res || res.length === 0) {
            throw new Error("No response from UploadThing");
          }

          const [fileResponse] = res;
          console.log("File response details:", {
            key: fileResponse?.key,
            name: fileResponse?.name,
            size: fileResponse?.size,
            url: fileResponse?.url,
            customId: fileResponse?.customId,
            serverData: fileResponse?.serverData,
          });

          if (!fileResponse?.key) {
            throw new Error("No file key received from UploadThing");
          }

          clearInterval(progressInterval);
          setUploadProgress(100);

          console.log("=== STARTING TRPC POLLING ===");
          console.log("Polling for file with key:", fileResponse.key);

          // Add a small delay before polling to allow server processing
          setTimeout(() => {
            startPolling({ key: fileResponse.key });
          }, 1000);
        } catch (error) {
          console.error("=== UPLOAD ERROR ===", error);
          clearInterval(progressInterval);
          setIsUploading(false);

          let errorMessage = "An error occurred during upload.";
          if (error instanceof Error) {
            errorMessage = error.message;
          }

          toast({
            title: "Upload failed",
            description: errorMessage,
            variant: "destructive",
          });
        }
      }}
      onDropRejected={(rejectedFiles) => {
        console.log("Files rejected by dropzone:", rejectedFiles);
      }}
      onError={(error) => {
        console.error("Dropzone error:", error);
        toast({
          title: "File picker error",
          description: "An error occurred with the file picker.",
          variant: "destructive",
        });
      }}
    >
      {({
        getRootProps,
        getInputProps,
        acceptedFiles,
        isDragActive,
        fileRejections,
      }) => (
        <div
          {...getRootProps()}
          className="border h-64 m-4 border-dashed border-gray-300 rounded-lg"
        >
          <div className="flex items-center justify-center h-full w-full">
            <label
              htmlFor="dropzone-file"
              className="flex flex-col items-center justify-center w-full h-full rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100"
            >
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <Cloud className="h-6 w-6 text-zinc-500 mb-2" />
                <p className="mb-2 text-sm text-zinc-700">
                  {isDragActive ? (
                    <span className="font-semibold">Drop the file here</span>
                  ) : (
                    <>
                      <span className="font-semibold">Click to upload</span> or
                      drag and drop
                    </>
                  )}
                </p>
                <p className="text-xs text-zinc-500">
                  PDF (up to {isSubscribed ? "16" : "4"}MB)
                </p>
              </div>

              {acceptedFiles && acceptedFiles[0] && !isUploading ? (
                <div className="max-w-xs bg-white flex items-center rounded-md overflow-hidden outline outline-[1px] outline-zinc-200 divide-x divide-zinc-200">
                  <div className="px-3 py-2 h-full grid place-items-center">
                    <File className="h-4 w-4 text-blue-500" />
                  </div>
                  <div className="px-3 py-2 h-full text-sm truncate">
                    {acceptedFiles[0].name}
                  </div>
                </div>
              ) : null}

              {fileRejections && fileRejections.length > 0 && (
                <div className="mt-2 text-sm text-red-600">
                  File rejected: {fileRejections[0].errors[0].message}
                </div>
              )}

              {isUploading ? (
                <div className="w-full mt-4 max-w-xs mx-auto">
                  <Progress
                    indicatorColor={
                      uploadProgress === 100 ? "bg-green-500" : ""
                    }
                    value={uploadProgress}
                    className="h-1 w-full bg-zinc-200"
                  />

                  <div className="flex gap-1 items-center justify-center text-sm text-zinc-700 text-center pt-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {uploadProgress < 100 ? "Uploading..." : "Processing..."}
                  </div>
                </div>
              ) : null}

              <input
                {...getInputProps()}
                type="file"
                id="dropzone-file"
                className="hidden"
              />
            </label>
          </div>
        </div>
      )}
    </Dropzone>
  );
};

const UploadButton = ({ isSubscribed }: { isSubscribed: boolean }) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(v) => {
        if (!v) {
          setIsOpen(v);
        }
      }}
    >
      <DialogTrigger onClick={() => setIsOpen(true)} asChild>
        <Button>Upload PDF</Button>
      </DialogTrigger>

      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          Upload your PDF file
        </DialogTitle>
        <UploadDropzone isSubscribed={isSubscribed} />
      </DialogContent>
    </Dialog>
  );
};

export default UploadButton;