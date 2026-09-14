import React, { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTheme } from '../contexts/ThemeContext'
import { AppTheme, lightTheme, darkTheme } from '../styles/theme'
import { OPERATOR, LEGAL_UPDATED, RETENTION_DAYS } from '../legal/operator'

/**
 * Privacy notice, imprint and terms on one page.
 *
 * Written to be read, not to impress: short sections, plain words, and the
 * facts of how this app actually works. Anything about the operator comes
 * from `legal/operator.ts`, so the text here never has to change for a new
 * deployment.
 */

const Section: React.FC<{ id: string; title: string; theme: AppTheme; children: React.ReactNode }> = ({ id, title, theme, children }) => (
	<section id={id} style={{ marginTop: '36px', scrollMarginTop: '24px' }}>
		<h2 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 12px', color: theme.text }}>{title}</h2>
		{children}
	</section>
)

const H3: React.FC<{ children: React.ReactNode }> = ({ children }) => <h3 style={{ fontSize: '15px', fontWeight: 600, margin: '18px 0 6px' }}>{children}</h3>

export default function Legal() {
	const { theme } = useTheme()
	const t: AppTheme = theme === 'light' ? lightTheme : darkTheme
	const navigate = useNavigate()
	const { hash } = useLocation()

	useEffect(() => {
		document.body.style.backgroundColor = t.background
	}, [t.background])

	// Jump to the section named in the hash once the page has rendered.
	useEffect(() => {
		if (!hash) return
		document.getElementById(hash.slice(1))?.scrollIntoView()
	}, [hash])

	const p: React.CSSProperties = { margin: '0 0 10px', lineHeight: 1.6 }
	const ul: React.CSSProperties = { margin: '0 0 10px', paddingLeft: '20px', lineHeight: 1.6 }
	const muted: React.CSSProperties = { color: t.secondaryText }
	const link: React.CSSProperties = { color: t.button.primary }
	const nav: React.CSSProperties = { ...link, textDecoration: 'none', fontSize: '14px' }

	return (
		<div className="page-container" style={{ padding: '12px 24px 24px', maxWidth: 720, margin: '0 auto', color: t.text, fontSize: '15px' }}>
			<button
				onClick={() => navigate(-1)}
				style={{
					background: 'none',
					border: 'none',
					cursor: 'pointer',
					color: t.secondaryText,
					fontSize: '15px',
					padding: 0,
					margin: '12px 0 24px',
					font: 'inherit',
				}}>
				← Back
			</button>

			<h1 style={{ fontSize: '26px', fontWeight: 600, margin: '0 0 6px' }}>Privacy, imprint and terms</h1>
			<p style={{ ...p, ...muted }}>Last updated {LEGAL_UPDATED}.</p>
			<p style={{ ...p, display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
				<a href="#privacy" style={nav}>
					Privacy notice
				</a>
				<a href="#imprint" style={nav}>
					Imprint
				</a>
				<a href="#terms" style={nav}>
					Terms of use
				</a>
			</p>

			{/* ───────────────────────────── PRIVACY ───────────────────────────── */}
			<Section id="privacy" title="Privacy notice" theme={t}>
				<p style={p}>
					MeetScribe records meetings, turns them into text and writes a summary. That means it handles what people said. This notice explains what happens to
					that data, in the words of the person who runs the service.
				</p>

				<H3>Who is responsible</H3>
				<p style={p}>
					{OPERATOR.name}, {OPERATOR.addressLines.join(', ')}. Email:{' '}
					<a href={`mailto:${OPERATOR.email}`} style={link}>
						{OPERATOR.email}
					</a>
					. This is the controller in the sense of the GDPR.
				</p>

				<H3>Two ways to use it</H3>
				<p style={p}>
					<strong>Local mode</strong> keeps everything in your browser. Recording, transcription, speaker detection and the summary all run on your own device,
					and the meeting is stored only there. The one thing that leaves your device is a request to download the AI models the first time (from Hugging Face,
					see below). Nothing you say is sent anywhere unless you choose to share a meeting.
				</p>
				<p style={p}>
					<strong>Cloud mode</strong> (the default) sends the audio to our server, which transcribes and summarises it with the help of the providers listed
					below. The rest of this notice is mostly about cloud mode.
				</p>

				<H3>What we process in cloud mode</H3>
				<ul style={ul}>
					<li>The audio you record or upload, in short chunks.</li>
					<li>The transcript, the speaker labels, the summary and its title.</li>
					<li>Any context notes you type in, and your settings for the meeting (summary length, language).</li>
					<li>Your time zone and the family of operating system you use (for example “Windows” or “Android”), for usage statistics.</li>
					<li>Feedback you give on a summary, including free-text suggestions.</li>
				</ul>
				<p style={p}>
					There are no user accounts. A meeting is tied to your browser, not to a name or email address. We do not ask for or store your name, email or IP
					address on the application server; the hosting infrastructure does keep ordinary technical logs for a short time (see Cloudflare below).
				</p>

				<H3>Who else sees it</H3>
				<ul style={ul}>
					<li>
						<strong>Groq, Inc.</strong> (USA) transcribes the audio chunks with the Whisper model. Audio is sent for processing and is not used by Groq to train
						models.
					</li>
					<li>
						<strong>Anthropic, PBC</strong> (USA) receives the transcript and writes the summary and title with the Claude model. Anthropic does not train on
						data sent through its API.
					</li>
					<li>
						<strong>Cloudflare, Inc.</strong> sits in front of the site and sees your IP address and request metadata, as any web host does, to deliver the page
						and protect it from abuse.
					</li>
					<li>
						<strong>Hugging Face, Inc.</strong> serves the on-device model files in local mode. Downloading them reveals your IP address to Hugging Face, like
						any file download. No meeting content goes there.
					</li>
				</ul>
				<p style={p}>
					The server that stores cloud-mode recordings is {OPERATOR.hostingLocation}. Groq and Anthropic process data in the United States. These transfers rely
					on the European Commission’s standard contractual clauses and, where the provider is certified, the EU–US Data Privacy Framework. Speaker detection
					runs on our own server, not at a third party.
				</p>

				<H3>How long we keep it</H3>
				<ul style={ul}>
					<li>
						Meetings recorded in cloud mode, including the audio, are <strong>deleted automatically one year</strong> ({RETENTION_DAYS} days) after recording.
						You can delete a meeting yourself at any time from the list on the record page or from the summary page.
					</li>
					<li>A meeting you share from local mode stays on the server only for the period you pick when sharing, or until you stop sharing it.</li>
					<li>Nightly database backups are kept for 30 days, so a deleted meeting may survive in a backup for up to that long.</li>
					<li>After a meeting is deleted, only its title and date are kept for 90 days so that anyone holding the link is told why it is gone.</li>
				</ul>

				<H3>Why we are allowed to</H3>
				<p style={p}>
					Processing is necessary to provide the service you asked for (Art. 6(1)(b) GDPR). Anonymous usage statistics and abuse protection rest on our
					legitimate interest in running a working service (Art. 6(1)(f)). You are responsible for making sure everyone in a meeting agrees to being recorded
					and processed this way; see the terms below.
				</p>

				<H3>Cookies and storage in your browser</H3>
				<p style={p}>
					We set no cookies and run no analytics or tracking. The app stores your settings, your meeting list and, in local mode, the meetings themselves in
					your browser’s own storage. That data never leaves your device unless you share a meeting. Clearing your browser data removes it.
				</p>

				<H3>Your rights</H3>
				<p style={p}>
					You can ask for access to, correction of, or deletion of your data, ask us to restrict processing, object to it, or ask for a copy in a portable
					format. Because there are no accounts, please include the link to the meeting concerned so we can find it. You can also complain to a data-protection
					supervisory authority. Write to{' '}
					<a href={`mailto:${OPERATOR.email}`} style={link}>
						{OPERATOR.email}
					</a>
					.
				</p>

				<H3>Age</H3>
				<p style={p}>The service is not intended for people under 16.</p>
			</Section>

			{/* ───────────────────────────── IMPRINT ───────────────────────────── */}
			<Section id="imprint" title="Imprint" theme={t}>
				<p style={p}>
					{OPERATOR.name}
					<br />
					{OPERATOR.addressLines.map((line) => (
						<React.Fragment key={line}>
							{line}
							<br />
						</React.Fragment>
					))}
					Email:{' '}
					<a href={`mailto:${OPERATOR.email}`} style={link}>
						{OPERATOR.email}
					</a>
				</p>
				<p style={{ ...p, ...muted }}>
					Responsible for content: {OPERATOR.name}. This is a non-commercial personal project. The address above is also the point of contact for authorities
					and users under the Digital Services Act.
				</p>
			</Section>

			{/* ───────────────────────────── TERMS ───────────────────────────── */}
			<Section id="terms" title="Terms of use" theme={t}>
				<p style={p}>Short, because there is not much to say. By using MeetScribe you agree to the following.</p>
				<ul style={ul}>
					<li>
						<strong>It is free and provided as is.</strong> There is no warranty of any kind, no promise that it will keep working, and no promise that your
						data will not be lost. Keep your own copy of anything important.
					</li>
					<li>
						<strong>The AI makes mistakes.</strong> Transcripts and summaries are produced by machine learning models and can be wrong, incomplete or
						misattribute who said what. Check them before you rely on them or pass them on. They are not legal, medical or professional advice.
					</li>
					<li>
						<strong>You are responsible for consent.</strong> Recording a conversation without the agreement of everyone in it is illegal in many places,
						including Germany and several US states. Only record meetings where every participant knows and agrees, and where you are allowed to send the audio
						to the providers named in the privacy notice.
					</li>
					<li>
						<strong>You are responsible for what you upload.</strong> Do not use the service for anything unlawful or to process other people’s data you have no
						right to process.
					</li>
					<li>
						<strong>We may change or stop the service</strong> at any time, and may remove content that breaks these terms or the law.
					</li>
					<li>
						<strong>Liability</strong> is limited to intent and gross negligence, as far as the law allows. Nothing here limits liability for injury to life,
						body or health, or where the law does not permit it.
					</li>
					<li>
						The software itself is open source under the MIT licence; these terms concern the hosted service at this address. {OPERATOR.governingLaw} applies.
					</li>
				</ul>
			</Section>
		</div>
	)
}
