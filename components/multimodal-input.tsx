'use client';

import type {
  Attachment,
  ChatRequestOptions,
  CreateMessage,
  Message,
} from 'ai';
import cx from 'classnames';
import type React from 'react';
import {
  useRef,
  useEffect,
  useState,
  useCallback,
  type Dispatch,
  type SetStateAction,
  type ChangeEvent,
  memo,
} from 'react';
import { toast } from 'sonner';
import { useLocalStorage, useWindowSize } from 'usehooks-ts';

import { sanitizeUIMessages } from '@/lib/utils';

import { ArrowUpIcon, PaperclipIcon, StopIcon } from './icons';
import { PreviewAttachment } from './preview-attachment';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { SuggestedActions } from './suggested-actions';
import equal from 'fast-deep-equal';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';

/**
 * We'll keep existing constants for attachments logic and other UI features,
 * but remove the old fallback to /api/whisper, replacing it with real-time streaming to Deepgram.
 */

/** Check if the browser supports Web Speech Recognition. */
function canUseWebSpeech(): boolean {
  return (
    typeof window !== 'undefined' &&
    ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  );
}

/**
 * This is your main "MultimodalInput" that:
 * - Uses Web Speech API if supported
 * - Else, uses a streaming approach to Deepgram over WebSocket
 */
function PureMultimodalInput({
  chatId,
  input,
  setInput,
  isLoading,
  stop,
  attachments,
  setAttachments,
  messages,
  setMessages,
  append,
  handleSubmit,
  className,
}: {
  chatId: string;
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  stop: () => void;
  attachments: Array<Attachment>;
  setAttachments: Dispatch<SetStateAction<Array<Attachment>>>;
  messages: Array<Message>;
  setMessages: Dispatch<SetStateAction<Array<Message>>>;
  append: (
    message: Message | CreateMessage,
    chatRequestOptions?: ChatRequestOptions,
  ) => Promise<string | null | undefined>;
  handleSubmit: (
    event?: {
      preventDefault?: () => void;
    },
    chatRequestOptions?: ChatRequestOptions,
  ) => void;
  className?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { width } = useWindowSize();

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, []);

  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight + 2}px`;
    }
  };

  const resetHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = '98px';
    }
  };

  const [localStorageInput, setLocalStorageInput] = useLocalStorage('input', '');

  useEffect(() => {
    if (textareaRef.current) {
      const domValue = textareaRef.current.value;
      const finalValue = domValue || localStorageInput || '';
      setInput(finalValue);
      adjustHeight();
    }
    // Only run once after hydration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLocalStorageInput(input);
  }, [input, setLocalStorageInput]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
    adjustHeight();
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadQueue, setUploadQueue] = useState<Array<string>>([]);

  /**
   * Handle normal text submission
   */
  const submitForm = useCallback(() => {
    window.history.replaceState({}, '', `/chat/${chatId}`);

    handleSubmit(undefined, {
      experimental_attachments: attachments,
    });

    setAttachments([]);
    setLocalStorageInput('');
    resetHeight();

    if (width && width > 768) {
      textareaRef.current?.focus();
    }
  }, [
    attachments,
    handleSubmit,
    setAttachments,
    setLocalStorageInput,
    width,
    chatId,
  ]);

  const uploadFile = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        const { url, pathname, contentType } = data;

        return {
          url,
          name: pathname,
          contentType: contentType,
        };
      }
      const { error } = await response.json();
      toast.error(error);
    } catch (error) {
      toast.error('Failed to upload file, please try again!');
    }
  };

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      setUploadQueue(files.map((file) => file.name));

      try {
        const uploadPromises = files.map((file) => uploadFile(file));
        const uploadedAttachments = await Promise.all(uploadPromises);
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          (attachment) => attachment !== undefined,
        );

        setAttachments((currentAttachments) => [
          ...currentAttachments,
          ...successfullyUploadedAttachments,
        ]);
      } catch (error) {
        console.error('Error uploading files!', error);
      } finally {
        setUploadQueue([]);
      }
    },
    [setAttachments],
  );

  // === Hybrid speech logic ===
  const [isRecording, setIsRecording] = useState(false);

  // For Web Speech
  const recognitionRef = useRef<any>(null);

  // For Deepgram streaming fallback
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const deepgramSocketRef = useRef<WebSocket | null>(null);

  const webSpeechSupported = canUseWebSpeech();

  /**
   * Start or stop recording
   */
  const handleRecordClick = async () => {
    try {
      if (!isRecording) {
        // START recording
        if (webSpeechSupported) {
          // 1) Use Web Speech
          const SpeechRecognition =
            (window as any).SpeechRecognition ||
            (window as any).webkitSpeechRecognition;
          const recognition = new SpeechRecognition();
          recognitionRef.current = recognition;

          recognition.interimResults = true;
          // Optionally set language from navigator:
          recognition.lang = 'en-US'; // or navigator.language
          let finalTranscript = '';

          recognition.onstart = () => {
            setIsRecording(true);
          };

          recognition.onresult = (event: any) => {
            let combined = '';
            for (let i = 0; i < event.results.length; i++) {
              combined += event.results[i][0].transcript;
            }
            finalTranscript = combined;
            // Show partial transcripts directly:
            setInput(combined);
          };

          recognition.onerror = (err: any) => {
            console.error('Web Speech error:', err);
            toast.error('Speech recognition error');
          };

          recognition.onend = () => {
            setIsRecording(false);
            // finalize if needed
            if (!finalTranscript.trim()) {
              toast.error('No meaningful speech detected.');
            } else {
              setInput(finalTranscript.trim());
            }
          };

          recognition.start();
        } else {
          // 2) Fallback: Deepgram WebSocket streaming
          const DG_KEY = process.env.DEEPGRAM_API_KEY; // Replace or secure properly
          if (!DG_KEY) {
            throw new Error('Deepgram API key is not defined');
          }
          const socketUrl = `wss://api.deepgram.com/v1/listen?encoding=opus`;
          const dgSocket = new WebSocket(socketUrl, ['token', DG_KEY]);
          deepgramSocketRef.current = dgSocket;

          // Attempt mic
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

          dgSocket.onopen = () => {
            console.log('Deepgram socket open');
            setIsRecording(true);
            // Clear input so user sees fresh transcript
            setInput('');
          };

          dgSocket.onerror = (err) => {
            console.error('Deepgram socket error:', err);
            toast.error('Deepgram error');
          };

          dgSocket.onclose = () => {
            console.log('Deepgram socket closed');
            setIsRecording(false);
          };

          // Handle incoming transcripts from Deepgram
          dgSocket.onmessage = (message) => {
            const data = JSON.parse(message.data);
            /**
             * Deepgram typically returns something like:
             * data.channel.alternatives[0].transcript
             * if data.is_final is true => final chunk
             */
            if (data.channel) {
              const alt = data.channel.alternatives[0];
              if (alt && alt.transcript) {
                // We'll treat partial as live transcript
                setInput(alt.transcript);
              }
            }
          };

          // Setup MediaRecorder in ~250ms chunks
          const options: MediaRecorderOptions = {
            mimeType: 'audio/webm; codecs=opus',
            audioBitsPerSecond: 128000,
          };
          const mediaRecorder = new MediaRecorder(stream, options);
          mediaRecorderRef.current = mediaRecorder;

          // On each chunk, send to Deepgram
          mediaRecorder.ondataavailable = (evt) => {
            if (evt.data.size > 0 && dgSocket.readyState === WebSocket.OPEN) {
              dgSocket.send(evt.data);
            }
          };

          // Fire dataavailable ~250ms
          mediaRecorder.start(250);
        }
      } else {
        // STOP recording
        if (webSpeechSupported) {
          // Stop Web Speech
          const recognition = recognitionRef.current;
          if (recognition) {
            recognition.stop();
          }
        } else {
          // Close MediaRecorder & Deepgram socket
          const mediaRecorder = mediaRecorderRef.current;
          if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            mediaRecorder.stream.getTracks().forEach((track) => track.stop());
          }

          const dgSocket = deepgramSocketRef.current;
          if (dgSocket && dgSocket.readyState === WebSocket.OPEN) {
            dgSocket.close();
          }
          setIsRecording(false);
        }
      }
    } catch (err) {
      console.error('Mic or STT error:', err);
      toast.error('Cannot access microphone or speech API!');
    }
  };

  return (
    <div className="relative w-full flex flex-col gap-4">
      {messages.length === 0 &&
        attachments.length === 0 &&
        uploadQueue.length === 0 && (
          <SuggestedActions append={append} chatId={chatId} />
        )}

      <input
        type="file"
        className="fixed -top-4 -left-4 size-0.5 opacity-0 pointer-events-none"
        ref={fileInputRef}
        multiple
        onChange={handleFileChange}
        tabIndex={-1}
      />

      {(attachments.length > 0 || uploadQueue.length > 0) && (
        <div className="flex flex-row gap-2 overflow-x-scroll items-end">
          {attachments.map((attachment) => (
            <PreviewAttachment key={attachment.url} attachment={attachment} />
          ))}
          {uploadQueue.map((filename) => (
            <PreviewAttachment
              key={filename}
              attachment={{
                url: '',
                name: filename,
                contentType: '',
              }}
              isUploading
            />
          ))}
        </div>
      )}

      <Textarea
        ref={textareaRef}
        placeholder="Send a message..."
        value={input}
        onChange={handleInput}
        className={cx(
          'min-h-[24px] max-h-[calc(75dvh)] overflow-hidden resize-none rounded-2xl !text-base bg-muted pb-10 dark:border-zinc-700',
          className,
        )}
        rows={2}
        autoFocus
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();

            if (isLoading) {
              toast.error('Please wait for the model to finish its response!');
            } else {
              submitForm();
            }
          }
        }}
      />

      {/* Attachments Button */}
      <div className="absolute bottom-0 p-2 w-fit flex flex-row justify-start">
        <AttachmentsButton fileInputRef={fileInputRef} isLoading={isLoading} />
      </div>

      {/* Buttons on the right side */}
      <div className="absolute bottom-0 right-0 p-2 w-fit flex flex-row justify-end gap-2">
        <Button
          type="button"
          className="rounded-full p-1.5 h-fit border dark:border-zinc-600"
          onClick={(event) => {
            event.preventDefault();
            handleRecordClick();
          }}
          variant={isRecording ? 'destructive' : 'default'}
        >
          {isRecording ? (
            <MicOffIcon className="w-4 h-4" />
          ) : (
            <MicIcon className="w-4 h-4" />
          )}
        </Button>

        {isLoading ? (
          <StopButton stop={stop} setMessages={setMessages} />
        ) : (
          <SendButton
            input={input}
            submitForm={submitForm}
            uploadQueue={uploadQueue}
          />
        )}
      </div>
    </div>
  );
}

export const MultimodalInput = memo(
  PureMultimodalInput,
  (prevProps, nextProps) => {
    if (prevProps.input !== nextProps.input) return false;
    if (prevProps.isLoading !== nextProps.isLoading) return false;
    if (!equal(prevProps.attachments, nextProps.attachments)) return false;
    return true;
  },
);

function PureAttachmentsButton({
  fileInputRef,
  isLoading,
}: {
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  isLoading: boolean;
}) {
  return (
    <Button
      type="button"
      className="rounded-md rounded-bl-lg p-[7px] h-fit dark:border-zinc-700 hover:dark:bg-zinc-900 hover:bg-zinc-200"
      onClick={(event) => {
        event.preventDefault();
        fileInputRef.current?.click();
      }}
      disabled={isLoading}
      variant="ghost"
    >
      <PaperclipIcon size={14} />
    </Button>
  );
}

const AttachmentsButton = memo(PureAttachmentsButton);

function PureStopButton({
  stop,
  setMessages,
}: {
  stop: () => void;
  setMessages: Dispatch<SetStateAction<Array<Message>>>;
}) {
  return (
    <Button
      type="button"
      className="rounded-full p-1.5 h-fit border dark:border-zinc-600"
      onClick={(event) => {
        event.preventDefault();
        stop();
        setMessages((messages) => sanitizeUIMessages(messages));
      }}
    >
      <StopIcon size={14} />
    </Button>
  );
}

const StopButton = memo(PureStopButton);

function PureSendButton({
  submitForm,
  input,
  uploadQueue,
}: {
  submitForm: () => void;
  input: string;
  uploadQueue: Array<string>;
}) {
  return (
    <Button
      type="button"
      className="rounded-full p-1.5 h-fit border dark:border-zinc-600"
      onClick={(event) => {
        event.preventDefault();
        submitForm();
      }}
      disabled={input.length === 0 || uploadQueue.length > 0}
    >
      <ArrowUpIcon size={14} />
    </Button>
  );
}

const SendButton = memo(PureSendButton, (prevProps, nextProps) => {
  if (prevProps.uploadQueue.length !== nextProps.uploadQueue.length) return false;
  if (prevProps.input !== nextProps.input) return false;
  return true;
});