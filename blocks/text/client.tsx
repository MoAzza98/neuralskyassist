import { Block } from '@/components/create-block';
import { DiffView } from '@/components/diffview';
import { DocumentSkeleton } from '@/components/document-skeleton';
import { Editor } from '@/components/editor';
import {
  ClockRewind,
  CopyIcon,
  MessageIcon,
  PenIcon,
  RedoIcon,
  UndoIcon,
} from '@/components/icons';
import { Suggestion } from '@/lib/db/schema';
import { toast } from 'sonner';
import { getSuggestions } from '../actions';

/** Simple helper to detect Arabic characters. Adjust/expand if needed. */
function isLikelyArabic(text: string) {
  return /[\u0600-\u06FF]/.test(text);
}

interface TextBlockMetadata {
  suggestions: Array<Suggestion>;
  /** We'll store the current language so we can do RTL vs LTR. */
  language?: 'ar' | 'en';
}

export const textBlock = new Block<'text', TextBlockMetadata>({
  kind: 'text',
  description: 'Useful for text content, like drafting essays and emails.',

  /**
   * Runs once when the block is first created or loaded, e.g. to fetch suggestions.
   */
  initialize: async ({ documentId, setMetadata }) => {
    const suggestions = await getSuggestions({ documentId });
    // <-- ADDED: Provide a default for language so it's never undefined.
    setMetadata({
      suggestions: suggestions ?? [],
      language: 'en',
    });
  },

  /**
   * Streams in suggestions or text deltas from the server. After appending text,
   * we detect if it's Arabic and store that in metadata.language.
   */
  onStreamPart: ({ streamPart, setMetadata, setBlock }) => {
    if (streamPart.type === 'suggestion') {
      setMetadata((prevMetadata) => {
        // <-- ADDED: fallback so we never read from undefined
        const safeMetadata = prevMetadata || { suggestions: [], language: 'en' };
        return {
          ...safeMetadata,
          suggestions: [
            ...safeMetadata.suggestions,
            streamPart.content as Suggestion,
          ],
        };
      });
    }

    if (streamPart.type === 'text-delta') {
      setBlock((draftBlock) => {
        const newContent = draftBlock.content + (streamPart.content as string);
        const isArabic = isLikelyArabic(newContent);

        return {
          ...draftBlock,
          content: newContent,
          isVisible:
            draftBlock.status === 'streaming' &&
            draftBlock.content.length > 400 &&
            draftBlock.content.length < 450
              ? true
              : draftBlock.isVisible,
          status: 'streaming',
        };
      });

      // Also set the metadata.language
      setMetadata((prevMetadata) => {
        // <-- ADDED: fallback for metadata
        const safeMetadata = prevMetadata || { suggestions: [], language: 'en' };
        const isArabic = isLikelyArabic(streamPart.content as string);
        return {
          ...safeMetadata,
          language: isArabic ? 'ar' : safeMetadata.language ?? 'en',
        };
      });
    }
  },

  /**
   * Renders the block's main content. We'll wrap everything in an RTL or LTR container
   * if the text is detected as Arabic or not.
   */
  content: ({
    mode,
    status,
    content,
    isCurrentVersion,
    currentVersionIndex,
    onSaveContent,
    getDocumentContentById,
    isLoading,
    metadata,
    setMetadata, // <-- so we can update the metadata if user edits text
  }) => {
    if (isLoading) {
      return <DocumentSkeleton blockKind="text" />;
    }

    if (mode === 'diff') {
      const oldContent = getDocumentContentById(currentVersionIndex - 1);
      const newContent = getDocumentContentById(currentVersionIndex);
      return <DiffView oldContent={oldContent} newContent={newContent} />;
    }

    // <-- ADDED: Provide a local safe fallback for metadata
    const safeMetadata = metadata || { suggestions: [], language: 'en' };

    // Check if metadata says it's Arabic, or do a fallback check on content
    const isArabic =
      safeMetadata.language === 'ar' || isLikelyArabic(content || '');

    return (
      // We'll wrap in a container that sets direction and alignment
      <div
        dir={isArabic ? 'rtl' : 'ltr'}
        style={{ textAlign: isArabic ? 'right' : 'left' }}
      >
        <div className="flex flex-row py-8 md:p-20 px-4">
          <Editor
            content={content}
            // <-- Use safeMetadata.suggestions
            suggestions={safeMetadata.suggestions}
            isCurrentVersion={isCurrentVersion}
            currentVersionIndex={currentVersionIndex}
            status={status}
            // <-- UPDATED: onSaveContent now passes two args (content, debounce)
            onSaveContent={(updated) => {
              onSaveContent(updated, false);

              // Check Arabic again on manual edits and update metadata
              const newlyArabic = isLikelyArabic(updated);
              setMetadata((prev) => {
                const stablePrev = prev || { suggestions: [], language: 'en' };
                return {
                  ...stablePrev,
                  language: newlyArabic ? 'ar' : 'en',
                };
              });
            }}
          />

          {/* Show empty space if suggestions exist (like your original code) */}
          {safeMetadata.suggestions.length > 0 ? (
            <div className="md:hidden h-dvh w-12 shrink-0" />
          ) : null}
        </div>
      </div>
    );
  },

  actions: [
    {
      icon: <ClockRewind size={18} />,
      description: 'View changes',
      onClick: ({ handleVersionChange }) => {
        handleVersionChange('toggle');
      },
      isDisabled: ({ currentVersionIndex }) => {
        if (currentVersionIndex === 0) {
          return true;
        }
        return false;
      },
    },
    {
      icon: <UndoIcon size={18} />,
      description: 'View Previous version',
      onClick: ({ handleVersionChange }) => {
        handleVersionChange('prev');
      },
      isDisabled: ({ currentVersionIndex }) => {
        return currentVersionIndex === 0;
      },
    },
    {
      icon: <RedoIcon size={18} />,
      description: 'View Next version',
      onClick: ({ handleVersionChange }) => {
        handleVersionChange('next');
      },
      isDisabled: ({ isCurrentVersion }) => {
        return isCurrentVersion;
      },
    },
    {
      icon: <CopyIcon size={18} />,
      description: 'Copy to clipboard',
      onClick: ({ content }) => {
        navigator.clipboard.writeText(content);
        toast.success('Copied to clipboard!');
      },
    },
  ],

  toolbar: [
    {
      icon: <PenIcon />,
      description: 'Add final polish',
      onClick: ({ appendMessage }) => {
        appendMessage({
          role: 'user',
          content:
            'Please add final polish and check for grammar, add section titles for better structure, and ensure everything reads smoothly.',
        });
      },
    },
    {
      icon: <MessageIcon />,
      description: 'Request suggestions',
      onClick: ({ appendMessage }) => {
        appendMessage({
          role: 'user',
          content:
            'Please add suggestions you have that could improve the writing.',
        });
      },
    },
  ],
});
