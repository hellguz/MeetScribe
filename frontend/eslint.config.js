import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		rules: {
			'no-console': ['warn', { allow: ['warn', 'error'] }],
			'@typescript-eslint/no-explicit-any': 'error',
		},
	},
)
