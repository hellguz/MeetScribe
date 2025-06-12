import React from 'react'
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ThemeProvider } from './contexts/ThemeContext'; // Import ThemeProvider

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode> {/* It's good practice to have StrictMode */}
    <BrowserRouter>
      <ThemeProvider> {/* Wrap App with ThemeProvider */}
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
