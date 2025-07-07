import { ReactNode, createContext, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { trpc } from "@/app/_trpc/client";
import { INFINITE_QUERY_LIMIT } from "@/config/infinite-query";
import toast from "react-hot-toast";

type StreamResponse = {
  addMessage: () => void;
  message: string;
  handleInputChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  isLoading: boolean;
};

export const ChatContext = createContext<StreamResponse>({
  addMessage: () => {},
  message: "",
  handleInputChange: () => {},
  isLoading: false,
});

interface Props {
  fileId: string;
  children: ReactNode;
}

export const ChatContextProvider = ({ fileId, children }: Props) => {
  const [message, setMessage] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const utils = trpc.useContext();
  const backupMessage = useRef("");

  console.log("📂 ChatContextProvider initialized for fileId:", fileId);

  const { mutate: sendMessage } = useMutation({
    mutationFn: async ({ message }: { message: string }) => {
      console.log("📤 Sending message:", message);

      const response = await fetch("/api/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileId,
          message,
        }),
      });

      console.log("📡 Response status:", response);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ Response error:", errorText);
        throw new Error(
          `Failed to send message: ${response.status} ${response.statusText}`
        );
      }

      return response.body;
    },
    onMutate: async ({ message }) => {
      console.log("🚀 Mutation started for message:", message);

      backupMessage.current = message;
      setMessage("");

      // Cancel any outgoing requests
      await utils.getFileMessages.cancel();

      // Get the current messages
      const previousMessages = utils.getFileMessages.getInfiniteData();

      // Optimistically update the cache
      utils.getFileMessages.setInfiniteData(
        { fileId, limit: INFINITE_QUERY_LIMIT },
        (old) => {
          if (!old) {
            return {
              pages: [
                {
                  messages: [
                    {
                      createdAt: new Date().toISOString(),
                      id: crypto.randomUUID(),
                      text: message,
                      isUserMessage: true,
                    },
                  ],
                  nextCursor: undefined,
                },
              ],
              pageParams: [undefined],
            };
          }

          let newPages = [...old.pages];
          let latestPage = newPages[0];

          if (latestPage) {
            latestPage.messages = [
              {
                createdAt: new Date().toISOString(),
                id: crypto.randomUUID(),
                text: message,
                isUserMessage: true,
              },
              ...latestPage.messages,
            ];
          } else {
            // If no pages exist, create the first page
            newPages[0] = {
              messages: [
                {
                  createdAt: new Date().toISOString(),
                  id: crypto.randomUUID(),
                  text: message,
                  isUserMessage: true,
                },
              ],
              nextCursor: undefined,
            };
          }

          return {
            ...old,
            pages: newPages,
          };
        }
      );

      setIsLoading(true);

      return {
        previousMessages:
          previousMessages?.pages.flatMap((page) => page.messages) ?? [],
      };
    },
    onSuccess: async (stream) => {
      console.log("✅ Message sent successfully, processing stream...");
      setIsLoading(false);

      if (!stream) {
        console.error("❌ No stream received");
        return toast.error(
          "There was a problem sending this message. Please refresh this page and try again."
        );
      }

      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let accResponse = "";

      try {
        while (!done) {
          const { value, done: doneReading } = await reader.read();
          done = doneReading;

          if (value) {
            const chunkValue = decoder.decode(value);
            accResponse += chunkValue;

            // Update the AI response in real-time
            utils.getFileMessages.setInfiniteData(
              { fileId, limit: INFINITE_QUERY_LIMIT },
              (old) => {
                if (!old) return { pages: [], pageParams: [] };

                let isAiResponseCreated = old.pages.some((page) =>
                  page.messages.some((message) => message.id === "ai-response")
                );

                let updatedPages = old.pages.map((page) => {
                  if (page === old.pages[0]) {
                    let updatedMessages;

                    if (!isAiResponseCreated) {
                      updatedMessages = [
                        {
                          createdAt: new Date().toISOString(),
                          id: "ai-response",
                          text: accResponse,
                          isUserMessage: false,
                        },
                        ...page.messages,
                      ];
                    } else {
                      updatedMessages = page.messages.map((message) => {
                        if (message.id === "ai-response") {
                          return {
                            ...message,
                            text: accResponse,
                          };
                        }
                        return message;
                      });
                    }

                    return {
                      ...page,
                      messages: updatedMessages,
                    };
                  }

                  return page;
                });

                return { ...old, pages: updatedPages };
              }
            );
          }
        }

        console.log("✅ Stream processing completed");
      } catch (streamError) {
        console.error("❌ Error processing stream:", streamError);
        toast.error("Error processing response. Please try again.");
      }
    },
    onError: (error, variables, context) => {
      console.error("❌ Mutation error:", error);

      setMessage(backupMessage.current);
      setIsLoading(false);

      // Restore previous messages
      if (context?.previousMessages) {
        utils.getFileMessages.setInfiniteData(
          { fileId, limit: INFINITE_QUERY_LIMIT },
          (old) => {
            if (!old) {
              return {
                pages: [
                  {
                    messages: context.previousMessages,
                    nextCursor: undefined,
                  },
                ],
                pageParams: [undefined],
              };
            }

            return {
              ...old,
              pages: old.pages.map((page, index) => {
                if (index === 0) {
                  return {
                    ...page,
                    messages: context.previousMessages,
                  };
                }
                return page;
              }),
            };
          }
        );
      }

      toast.error("Something went wrong. Please try again.");
    },
    onSettled: async () => {
      console.log("🔄 Mutation settled, refreshing data...");
      setIsLoading(false);
      await utils.getFileMessages.invalidate({ fileId });
    },
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
  };

  const addMessage = () => {
    if (!message.trim()) {
      toast.error("Please enter a message");
      return;
    }

    if (isLoading) {
      toast.error("Please wait for the current message to complete");
      return;
    }

    console.log("💬 Adding message:", message);
    sendMessage({ message });
  };

  return (
    <ChatContext.Provider
      value={{
        addMessage,
        message,
        handleInputChange,
        isLoading,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};