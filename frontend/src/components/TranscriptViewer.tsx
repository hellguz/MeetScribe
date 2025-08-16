import React, { useState } from 'react';
import { AppTheme } from '../styles/theme';
import { createSummaryStyles } from '../styles/summaryStyles';

interface TranscriptViewerProps {
  transcript: string;
  theme: AppTheme;
}

export default function TranscriptViewer({ transcript, theme }: TranscriptViewerProps) {
  const [isTranscriptVisible, setIsTranscriptVisible] = useState(false);
  const styles = createSummaryStyles(theme);

  return (
    <div style={styles.transcriptCard}>
      <h4
        onClick={() => setIsTranscriptVisible(!isTranscriptVisible)}
        style={styles.transcriptHeader}>
        <span style={styles.transcriptToggle(isTranscriptVisible)}>
          ▶
        </span>{' '}
        🎤 Transcript
      </h4>
      {isTranscriptVisible && (
        <pre style={styles.transcriptContent}>
          {transcript}
        </pre>
      )}
    </div>
  );
}