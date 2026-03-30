import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ThemeProvider } from './contexts/ThemeContext'
import { SummaryLengthProvider } from './contexts/SummaryLengthContext'
import { SummaryLanguageProvider } from './contexts/SummaryLanguageContext'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<BrowserRouter>
			<ThemeProvider>
				<SummaryLengthProvider>
					<SummaryLanguageProvider>
						<App />
					</SummaryLanguageProvider>
				</SummaryLengthProvider>
			</ThemeProvider>
		</BrowserRouter>
	</React.StrictMode>,
)
