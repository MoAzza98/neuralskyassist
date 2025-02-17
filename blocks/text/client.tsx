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
   * We'll keep your existing logic, but you could also detect Arabic from the initial content here
   * if the block content is accessible. If not, we rely on onStreamPart or content-time detection.
   */
  initialize: async ({ documentId, setMetadata }) => {
    const suggestions = await getSuggestions({ documentId });
    setMetadata({
      suggestions,
      // language will be set onStreamPart if we detect Arabic from GPT's streaming
    });
  },

  /**
   * Streams in suggestions or text deltas from the server. After appending text,
   * we detect if it's Arabic and store that in metadata.language.
   */
  onStreamPart: ({ streamPart, setMetadata, setBlock }) => {
    if (streamPart.type === 'suggestion') {
      setMetadata((metadata) => {
        return {
          ...metadata,
          suggestions: [
            ...metadata.suggestions,
            streamPart.content as Suggestion,
          ],
        };
      });
    }

    if (streamPart.type === 'text-delta') {
      setBlock((draftBlock) => {
        const newContent = draftBlock.content + (streamPart.content as string);

        // We'll detect Arabic after we append
        const isArabic = isLikelyArabic(newContent);

        // Return updated block content
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
      setMetadata((metadata) => {
        const newContent = metadata?.suggestions
          ? '' // we don't actually have the new block content here; we rely on the block above
          : '';
        // If needed, you could pass the appended content directly from the block update
        // For now, we can just store isArabic
        // Alternatively, you can do: setMetadata({ ...metadata, language: isArabic ? 'ar' : 'en' });
        return {
          ...metadata,
          language: isLikelyArabic(streamPart.content as string)
            ? 'ar'
            : metadata.language ?? 'en',
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
  }) => {
    if (isLoading) {
      return <DocumentSkeleton blockKind="text" />;
    }

    if (mode === 'diff') {
      const oldContent = getDocumentContentById(currentVersionIndex - 1);
      const newContent = getDocumentContentById(currentVersionIndex);
      return <DiffView oldContent={oldContent} newContent={newContent} />;
    }

    // Check if metadata says it's Arabic, or do a fallback check on content
    const isArabic =
      metadata.language === 'ar' || isLikelyArabic(content || '');

    return (
      // We'll wrap in a container that sets direction and alignment
      <div
        dir={isArabic ? 'rtl' : 'ltr'}
        style={{ textAlign: isArabic ? 'right' : 'left' }}
      >
        <div className="flex flex-row py-8 md:p-20 px-4">
          <Editor
            content={content}
            suggestions={metadata ? metadata.suggestions : []}
            isCurrentVersion={isCurrentVersion}
            currentVersionIndex={currentVersionIndex}
            status={status}
            onSaveContent={(updated) => {
              onSaveContent(updated, false);

              // Check Arabic again on manual edits
              const newlyArabic = isLikelyArabic(updated);
              metadata.language = newlyArabic ? 'ar' : 'en';
            }}
          />

          {/* Show empty space if suggestions exist (like your original code) */}
          {metadata &&
          metadata.suggestions &&
          metadata.suggestions.length > 0 ? (
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
