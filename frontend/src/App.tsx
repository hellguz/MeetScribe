import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Record from './pages/Record'
import Summary from './pages/Summary'
import Dashboard from './pages/Dashboard' // Import the new Dashboard component

export default function App() {
	return (
		<Routes>
			<Route path="/" element={<Navigate to="/record" replace />} />
			<Route path="/record" element={<Record />} />
			<Route path="/summary/:mid" element={<Summary />} />
			<Route path="/dashboard" element={<Dashboard />} />
		</Routes>
	)
}
