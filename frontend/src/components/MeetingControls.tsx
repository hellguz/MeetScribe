import React from 'react';
import { AppTheme } from '../styles/theme';
import { createSummaryStyles } from '../styles/summaryStyles';
import { SummaryLength } from '../contexts/SummaryLengthContext';
import { SummaryLanguageState } from '../contexts/SummaryLanguageContext';
import SummaryLengthSelector from './SummaryLengthSelector';
import LanguageSelector from './LanguageSelector';

interface MeetingControlsProps {
  currentMeetingLength: SummaryLength;
  editedContext: string | null;
  contextHasChanged: boolean;
  isRegenerating: boolean;
  isProcessing: boolean;
  theme: AppTheme;
  onLengthChange: (newLength: SummaryLength) => void;
  onLanguageChange: (update: Partial<SummaryLanguageState>) => Promise<void>;
  onContextChange: (newContext: string) => void;
  onContextUpdate: () => void;
}

export default function MeetingControls({
  currentMeetingLength,
  editedContext,
  contextHasChanged,
  isRegenerating,
  isProcessing,
  theme,
  onLengthChange,
  onLanguageChange,
  onContextChange,
  onContextUpdate,
}: MeetingControlsProps) {
  const styles = createSummaryStyles(theme);
  const disabled = isRegenerating || isProcessing;

  return (
    <div style={styles.controls}>
      <div style={styles.controlsRow}>
        <SummaryLengthSelector 
          value={currentMeetingLength} 
          disabled={disabled} 
          onSelect={onLengthChange} 
        />
        <LanguageSelector 
          disabled={disabled} 
          onSelectionChange={onLanguageChange} 
        />
      </div>

      <div>
        <label htmlFor="context-editor" style={styles.contextLabel}>
          Context
        </label>
        <textarea
          id="context-editor"
          value={editedContext ?? ''}
          onChange={(e) => onContextChange(e.target.value)}
          placeholder="Add participant names, project codes, or key terms here to improve summary accuracy. Changes will trigger a regeneration."
          disabled={disabled}
          style={styles.contextTextarea(disabled)}
        />
        {contextHasChanged && (
          <button
            onClick={onContextUpdate}
            disabled={disabled}
            style={styles.contextButton(disabled)}>
            Apply & Regenerate Summary
          </button>
        )}
      </div>
    </div>
  );
}