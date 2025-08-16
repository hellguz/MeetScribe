import React, { useState, useRef, useEffect } from 'react';
import { AppTheme } from '../styles/theme';
import { copyTextToClipboard } from '../utils/textProcessing';
import { copyButtonHoverStyles } from '../styles/summaryStyles';

interface CopyControlsProps {
  meetingTitle: string;
  fullSummaryText: string;
  formattedDate: string;
  theme: AppTheme;
}

export default function CopyControls({ 
  meetingTitle, 
  fullSummaryText, 
  formattedDate,
  theme 
}: CopyControlsProps) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'copied_md'>('idle');
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async (format: 'text' | 'markdown') => {
    try {
      await copyTextToClipboard(meetingTitle, fullSummaryText, formattedDate, format);
      setCopyStatus(format === 'markdown' ? 'copied_md' : 'copied');

      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopyStatus('idle'), 5000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
      alert('Could not copy to clipboard.');
    }
  };

  const copyButtonStyle: React.CSSProperties = {
    padding: '8px 16px',
    border: 'none',
    backgroundColor: 'transparent',
    color: theme.text,
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
    transition: 'background-color 0.2s ease',
    fontFamily: 'inherit',
  };

  const hoverHandlers = copyButtonHoverStyles(theme);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
      {copyStatus !== 'idle' && (
        <span
          style={{
            color: theme.secondaryText,
            fontSize: '14px',
            transition: 'opacity 0.5s ease-in-out',
            opacity: 1,
          }}>
          Copied! ✨
        </span>
      )}
      
      <div
        style={{
          display: 'flex',
          borderRadius: '6px',
          overflow: 'hidden',
          border: `1px solid ${theme.border}`,
          backgroundColor: theme.backgroundSecondary,
        }}>
        <button
          onClick={() => handleCopy('text')}
          style={copyButtonStyle}
          {...hoverHandlers}>
          Copy Text
        </button>
        <div style={{ width: '1px', backgroundColor: theme.border }} />
        <button
          onClick={() => handleCopy('markdown')}
          style={copyButtonStyle}
          {...hoverHandlers}>
          Copy Markdown
        </button>
      </div>
    </div>
  );
}