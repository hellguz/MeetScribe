import React, { useContext } from 'react';
import { ThemeContext } from '../contexts/ThemeContext';
import { AppTheme, lightTheme, darkTheme } from '../styles/theme'; // Import theme types and objects

const ThemeToggle: React.FC = () => {
  const context = useContext(ThemeContext);

  if (!context) {
    // This should not happen if the component is used within ThemeProvider
    return null;
  }

  const { theme, toggleTheme } = context;
  const currentThemeColors: AppTheme = theme === 'light' ? lightTheme : darkTheme;

  // New button text based on theme
  const buttonText = theme === 'light' ? '🌙 Dark' : '☀️ Light';

  return (
    <button
      onClick={toggleTheme}
      title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`} // Tooltip for accessibility
      style={{
        position: 'fixed',
        top: '15px', // Adjusted slightly
        right: '15px', // Adjusted slightly
        padding: '8px 12px', // Made padding a bit smaller
        fontSize: '14px', // Slightly smaller font
        cursor: 'pointer',
        zIndex: 1000,
        backgroundColor: currentThemeColors.backgroundSecondary, // Use a background color that stands out a bit from the corner
        color: currentThemeColors.text, // Use primary text color
        border: `1px solid ${currentThemeColors.border}`,
        borderRadius: '20px', // More rounded, pill-shape
        boxShadow: '0 2px 5px rgba(0,0,0,0.1)', // Subtle shadow for depth
        transition: 'background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease', // Smooth transitions
        fontWeight: 500, // Medium font weight
      }}
    >
      {buttonText}
    </button>
  );
};

export default ThemeToggle;
