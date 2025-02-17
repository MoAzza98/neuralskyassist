// components/ui/icons.ts
import React from 'react';

export function MicIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      {<img src="./MicIcon.svg" alt="microphone icon" />}
    </svg>
  );
}

export function MicOffIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      {<img src="./MicOffIcon.svg" alt="microphone icon" />}
    </svg>
  );
}
