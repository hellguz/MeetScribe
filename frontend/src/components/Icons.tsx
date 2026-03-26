import React from 'react'

interface IconProps {
	size?: number
}

const iconProps = (size: number) => ({
	width: size,
	height: size,
	viewBox: '0 0 24 24',
	fill: 'none',
	stroke: 'currentColor',
	strokeWidth: 2,
	strokeLinecap: 'round' as const,
	strokeLinejoin: 'round' as const,
})

export const SunIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<circle cx="12" cy="12" r="5" />
		<line x1="12" y1="1" x2="12" y2="3" />
		<line x1="12" y1="21" x2="12" y2="23" />
		<line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
		<line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
		<line x1="1" y1="12" x2="3" y2="12" />
		<line x1="21" y1="12" x2="23" y2="12" />
		<line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
		<line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
	</svg>
)

export const MoonIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
	</svg>
)

export const CopyTextIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<rect x="9" y="9" width="13" height="13" rx="2" />
		<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
	</svg>
)

export const CopyMarkdownIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<polyline points="16 18 22 12 16 6" />
		<polyline points="8 6 2 12 8 18" />
	</svg>
)

export const EditIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
		<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
	</svg>
)

export const TrashIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<polyline points="3 6 5 6 21 6" />
		<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
		<path d="M10 11v6" />
		<path d="M14 11v6" />
		<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
	</svg>
)

export const StarIcon: React.FC<IconProps & { filled?: boolean }> = ({ size = 14, filled = false }) => (
	<svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
		<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
	</svg>
)

export const PlusIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<line x1="12" y1="5" x2="12" y2="19" />
		<line x1="5" y1="12" x2="19" y2="12" />
	</svg>
)

export const CheckIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<polyline points="20 6 9 17 4 12" />
	</svg>
)

export const CloseIcon: React.FC<IconProps> = ({ size = 14 }) => (
	<svg {...iconProps(size)}>
		<line x1="18" y1="6" x2="6" y2="18" />
		<line x1="6" y1="6" x2="18" y2="18" />
	</svg>
)
