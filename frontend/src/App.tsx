import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Record from './pages/Record'
import Summary from './pages/Summary'

export default function App() {
	return (
		<Routes>
			<Route path="/" element={<Navigate to="/record" replace />} />
			<Route path="/record" element={<Record />} />
			<Route path="/summary/:mid" element={<Summary />} />
		</Routes>
	)
}
