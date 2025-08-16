import { AppTheme } from './theme';

export const createSummaryStyles = (theme: AppTheme) => ({
  container: {
    maxWidth: 800,
    margin: '0 auto',
    padding: 24,
    color: theme.text
  } as React.CSSProperties,

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px'
  } as React.CSSProperties,

  backButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: theme.secondaryText,
    fontSize: '15px',
    fontFamily: 'inherit'
  } as React.CSSProperties,

  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexShrink: 0
  } as React.CSSProperties,

  copyStatus: {
    color: theme.secondaryText,
    fontSize: '14px',
    transition: 'opacity 0.5s ease-in-out',
    opacity: 1
  } as React.CSSProperties,

  copyButtonGroup: {
    display: 'flex',
    borderRadius: '6px',
    overflow: 'hidden',
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.backgroundSecondary
  } as React.CSSProperties,

  copyButton: {
    padding: '8px 16px',
    border: 'none',
    backgroundColor: 'transparent',
    color: theme.text,
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
    transition: 'background-color 0.2s ease',
    fontFamily: 'inherit'
  } as React.CSSProperties,

  copyButtonDivider: {
    width: '1px',
    backgroundColor: theme.border
  } as React.CSSProperties,

  titleCard: {
    backgroundColor: theme.background,
    padding: '16px',
    borderRadius: '12px',
    border: `1px solid ${theme.border}`,
    marginBottom: '24px'
  } as React.CSSProperties,

  titleInput: {
    fontSize: '1.7em',
    fontWeight: '600',
    width: '100%',
    border: `1px solid ${theme.input.border}`,
    borderRadius: '6px',
    backgroundColor: theme.input.background,
    color: theme.input.text,
    fontFamily: 'inherit'
  } as React.CSSProperties,

  title: {
    cursor: 'pointer',
    fontSize: '1.7em',
    margin: 0,
    fontFamily: 'inherit',
    fontWeight: 600,
    lineHeight: 1.2
  } as React.CSSProperties,

  date: {
    margin: '8px 0 0 0',
    fontSize: '14px',
    color: theme.secondaryText,
    fontFamily: 'inherit'
  } as React.CSSProperties,

  controls: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    marginTop: '16px'
  } as React.CSSProperties,

  controlsRow: {
    display: 'flex',
    flexDirection: 'row',
    gap: '10px',
    justifyContent: 'space-between',
    alignItems: 'center'
  } as React.CSSProperties,

  contextLabel: {
    display: 'block',
    fontWeight: 500,
    marginBottom: '8px',
    fontSize: '14px'
  } as React.CSSProperties,

  contextTextarea: (disabled: boolean) => ({
    width: '100%',
    minHeight: '60px',
    padding: '10px 12px',
    borderRadius: '8px',
    border: `1px solid ${theme.input.border}`,
    backgroundColor: theme.input.background,
    color: theme.input.text,
    fontSize: '14px',
    resize: 'vertical',
    boxSizing: 'border-box',
    opacity: disabled ? 0.7 : 1
  } as React.CSSProperties),

  contextButton: (disabled: boolean) => ({
    marginTop: '12px',
    padding: '8px 16px',
    border: 'none',
    borderRadius: '8px',
    backgroundColor: theme.button.primary,
    color: theme.button.primaryText,
    fontSize: '14px',
    fontWeight: '500',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    transition: 'all 0.2s ease'
  } as React.CSSProperties),

  transcriptCard: {
    marginTop: '32px',
    backgroundColor: theme.background,
    padding: '16px 24px',
    borderRadius: '12px',
    border: `1px solid ${theme.border}`
  } as React.CSSProperties,

  transcriptHeader: {
    cursor: 'pointer',
    userSelect: 'none',
    margin: 0,
    display: 'flex',
    alignItems: 'center'
  } as React.CSSProperties,

  transcriptToggle: (isVisible: boolean) => ({
    display: 'inline-block',
    transform: isVisible ? 'rotate(90deg)' : 'rotate(0deg)',
    transition: 'transform 0.2s',
    marginRight: '8px'
  } as React.CSSProperties),

  transcriptContent: {
    marginTop: '16px',
    whiteSpace: 'pre-wrap',
    color: theme.text,
    fontSize: '14px',
    lineHeight: '1.6'
  } as React.CSSProperties
});

export const copyButtonHoverStyles = (theme: AppTheme) => ({
  onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.backgroundColor = theme.background;
  },
  onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.backgroundColor = 'transparent';
  }
});