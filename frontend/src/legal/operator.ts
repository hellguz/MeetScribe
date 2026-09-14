/**
 * Who runs this deployment. Everything the privacy notice, imprint and terms
 * say about "us" is read from here, so a self-hoster changes one file.
 */
export const OPERATOR = {
	name: 'Egor Gavrilov',
	// A postal address is mandatory for the imprint. A P.O. box is not enough.
	addressLines: ['Neuerbe 25', '99084 Erfurt', 'Germany'],
	email: 'hellguz@gmail.com',
	// Completes the sentence "The server that stores cloud-mode recordings is …".
	hostingLocation: 'a privately operated server in Erfurt, Germany, reached over the internet through a Cloudflare tunnel',
	// The law that applies to the terms.
	governingLaw: 'German law',
}

export const LEGAL_UPDATED = '14 September 2026'
export const RETENTION_DAYS = 365
