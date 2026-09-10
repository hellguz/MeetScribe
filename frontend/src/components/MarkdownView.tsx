import React, { useEffect, useRef } from 'react'
import { marked } from 'marked'
import { AppTheme } from '../styles/theme'

/** Read-only rendered markdown, styled like the editor's output. */
export const MarkdownView: React.FC<{ markdown: string; theme: AppTheme }> = ({ markdown, theme }) => {
	const ref = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (!ref.current) return
		ref.current.innerHTML = marked.parse(markdown || '') as string
		const first = ref.current.firstElementChild as HTMLElement | null
		if (first) first.style.marginTop = '0'
	}, [markdown])
	return <div ref={ref} className="markdown-content" style={{ lineHeight: 1.5, fontSize: '16px', color: theme.text }} />
}

export default MarkdownView
