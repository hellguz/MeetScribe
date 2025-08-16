import { MeetingSection } from '../types';

/**
 * Generate full summary text from sections
 */
export const generateFullSummaryText = (sections: MeetingSection[]): string => {
  if (!sections || sections.length === 0) return '';
  return sections
    .map(s => `### ${s.title}\n\n${s.content || ''}`)
    .join('\n\n---\n\n');
};

/**
 * Convert markdown text to plain text
 */
export const convertMarkdownToPlainText = (markdownText: string): string => {
  return markdownText
    .replace(/^---\s*$/gm, '')
    .replace(/####\s/g, '')
    .replace(/###\s/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/-\s/g, '• ')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .trim();
};

/**
 * Copy text to clipboard with format options
 */
export const copyTextToClipboard = async (
  meetingTitle: string,
  fullSummaryText: string,
  formattedDate: string,
  format: 'text' | 'markdown'
): Promise<void> => {
  if (!meetingTitle || !fullSummaryText) return;

  let textToCopy = '';

  if (format === 'markdown') {
    textToCopy = `# ${meetingTitle}\n\n*${formattedDate}*\n\n---\n\n${fullSummaryText}`;
  } else {
    const plainSummary = convertMarkdownToPlainText(fullSummaryText);
    textToCopy = `${meetingTitle}\n${formattedDate}\n\n${plainSummary}`;
  }

  await navigator.clipboard.writeText(textToCopy);
};