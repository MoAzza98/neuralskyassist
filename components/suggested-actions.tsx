'use client';

import { motion } from 'framer-motion';
import { Button } from './ui/button';
import { ChatRequestOptions, CreateMessage, Message } from 'ai';
import { memo } from 'react';

interface SuggestedActionsProps {
  chatId: string;
  append: (
    message: Message | CreateMessage,
    chatRequestOptions?: ChatRequestOptions,
  ) => Promise<string | null | undefined>;
}

function PureSuggestedActions({ chatId, append }: SuggestedActionsProps) {
  const suggestedActions = [
    {
      title: 'قم بإنشاء محضر اجتماع',
      label: 'لمجلس الإدارة',
      action: 'قم بإنشاء محضر اجتماع لمجلس الإدارة',
    },
    {
      title: 'ما المطلوب من مستشار قانوني',
      label: `يدرس التحكيم الدولي؟`,
      action: `ما المطلوب من مستشار قانوني يدرس التحكيم الدولي؟`,
    },
    {
      title: 'أعطني نظرة عامة حول',
      label: `الإرشادات الخاصة بالتحكيم الدولي`,
      action: `أعطني نظرة عامة حول الإرشادات الخاصة بالتحكيم الدولي`,
    },
    {
      title: 'ما هي الموارد التي يمكن',
      label: 'أن تساعد محكِّمًا دوليًّا في اكتساب فهمٍ للتحكيم الدولي؟',
      action: 'ما هي الموارد التي يمكن أن تساعد محكِّمًا دوليًّا في اكتساب فهمٍ للتحكيم الدولي؟',
    },
  ];

  return (
    <div className="grid sm:grid-cols-2 gap-2 w-full">
      {suggestedActions.map((suggestedAction, index) => (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ delay: 0.05 * index }}
          key={`suggested-action-${suggestedAction.title}-${index}`}
          className={index > 1 ? 'hidden sm:block' : 'block'}
        >
          <Button
            variant="ghost"
            onClick={async () => {
              window.history.replaceState({}, '', `/chat/${chatId}`);

              append({
                role: 'user',
                content: suggestedAction.action,
              });
            }}
            className="text-left border rounded-xl px-4 py-3.5 text-sm flex-1 gap-1 sm:flex-col w-full h-auto justify-start items-start"
          >
            <span className="font-medium">{suggestedAction.title}</span>
            <span className="text-muted-foreground">
              {suggestedAction.label}
            </span>
          </Button>
        </motion.div>
      ))}
    </div>
  );
}

export const SuggestedActions = memo(PureSuggestedActions, () => true);
