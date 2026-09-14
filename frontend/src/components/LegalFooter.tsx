import React from 'react'
import { Link } from 'react-router-dom'
import { AppTheme } from '../styles/theme'

/**
 * The one line every page ends with. Small, grey, out of the way — but on
 * every page, because the person who most needs the privacy notice is the
 * one who landed on a shared summary and has never seen the record screen.
 */
const LegalFooter: React.FC<{ theme: AppTheme; style?: React.CSSProperties }> = ({ theme, style }) => {
	const link: React.CSSProperties = { color: theme.secondaryText, textDecoration: 'none' }
	return (
		<footer
			style={{
				marginTop: '40px',
				paddingBottom: '16px',
				textAlign: 'center',
				fontSize: '12px',
				color: theme.secondaryText,
				...style,
			}}>
			<Link to="/legal#privacy" style={link}>
				Privacy
			</Link>
			<span style={{ margin: '0 8px' }}>·</span>
			<Link to="/legal#imprint" style={link}>
				Imprint
			</Link>
			<span style={{ margin: '0 8px' }}>·</span>
			<Link to="/legal#terms" style={link}>
				Terms
			</Link>
		</footer>
	)
}

export default LegalFooter
