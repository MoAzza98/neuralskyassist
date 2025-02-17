'use client';

import type {
  Attachment,
  ChatRequestOptions,
  CreateMessage,
  Message,
} from 'ai';
import cx from 'classnames';
import React, {
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

const MIN_RECORD_DURATION_MS = 800;
const MIN_AUDIO_FILE_SIZE = 1000;

/**
 * Returns a MediaRecorder instance for the microphone.
 * Adjusts to a preferred MIME type; AssemblyAI expects PCM16 at 16000 Hz.
 */
async function getMicrophoneRecorder(): Promise<MediaRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  let mimeType: string | undefined;
  const iosPreferred = ['audio/mp4', 'audio/mpeg'];
  for (const mt of iosPreferred) {
    if (MediaRecorder.isTypeSupported(mt)) {
      mimeType = mt;
      break;
    }
  }
  if (!mimeType) {
    const preferred = [
      'audio/webm; codecs=opus',
      'audio/mp4; codecs=opus',
      'audio/ogg; codecs=opus',
    ];
    for (const mt of preferred) {
      if (MediaRecorder.isTypeSupported(mt)) {
        mimeType = mt;
        break;
      }
    }
  }
  const options: MediaRecorderOptions = mimeType
    ? { mimeType, audioBitsPerSecond: 128000 }
    : { audioBitsPerSecond: 128000 };
  return new MediaRecorder(stream, options);
}

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
    chatRequestOptions?: ChatRequestOptions
  ) => Promise<string | null | undefined>;
  handleSubmit: (
    event?: { preventDefault?: () => void },
    chatRequestOptions?: ChatRequestOptions
  ) => void;
  className?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { width } = useWindowSize();
  useEffect(() => { if (textareaRef.current) adjustHeight(); }, []);
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
      setInput(textareaRef.current.value || localStorageInput || '');
      adjustHeight();
    }
  }, []);
  useEffect(() => { setLocalStorageInput(input); }, [input]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
    adjustHeight();
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadQueue, setUploadQueue] = useState<Array<string>>([]);
  const submitForm = useCallback(() => {
    window.history.replaceState({}, '', `/chat/${chatId}`);
    handleSubmit(undefined, { experimental_attachments: attachments });
    setAttachments([]);
    setLocalStorageInput('');
    resetHeight();
    if (width && width > 768) textareaRef.current?.focus();
  }, [attachments, handleSubmit, width, chatId]);

  const uploadFile = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const response = await fetch('/api/files/upload', { method: 'POST', body: formData });
      if (response.ok) {
        const data = await response.json();
        const { url, pathname, contentType } = data;
        return { url, name: pathname, contentType };
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
        const successfullyUploadedAttachments = uploadedAttachments.filter(att => att !== undefined);
        setAttachments((current) => [...current, ...successfullyUploadedAttachments]);
      } catch (error) {
        console.error('Error uploading files!', error);
        toast.error('Error uploading files!');
      } finally {
        setUploadQueue([]);
      }
    },
    [setAttachments]
  );

  // =========== ASSEMBLYAI STREAMING STT LOGIC ===========
  const [isRecording, setIsRecording] = useState(false);
  const recordStartRef = useRef<number>(0);
  const assemblyaiSocketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const dataIntervalRef = useRef<number>();

  const handleRecordClick = async () => {
    try {
      if (!isRecording) {
        console.log('Starting AssemblyAI STT...');
        const keyResponse = await fetch('/api/key');
        const keyJson = await keyResponse.json();
        const tempKey = keyJson.key;
        if (!tempKey) throw new Error('Failed to obtain temporary AssemblyAI key.');
        const socketUrl = `wss://api.assemblyai.com/v2/realtime/ws?sample_rate=16000&authorization=${tempKey}`;
        const socket = new WebSocket(socketUrl);
        assemblyaiSocketRef.current = socket;

        socket.onopen = async () => {
          console.log('AssemblyAI WebSocket open');
          setIsRecording(true);
          setInput('');
          recordStartRef.current = Date.now();
          try {
            const recorder = await getMicrophoneRecorder();
            mediaRecorderRef.current = recorder;
            // Use a short timeslice to ensure rapid data sending.
            recorder.start(250);
            // As a fallback, request data manually every 250ms.
            dataIntervalRef.current = window.setInterval(() => {
              if (recorder.state === 'recording') {
                recorder.requestData();
              }
            }, 250);
            recorder.ondataavailable = (evt) => {
              if (evt.data.size > 0 && socket.readyState === WebSocket.OPEN) {
                socket.send(evt.data);
              }
            };
          } catch (micError: any) {
            console.error('Error accessing microphone:', micError);
            toast.error('Error accessing microphone');
            socket.close();
          }
        };

        socket.onerror = (err) => {
          console.error('AssemblyAI socket error:', err);
          const errorMessage = err instanceof Error ? err.message : JSON.stringify(err);
          toast.error(`AssemblyAI error: ${errorMessage}`);
        };

        socket.onclose = (event) => {
          console.log('AssemblyAI socket closed', event);
          setIsRecording(false);
          if (dataIntervalRef.current) {
            clearInterval(dataIntervalRef.current);
          }
        };

        socket.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data);
            if (data.text) {
              setInput(data.text);
            }
          } catch (parseError) {
            console.error('Error parsing AssemblyAI message:', parseError);
            const errMsg = parseError instanceof Error ? parseError.message : String(parseError);
            toast.error(`AssemblyAI message parse error: ${errMsg}`);
          }
        };
      } else {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
          mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
        }
        if (assemblyaiSocketRef.current && assemblyaiSocketRef.current.readyState === WebSocket.OPEN) {
          assemblyaiSocketRef.current.close();
        }
        setIsRecording(false);
        if (dataIntervalRef.current) {
          clearInterval(dataIntervalRef.current);
        }
        const duration = Date.now() - recordStartRef.current;
        console.log(`Total recording duration: ${duration}ms`);
        if (duration < MIN_RECORD_DURATION_MS) {
          toast.error('Recording too short; no audio detected.');
        }
      }
    } catch (err: any) {
      console.error('Mic or STT error:', err);
      toast.error(`Cannot access microphone or speech API: ${err.message || err}`);
    }
  };

  return (
    <div className="relative w-full flex flex-col gap-4">
      {messages.length === 0 && attachments.length === 0 && uploadQueue.length === 0 && (
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
          {attachments.map(attachment => (
            <PreviewAttachment key={attachment.url} attachment={attachment} />
          ))}
          {uploadQueue.map(filename => (
            <PreviewAttachment key={filename} attachment={{ url: '', name: filename, contentType: '' }} isUploading />
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
          className
        )}
        rows={2}
        autoFocus
        onKeyDown={event => {
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
      <div className="absolute bottom-0 p-2 w-fit flex flex-row justify-start">
        <AttachmentsButton fileInputRef={fileInputRef} isLoading={isLoading} />
      </div>
      <div className="absolute bottom-0 right-0 p-2 w-fit flex flex-row justify-end gap-2">
        <Button
          type="button"
          className="rounded-full p-1.5 h-fit border dark:border-zinc-600"
          onClick={event => {
            event.preventDefault();
            handleRecordClick();
          }}
          variant={isRecording ? 'destructive' : 'default'}
        >
          {isRecording ? <MicOffIcon className="w-4 h-4" /> : <MicIcon className="w-4 h-4" />}
        </Button>
        {isLoading ? (
          <StopButton stop={stop} setMessages={setMessages} />
        ) : (
          <SendButton input={input} submitForm={submitForm} uploadQueue={uploadQueue} />
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
  }
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
      onClick={event => {
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
      onClick={event => {
        event.preventDefault();
        stop();
        setMessages(messages => sanitizeUIMessages(messages));
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
      onClick={event => {
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
