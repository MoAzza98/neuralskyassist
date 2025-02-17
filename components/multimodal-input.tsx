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
 * Explicitly detect iOS, so we can *force* fallback for Safari & Chrome on iOS
 * (They use the same WebKit engine).
 */
function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * Check if Web Speech is supported, but disable it on iOS specifically.
 */
function canUseWebSpeech(): boolean {
  if (isIos()) {
    // Force fallback for iOS:
    return false;
  }
  if (typeof window === 'undefined') return false;

  const w = window as any;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

/** For a potential fallback if iOS can’t handle 'audio/webm' */
function pickMimeType(): string | undefined {
  // Try a few common containers:
  const preferred = [
    'audio/webm; codecs=opus',
    'audio/mp4; codecs=opus', // sometimes iOS picks this
    'audio/ogg; codecs=opus'
  ];
  for (const mt of preferred) {
    if (MediaRecorder.isTypeSupported(mt)) {
      console.log('[Deepgram] Using mimeType:', mt);
      return mt;
    }
  }
  // If none are supported, let the browser pick a default
  return undefined;
}

// You can still keep these constants for your attachments logic, etc.
const MIN_RECORD_DURATION_MS = 800;  // minimal record time
const MIN_AUDIO_FILE_SIZE = 1000;    // minimal file size for "meaningful" audio

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

  // =========== HYBRID STT LOGIC ===========
  const [isRecording, setIsRecording] = useState(false);

  // Web Speech references
  const recognitionRef = useRef<any>(null);

  // Deepgram references
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const deepgramSocketRef = useRef<WebSocket | null>(null);

  const webSpeechSupported = canUseWebSpeech();
  console.log('[MultimodalInput] webSpeechSupported:', webSpeechSupported);

  const recordStartRef = useRef<number>(0);

  /**
   * Called when user toggles the mic button
   */
  const handleRecordClick = async () => {
    try {
      if (!isRecording) {
        // START
        if (webSpeechSupported) {
          console.log('Using Web Speech API...');
          const SpeechRecognition =
            (window as any).SpeechRecognition ||
            (window as any).webkitSpeechRecognition;
          const recognition = new SpeechRecognition();
          recognitionRef.current = recognition;
          recognition.lang = 'en-US'; // or navigator.language
          recognition.interimResults = true;

          let finalTranscript = '';

          recognition.onstart = () => {
            setIsRecording(true);
          };

          recognition.onresult = (e: any) => {
            let partial = '';
            for (let i = 0; i < e.results.length; i++) {
              partial += e.results[i][0].transcript;
            }
            finalTranscript = partial;
            setInput(partial);
          };

          recognition.onerror = (err: any) => {
            console.error('Web Speech error:', err);
            toast.error('Speech recognition error');
          };

          recognition.onend = () => {
            setIsRecording(false);
            if (!finalTranscript.trim()) {
              toast.error('No meaningful speech detected.');
            } else {
              setInput(finalTranscript.trim());
            }
          };

          recognition.start();
        } else {
          // Fallback to Deepgram streaming
          console.log('Using Deepgram fallback on iOS or other non-Web Speech browsers...');
          const DG_KEY = 'YOUR_DEEPGRAM_API_KEY'; // <--- Replace with real or use a secure token
          const socketUrl = 'wss://api.deepgram.com/v1/listen?encoding=opus';
          const dgSocket = new WebSocket(socketUrl, ['token', DG_KEY]);
          deepgramSocketRef.current = dgSocket;

          // Request mic
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

          dgSocket.onopen = () => {
            console.log('[Deepgram] WebSocket open');
            setIsRecording(true);
            setInput('');
            recordStartRef.current = Date.now();
          };

          dgSocket.onerror = (err) => {
            console.error('[Deepgram] socket error:', err);
            toast.error('Deepgram error');
          };

          dgSocket.onclose = () => {
            console.log('[Deepgram] socket closed');
            setIsRecording(false);
          };

          dgSocket.onmessage = (msg) => {
            const data = JSON.parse(msg.data);
            // Typical structure from Deepgram:
            // { channel: { alternatives: [ { transcript, confidence, ... } ], ... }, is_final, ... }
            if (data.channel) {
              const alt = data.channel.alternatives[0];
              if (alt && alt.transcript) {
                // We can display partial transcripts
                setInput(alt.transcript);
              }
            }
          };

          // Decide on container
          const chosenMime = pickMimeType();
          const options: MediaRecorderOptions = chosenMime
            ? { mimeType: chosenMime, audioBitsPerSecond: 128000 }
            : { audioBitsPerSecond: 128000 };
          const mediaRecorder = new MediaRecorder(stream, options);
          mediaRecorderRef.current = mediaRecorder;

          mediaRecorder.ondataavailable = (evt) => {
            if (evt.data.size > 0 && dgSocket.readyState === WebSocket.OPEN) {
              console.log('[Deepgram] sending chunk:', evt.data.size, 'bytes');
              dgSocket.send(evt.data);
            }
          };

          mediaRecorder.onstart = () => {
            console.log('[Deepgram] mediaRecorder started...');
          };

          mediaRecorder.start(300); 
        }
      } else {
        // STOP
        if (webSpeechSupported) {
          const recognition = recognitionRef.current;
          if (recognition) {
            recognition.stop();
          }
        } else {
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

          // Optional: If you want to check duration or final text
          const duration = Date.now() - recordStartRef.current;
          console.log(`[Deepgram] total recording duration: ${duration}ms`);
          if (duration < MIN_RECORD_DURATION_MS) {
            toast.error('Recording too short; no audio detected.');
          }
        }
      }
    } catch (err) {
      console.error('Mic or STT error:', err);
      toast.error('Cannot access microphone or speech API!');
    }
  };

  // ========== UI RENDERING BELOW ==========

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
        {/* Microphone button */}
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
