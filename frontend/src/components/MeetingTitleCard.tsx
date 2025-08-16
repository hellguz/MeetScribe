import React, { useState } from 'react';
import { AppTheme } from '../styles/theme';
import { createSummaryStyles } from '../styles/summaryStyles';

interface MeetingTitleCardProps {
  meetingTitle: string | null;
  formattedDate: string | null;
  mid: string | undefined;
  isLoading: boolean;
  theme: AppTheme;
  onTitleUpdate: (newTitle: string) => Promise<void>;
}

export default function MeetingTitleCard({
  meetingTitle,
  formattedDate,
  mid,
  isLoading,
  theme,
  onTitleUpdate,
}: MeetingTitleCardProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const styles = createSummaryStyles(theme);

  const handleTitleUpdateConfirm = async () => {
    if (editedTitle.trim() && editedTitle.trim() !== meetingTitle) {
      await onTitleUpdate(editedTitle.trim());
    }
    setIsEditingTitle(false);
  };

  const handleTitleClick = () => {
    setEditedTitle(meetingTitle || '');
    setIsEditingTitle(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleTitleUpdateConfirm();
    if (e.key === 'Escape') setIsEditingTitle(false);
  };

  return (
    <div style={styles.titleCard}>
      {isEditingTitle ? (
        <input
          type="text"
          value={editedTitle}
          onChange={(e) => setEditedTitle(e.target.value)}
          onBlur={handleTitleUpdateConfirm}
          onKeyDown={handleKeyDown}
          style={styles.titleInput}
          autoFocus
        />
      ) : (
        <h1
          onClick={handleTitleClick}
          style={styles.title}>
          {meetingTitle || (isLoading ? ' ' : `Summary for ${mid}`)}
        </h1>
      )}

      {formattedDate && (
        <p style={styles.date}>{formattedDate}</p>
      )}
    </div>
  );
}