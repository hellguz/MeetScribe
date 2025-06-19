import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ThemeProvider } from './contexts/ThemeContext' // Import ThemeProvider
import { SummaryLengthProvider } from './contexts/SummaryLengthContext'
import './index.css' // Import global styles

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		{' '}
		{/* It's good practice to have StrictMode */}
		<BrowserRouter>
			<ThemeProvider>
				{' '}
				{/* Wrap App with ThemeProvider */}
				<SummaryLengthProvider>
					<App />
				</SummaryLengthProvider>
			</ThemeProvider>
		</BrowserRouter>
	</React.StrictMode>,
)
