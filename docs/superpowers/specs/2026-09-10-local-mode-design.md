# Local Mode — design

Status: proposal, for review. Baseline: `main` @ `fe3ac91` (#41) + PR #42.
Author's note: every number in here is either measured from this repo's code or
fetched live on 2026-09-10; sources are named inline.

---

## 1. What this is

One opt-in switch that makes a meeting never touch the server: recorded,
transcribed, diarized and summarized in the browser, stored in the browser.
Cloud meetings keep working exactly as they do today. The two kinds coexist
forever, and every meeting says on its face which kind it is.

It also settles a question the current code leaves open: if the browser owns
the meeting, what does "share" mean?

### In scope
- A single `Local mode` toggle in the record page's top bar, off by default.
- Local meetings: no audio upload, no server row, no server work.
- A storage badge on every meeting, everywhere a meeting appears.
- Cloud → local conversion ("Make private"), with the destruction it implies.
- Local → cloud publishing, time-limited, as the sharing mechanism.
- Notifying people whose access was revoked, when they next open the link.
- Consent-gated fallback to the cloud when the local run fails.

### Out of scope (deliberately)
- Accounts, login, real access control. MeetScribe has none, and this design
  does not add them. See §11 for what that costs and the one token it adds.
- Syncing local meetings between a user's own devices. A local meeting lives
  in one browser profile. Full stop.
- Local-mode translation and re-diarization. See §7.

### Removed by this work
- The cloud-vs-local summary comparison (tabs, side-by-side view, verdict
  buttons). It answered its question; it now confuses the storage story.
- The separate `⚡ on-device transcription` and `🧠 summarize on this device`
  opt-ins. Both fold into the one Local mode switch.
Details in §13.

---

## 1b. This is three pull requests, not one

Two different systems are tangled together in the sections below: **a meeting
that never leaves the browser**, and **moving meetings between the browser and
the server**. They ship separately.

The seam is not where it first looks. "Sharing" cannot come first, because a
local meeting that has to be summarized in the cloud is not a local meeting —
the whole pipeline has to work on-device before storage state means anything.
So:

### PR 0 — `fix: don't re-diarize when only the summary settings changed`
Standalone bug, no relation to local mode, ship it whenever. §12b.

### PR 1 — Local mode: the meeting that never leaves
The toggle and its warnings, the download disclosure, the IndexedDB store, the
whole local pipeline (transcribe → diarize → summarize → title), the TS prompt
builder, consent-gated fallback, and the removal of the old experimental
toggles and the comparison feature.

**No sharing and no conversion.** A local meeting is local, permanently. The
only way out is `Export as Markdown`. The storage badge ships here, but only in
its two-state form — `🔒 On this device` / `☁️ Cloud` — because the moment both
kinds exist they have to be told apart.

Shippable on its own, and it is the actual feature: *my meetings never leave
this machine.*

Sections: §3 (first two states), §4, §5, §6, §7, §8, §9.1, §9.4, §12, §13,
§14.1, §14.2, §15.

### PR 2 — Moving meetings between local and cloud
Everything about transitions: the owner token, publish with expiry, the share
sheet, the recipient save prompt, tombstones and the 410 notice, `Make
private`, and the two extra badge states.

All of the state-machine complexity and all of the design debate lives here,
which is exactly why it should not be riding along with PR 1.

Sections: §2, §3 (all four states), §9.2, §9.3, §10, §11, §14.3.

---

---

## 2. The core decision: what "share" means

### 2.1 The thing that makes this easy

MeetScribe has no accounts. A meeting is a UUID; anyone holding
`/summary/<uuid>` can read it, edit it, and — today — `DELETE` it. The
`/api/meetings/sync` endpoint only returns metadata for IDs the caller already
knows. So "shared online version" has never meant a shared workspace with
members. It has only ever meant **a copy on the server that anyone with the
link can read.**

Once that is said plainly, the tension in "sometimes you still want a shared
online version… or maybe actually not?" mostly dissolves. There is no
collaboration to preserve. There is only hosting.

### 2.2 The model

**In local mode, the browser is the system of record. The server is a drop
box, not a home.**

Sharing a local meeting = publishing a **copy** to the server with an expiry.
Recipients open the link and take their own copy. When the clock runs out the
server copy is deleted; every copy already taken survives. Copies are **forks,
not replicas** — edits do not propagate in either direction, and the doc says
so on screen.

### 2.3 The one control

Do not build "share temporarily" and "move to cloud" as two features. Build
one **Publish** action with a duration, where `Never expire` is one of the
durations:

```
Anyone with this link can read it.

  [ 1 hour ] [ 1 day ] [ 1 week ] [ 1 month ] [ Never ]
                          ▲ default

  https://meet.example/summary/9f2a…c41       [ Copy ]

  Expires 17 Sep 2026, 14:32 · people who open it keep their own copy
  [ Stop sharing now ]
```

`Never` is the old "move to cloud permanently" and is labelled as what it is:
*"Stays on the server until you remove it."* It is one chip in a row, not a
second concept, and it is the answer to "how do we jump there from how it
works now" — a cloud meeting is simply a meeting published with no expiry, and
that is already what every meeting recorded in cloud mode is.

### 2.4 Alternatives rejected

| Option | Why not |
|---|---|
| Local mode with no sharing at all | Kills the product's main use ("send the team the notes"). Users would just turn local mode off. |
| Two separate actions: "Share for a while" / "Move to cloud" | Same underlying operation with two names and two mental models. The duration chip subsumes both. |
| Real sync (edit here, updates there) | Requires accounts, conflict resolution, and a server that reads your data. Contradicts the feature. |
| Share by file export (`.md` / `.zip`) | Keep it — as a secondary action, not the primary one. A link is what people want. Export is free and belongs on the same sheet. |

### 2.5 Worth doing next: encrypted publish

Publishing puts plaintext on the server for the duration, which is a real dent
in "nothing leaves my device." The Firefox Send / 1Password-share pattern fixes
it: encrypt in the browser (AES-GCM), put the key in the URL **fragment**
(`/summary/<id>#k=<key>`), which browsers never send to the server. The server
stores a ciphertext blob it cannot read; the recipient's browser decrypts.

Costs: the server can no longer render, index, or count these meetings; the
recipient must have JS (already true); a link that loses its fragment is
unrecoverable. It also means an encrypted-published meeting cannot be a normal
cloud meeting — so this is a **Phase 2 flavour of publish**, not a replacement
for it. Recommendation: ship §2.3 first, add an `🔐 End-to-end encrypted`
checkbox on the publish sheet in the next pass.

### 2.6 Design references for the share sheet

Named so the implementation has something concrete to look at, all of them
"one row, one duration, one link":

- **Signal — disappearing messages.** The duration chip row (`1h / 1d / 1w /
  4w`) is exactly this control, and it has taught a very large number of people
  what an expiring thing feels like. Closest single reference.
- **1Password — Item Sharing.** "Expires in [dropdown] · Available to [anyone
  with the link]" plus a big copy-link field. The structure to copy.
- **Notion — Share to web.** The quiet `Private` ⇄ `Shared` pill in the header
  that flips state and reveals the link row inline. The badge model in §4.
- **Proton Drive — secure link.** Shows the concrete expiry date under the
  link, not just the duration. Do this; "1 week" is ambiguous, "17 Sep, 14:32"
  is not.
- **Apple iOS share sheet.** Button morphs `Copy` → `Copied ✓` in place, no
  toast. Cheap, and better than the alert() habit elsewhere in this codebase.

Shape: an anchored popover, not a modal. ~360 px wide, 12 px radius, one
border, matching `LocalSummaryOptIn`'s card. No icons beyond the lock. The
share affordance itself in the summary header is a single ghost icon button in
the existing `copyButtonStyle` group — `🔗` when unshared, filled and labelled
`Shared · 6d` when shared.

---

## 3. Meeting storage states

Three states, one per meeting, plus a fourth that only a viewer sees.

| State | Meaning | Badge |
|---|---|---|
| `cloud` | The server holds it. Created with local mode off, or published with no expiry. | `☁️ Cloud` |
| `local` | This browser holds it. Nothing on the server. | `🔒 On this device` |
| `local-published` | This browser holds it; a copy sits on the server with an expiry. | `🔗 Shared · 6d left` |
| `gone` (viewer only) | A cloud meeting the viewer once opened, since made private or deleted by its owner. | `⚠️ Removed from cloud` |

Transitions, and only these:

```
        record (local mode off)                record (local mode on)
                  │                                      │
                  ▼                                      ▼
             ┌─────────┐   Make private (§9)       ┌───────────┐
             │  cloud  │ ─────────────────────────▶│   local   │
             └─────────┘                           └───────────┘
                  ▲                                   │      ▲
                  │  Publish · Never                  │      │ expiry / Stop sharing
                  └───────────────────────────────────┤      │
                                    Publish · 1h…1M   ▼      │
                                              ┌─────────────────┐
                                              │ local-published │
                                              └─────────────────┘
```

`cloud → local` destroys the server copy. `local → cloud` copies, and the
browser copy remains authoritative until the user deletes it.

---

## 4. Where the badge appears

The ask was "on every meeting, show whether it's local or cloud." Applied
literally, that stamps `☁️ Cloud` on every row for users who never enable local
mode — noise. The compromise:

- **Always rendered**, everywhere a meeting is listed or opened.
- **Quiet** (secondary text colour, no border, no background) when the state is
  `cloud` *and* the user has never enabled local mode.
- **Full pill** (bordered, coloured) otherwise — i.e. as soon as local mode has
  ever been on, `☁️ Cloud` becomes a real, visible statement.

Placements:
1. `HistoryList` row — inline after the date, 11 px.
2. `Summary` page — pill next to the title, above the settings card.
3. Publish popover — the current state as its heading.

Colours: `local` uses the theme's text colour (neutral, not "success" green —
this is not a reward). `local-published` uses the same amber already used for
paused recording (`#f59e0b`), because it is a temporary state with a clock.
`gone` uses the danger colour. `cloud` uses `secondaryText`.

---

## 5. The toggle

### 5.1 Placement

`Record.tsx` top bar, currently `[ⓘ] — 🎙️ MeetScribe — [🌓]`. Becomes
`[ⓘ] — 🎙️ MeetScribe — [🔒 Local] [🌓]`.

The pill is a button, not a checkbox: clicking it **opens a popover**, it does
not flip state. A 4 GB download must never start from a stray click.

- Off: outline pill, `secondaryText`, reads `🔓 Cloud`.
- On: filled pill, theme text colour, reads `🔒 Local`.
- On but this device can't run it: `🔒 Local ⚠️`.

### 5.2 The popover, first time

```
🔒 Local mode                                     EXPERIMENTAL

Everything happens in this browser. Your audio, your transcript and
your summary are never sent to our server or to any AI provider.

  What you'll download once            ~4.3 GB
    Speech recognition (Parakeet)       1.26 GB
    Speaker labelling                    ~30 MB
    Summary model (Qwen3-4B)            3.05 GB
  Kept in this browser's cache. Nothing to download next time.

  ⚠️ If something goes wrong mid-way, we'll ask whether to finish the
     job in the cloud. We never send anything without asking.
  ⚠️ Meetings live only in this browser. Clearing site data deletes
     them. They will not appear on your other devices.
  ⚠️ Summaries are written by a 4B model, not Claude — shorter,
     flatter, weaker outside English. See what changes →
  ⚠️ Speech recognition covers 25 European languages. Japanese,
     Chinese, Arabic, Hindi, Korean and others won't transcribe
     at all here. Full list →

                                        [ Cancel ]  [ Turn on ]
```

The language line is the one warning that describes a **hard failure** rather
than a quality drop, so it does not hide behind the `See what changes` link —
it gets its own line at the same level as the others, and `Full list →`
expands the 25 in place. Nobody should download 4.3 GB and then discover their
language is missing.

Numbers are measured live via the existing `measurePlanBytes()` /
`Content-Length` machinery, not hardcoded — the CPU plan is 0.67 GB, not 1.26.
The figures above are the WebGPU plan; sources in §6.

### 5.3 On mobile

Detected by the existing `detectCapabilities()` (`isIOS`, `isMobile`). The
`Turn on` button is replaced with `Turn on anyway`, and the panel leads with:

> **This will almost certainly not work on this phone.** Local mode needs
> ~4 GB of storage, ~2 GB of free memory and a browser with WebGPU. On
> iPhone and iPad, Safari gives a tab far less memory than that and the tab
> will likely crash. Use a desktop, or leave this off.

Not blocked outright — the existing capability warnings already take the
"warn, don't forbid" line, and a crashed tab falls back to the cloud with
consent anyway.

### 5.4 What the toggle does and does not do

- Affects **new meetings only**. Nothing already recorded changes state.
- Turning it **off** leaves existing local meetings local. The history list
  keeps showing them with their `🔒` badge; a one-line note appears above the
  list: *"You still have N meetings stored only in this browser."*
- Turning it **on** does not start a download. Downloads start when a local
  meeting first needs the model. (Offer a `Download now` link in the popover
  for people who want to prepare before a meeting.)
- Persisted in `localStorage` under `meetscribe_local_mode`, cross-tab synced
  via the `storage` event, exactly as `pref.ts` does today.

---

## 6. What is stored where

Per meeting. "Server" = your VPS, the SQLite DB and `AUDIO_DIR`. "Cloud AI" =
the Anthropic API.

| Data | Cloud meeting | Local meeting | Local, while published |
|---|---|---|---|
| Raw audio chunks (`.webm`) | Server disk, kept until deleted | **Never leaves the browser**; held in memory during the recording, discarded at finalize | Not uploaded |
| Decoded PCM | Server RAM during transcription | Browser RAM only | — |
| Chunk transcripts + word timings | Server DB (`meetingchunk`) | Browser IndexedDB | Not uploaded |
| Full transcript | Server DB, **sent to Anthropic** | Browser IndexedDB, sent nowhere | Copy on server for the expiry window |
| Summary markdown | Server DB, **written by Anthropic** | Browser IndexedDB, written by Qwen3-4B on your GPU | Copy on server for the expiry window |
| Title | Generated by Anthropic, server DB | Generated by Qwen3-4B locally | Copy on server |
| Context notes you type | Server DB, **sent to Anthropic** | Browser IndexedDB | Copy on server |
| Summary length / language settings | Server DB | Browser IndexedDB | Copy on server |
| Duration, word count, speaker count | Server DB | Browser IndexedDB | Copy on server |
| Your browser's user-agent | Server DB (`meeting.user_agent`) | Not recorded | Recorded for the published copy |
| Timezone | Server DB | Browser | Copy on server |
| Meeting list (id, title, date) | Browser `localStorage` **and** server DB | Browser only | Both |
| Tags, favourites | Browser `localStorage` (already) | Browser `localStorage` | Browser only — **not** published |
| Feedback (👍/👎, suggestions) | Server DB, linked to the meeting | Not available (§7) | Available while published |
| Model weights | n/a | Downloaded from Hugging Face + your server, cached by the browser. This is a **download**, and carries no meeting data. | — |
| Dashboard/analytics counts | Included | **Invisible** — local meetings are not counted anywhere | Counted while published |

Two things to be explicit about, because they are easy to get wrong:

1. **Speaker-diarization model files are served by your own backend**
   (`GET /api/models/{segmentation,embedding}`), because GitHub Releases send
   no CORS headers. A local meeting therefore still makes requests to your
   server — for ~30 MB of weights, once. No audio, no text, no meeting ID.
2. **Published means plaintext on the server.** For the length of the window,
   a published local meeting is technically indistinguishable from a cloud
   meeting minus the audio. §2.5 is the fix.

---

## 7. What you lose in local mode

Ordered by how much it will actually bite.

| You lose | Because | Severity |
|---|---|---|
| **Claude-quality summaries** | Qwen3-4B q4f16 replaces `claude-sonnet-5`. Expect shorter, flatter output, weaker structure on long transcripts, and a noticeable drop outside English. `minutes` mode (the most structured template) suffers most. | High |
| **Most of the world's languages** | Parakeet TDT 0.6B v3 covers 25 European languages. Whisper covers ~99. Japanese, Chinese, Arabic, Hindi, Korean and every other non-European language **will not transcribe** locally. | High — this is a hard wall, not a quality drop |
| **Access from anywhere** | A local meeting lives in one browser profile on one machine. No other device, no other browser, no incognito window. Clearing site data destroys it. | High |
| **Re-diarization / "find speakers"** | Needs the original audio, which was never uploaded and is discarded after finalize. The `can_rediarize` flag is permanently false. | Medium |
| **Summary translation** | `POST /translate` is a Claude call. Qwen3-4B can translate, badly and slowly. Recommendation: hide the control for local meetings rather than ship a worse silent path. | Medium |
| **Fast handling of uploaded files** | An uploaded file is currently transcribed server-side in minutes. In local mode the browser does it — roughly real-time-ish on a good GPU, far slower on a CPU. A 2-hour file is a 2-hour tab you must not close. | Medium |
| **Claude-written titles** | Replaced by a second, very short Qwen3 generation once the summary finishes (the model is already loaded, so it costs ~1 s). Fallback if that fails: `Meeting · 10 Sep, 14:30`. | Low |
| **Feedback and the dashboard** | `POST /api/feedback` needs a meeting row. Local meetings have none, so the 👍/👎 row is hidden. Feature suggestions stay available — they can post with a null meeting id. | Low |
| **Everything Anthropic-shaped later** | Any future feature that calls an LLM server-side is cloud-only by construction. Worth stating in the doc now so it isn't a surprise. | — |

---

## 8. Speed, and why your Mac is faster than your PC

Measured on one 1.2k-token meeting, same prompt, q4f16 throughout (numbers
already recorded in `frontend/src/ondevice/summary/models.ts`):

| Machine | Prefill (reading the transcript) | Decode (writing the summary) |
|---|---|---|
| Apple M-series (Metal) | 255 tok/s | **35.9 tok/s** |
| RTX 5070 laptop (Windows, D3D12) | 144 tok/s | **29.8 tok/s** |
| Intel Arc iGPU (Windows, D3D12) | 186 tok/s | **8.8 tok/s** |

User-facing note, to sit under the summary model line in the toggle popover:

> **Apple Silicon is currently much faster than Windows here, and that is a
> browser limitation rather than a hardware one.** On macOS the browser reaches
> the GPU through Metal and gets the fast matrix path. On Windows it goes
> through D3D12, where Chrome's GPU layer has no subgroup-matrix kernels — the
> ones that reach the tensor cores — so a laptop RTX card writes a summary at
> roughly a tenth of what the silicon could do. On Windows, also enable
> `chrome://flags/#force-high-performance-gpu`, or Chrome will quietly run this
> on the integrated GPU no matter what the page asks for.

That flag note is not optional trivia: without it, a Windows laptop with a
discrete GPU lands in the 8.8 tok/s row rather than the 29.8 one.

### Download sizes, measured

Fetched from the Hugging Face API on 2026-09-10:

| Component | Files | Size |
|---|---|---|
| Parakeet, WebGPU plan | `encoder-model.fp16.onnx` 1239.0 MB + `decoder_joint-model.int8.onnx` 18.2 MB + `vocab.txt` | **1.26 GB** |
| Parakeet, CPU plan | `encoder-model.int8.onnx` 652.2 MB + decoder + vocab | **0.67 GB** |
| Diarization | campplus 28.3 MB + pyannote segmentation int8 | **~30 MB** |
| Summary, `webgpu/Qwen3-4B-ONNX` | `model_q4f16.onnx` 1119.0 MB + `.onnx_data` 1932.7 MB + tokenizer | **3.05 GB** |
| Summary, `onnx-community/Qwen3-4B-ONNX` | `model_q4f16.onnx` 59.8 MB + `.onnx_data` 2096.0 MB + `.onnx_data_1` 677.2 MB | **2.83 GB** |

**Full local mode, first run, WebGPU machine: ~4.3 GB.** The changelog line in
`InfoPanel.tsx` currently says "about 0.7 GB" for transcription — that is the
CPU plan; the plan most people get is 1.26 GB. Worth correcting in the same PR.

---

## 9. Every path a user can take

### 9.1 Creating

| # | Situation | Behaviour |
|---|---|---|
| A | Local mode off, record | Unchanged from today. Cloud meeting. |
| B | Local mode on, record | Client mints the UUID. No `POST /api/meetings`, no chunk upload. Parakeet transcribes live; diarization at stop; Qwen3 summarizes; everything written to IndexedDB. Badge `🔒`. |
| C | Local mode on, upload a file | Same, but warn before starting: *"This will be processed here, which takes far longer than on the server, and the tab must stay open. About N minutes for this file."* Offer `Process in the cloud instead` as an equal-weight button. |
| D | Local mode on, device can't run it | The toggle already warned (§5.3). If the model fails to load, go to E. |
| E | Local run fails during transcription | Recording is already stopped and the audio is still in memory. Prompt: *"Local transcription failed: {reason}. Send this recording to the server to finish it? Your audio and transcript will leave this device."* → `[ Send to cloud ] [ Try again ] [ Discard meeting ]`. Only `Send to cloud` uploads anything. This is the existing `requestServerFallback` path, made consent-gated. |
| F | Local run fails during summarization | Transcript exists locally and is safe. Prompt: *"The summary model didn't run: {reason}. Summarize in the cloud instead? Your transcript — not your audio — would be uploaded to our server and sent to Anthropic."* → `[ Summarize in the cloud ] [ Try again ] [ Keep the transcript only ]`. The third option is a real, supported end state: a local meeting with a transcript and no summary. |
| G | Tab closed mid-run | Chunks transcribed so far are in IndexedDB. On reopening, the meeting shows `Unfinished · transcript only` with `[ Resume summarizing here ]`. Audio is gone, so re-transcription is impossible either way. |

### 9.2 Sharing a local meeting

| # | Situation | Behaviour |
|---|---|---|
| H | Owner clicks 🔗 Share | Popover (§2.3). Choosing a duration uploads title, transcript, summary, context, settings, duration, speaker count — **not audio, not tags, not favourites**. Server row is created with `origin='published'`, `expires_at`, and `can_rediarize=false`. Badge → `🔗 Shared · 6d left`. |
| I | Recipient opens the link | **Always asked, never automatic** — regardless of their own local mode setting. A banner they cannot miss offers to save a copy, and states the deadline and what happens if they don't. Exact copy in §9.2b. |
| J | Recipient dismisses without saving | The banner collapses to a single quiet line that stays for the whole session: *"Not saved — gone after 17 Sep. `Save Copy`"*. Never fully disappears while the meeting is unsaved. |
| K | Recipient re-shares | Their copy is a distinct meeting with its own ID. They can publish it; it does not touch the original. Say so on the sheet: *"You're sharing your own copy."* |
| L | Recipient edits their copy | Local to them. Nothing propagates. The `Shared` badge on the owner's side never implies a live document. |
| M | Expiry passes | A backend sweep deletes the server row and leaves a tombstone (§10). Owner's badge silently reverts to `🔒`. Copies already taken are untouched. |
| N | Owner clicks `Stop sharing now` | Same as M, immediately. Confirm first: *"Anyone with the link loses access. People who already opened it keep their copy."* |
| O | Owner deletes a published local meeting | Deletes the local record **and** unpublishes. One confirm covering both. |
| P | Owner picks `Never expire` | Server row has `expires_at = NULL`. The badge becomes `☁️ Cloud` and the meeting behaves as a cloud meeting for readers. The browser copy stays and stays authoritative; the meeting is now in both places, which the badge shows as `☁️ Cloud · also on this device`. |

### 9.2b The save prompt, word for word

Two constraints pull against each other: it must be **impossible to miss**,
and it must be **three seconds of reading**. The Apple convention resolves it —
a short bold line that states the consequence, one sentence of body, and a
button labelled with the verb it performs. Never `OK`. Never a paragraph.

Sticky banner, top of the summary page, amber (`#f59e0b`, the paused-recording
colour — a clock is ticking). Does not scroll away, does not auto-dismiss:

```
┌──────────────────────────────────────────────────────────────┐
│ 🔗  This copy disappears on 17 Sep                           │
│     Save it and it's yours for good.        [ Save Copy ]  × │
└──────────────────────────────────────────────────────────────┘
```

- **Line 1** is the consequence, with a real date. Not "in 6 days" — Proton
  Drive is right about this, a date is unambiguous and a duration is not.
- **Line 2** is the payoff, not the mechanism. Not "stores it in your browser's
  IndexedDB."
- **The button is the verb.** `Save Copy`, not `OK`, not `Got it`.
- **`×` collapses, it does not dismiss.** Row J.

Under a minute left, the same banner switches to red and counts: `🔗 This copy
disappears in 4 minutes`.

After saving, it collapses to one quiet line for the rest of the session, then
never appears again:

```
✅  Saved to this device. Yours to keep.
```

If they leave without saving and come back after expiry, they get the §10
tombstone screen — which is why this banner has to earn its noticeability now.
The equivalent for the last 60 seconds is the only place a modal is justified.

### 9.3 Making a cloud meeting private

| # | Situation | Behaviour |
|---|---|---|
| Q | Owner clicks `Make private` on a cloud meeting | Confirm, with the consequences spelled out — see below. Then: download the full record into IndexedDB, verify it landed, `DELETE` the server row, write the tombstone. Badge → `🔒`. |
| R | The meeting is still processing | Blocked. *"Wait until the summary is finished."* Converting mid-pipeline would strand a server task writing to a deleted row. |
| S | Conversion fails halfway | The delete only fires after the local write is confirmed. A failure before that leaves the cloud meeting untouched; a failure after leaves a local copy and an orphaned cloud row, which the user can retry. Never delete first. |
| T | Someone else opens it afterwards | §10. |

Confirmation copy:

> **Make this meeting private?**
> It will be copied into this browser and removed from the server.
>
> - **Anyone you shared the link with loses access.** People who already
>   opened it will be told it was made private, and will get their own copy
>   if their browser still has one.
> - The original audio is deleted from the server, so speakers can never be
>   re-identified for this meeting.
> - It will exist **only in this browser**. Clearing site data deletes it.
>   It will not be on your phone or your other computer.
>
> `[ Cancel ]  [ Make private ]`

### 9.4 Living with it

| # | Situation | Behaviour |
|---|---|---|
| U | Local mode turned off, local meetings exist | They stay local and stay listed. Note above the history list: *"N meetings are stored only in this browser."* |
| V | Same user, second device | Local meetings are absent. The history list shows only cloud meetings, because `POST /api/meetings/sync` is driven by the local ID list. No error, no ghost rows. |
| W | Site data cleared | Local meetings are gone, unrecoverably, along with the ~4 GB model cache. Warned at opt-in (§5.2) and in the export affordance. |
| X | Regenerate a local summary at a different length | Runs locally. If the model was evicted from cache it re-downloads; say so before starting. |
| Y | Translate a local meeting | Control hidden. Tooltip: *"Translation runs in the cloud. Share this meeting or keep it in the cloud to use it."* |
| Z | Find speakers on a local meeting | Hidden — the audio is gone. Same for cloud meetings whose audio was pruned, which the existing `can_rediarize` flag already handles. |
| AA | Feedback on a local meeting | 👍/👎 hidden. Feature-suggestion box stays, posting with a null meeting ID. |
| AB | Storage pressure | Browsers evict non-persisted origins. Call `navigator.storage.persist()` when local mode is turned on, and show the result: *"Your browser has agreed to keep these meetings"* / *"Your browser may delete these if it runs low on space — export anything important."* |

---

## 10. Telling people their access was revoked

The ask: *"if they already opened this meeting before, they should be notified
as soon as they open it that the meeting was made local, and that they now have
a local version."*

**Tombstones.** `DELETE /api/meetings/{mid}` and the expiry sweep stop hard-
deleting the row's identity. They write a small `MeetingTombstone` row —
`id`, `title`, `started_at`, `removed_at`, `reason` (`'made_private' |
'expired' | 'deleted'`) — and delete everything else: audio, chunks,
transcript, summary, feedback, sections.

- `GET /api/meetings/{mid}` returns **410 Gone** with that metadata, instead of
  404 with nothing.
- `POST /api/meetings/sync` returns those IDs with `status: 'gone'`, so history
  lists mark them without anyone opening them.
- Tombstones are swept after 90 days; after that it is a plain 404 again.

What the viewer sees on opening a 410:

**If their browser has a cached copy** — and it usually will, because
`summaryCache.ts` already stores the summary and transcript of every meeting
they open — the copy is promoted to a real local meeting and:

> **This meeting was made private.**
> Whoever recorded it removed it from the server on 10 Sep. You still have
> the copy your browser saved on 3 Sep, and it's now stored on this device as
> your own. `[ Got it ]`

**If they have no copy:**

> **This meeting is no longer available.**
> "Q3 planning" was removed from the server on 10 Sep by whoever recorded it.
> Your browser doesn't have a saved copy. `[ Back ]`

Distinguish the wording by `reason`: `'expired'` says *"The shared link
expired on 10 Sep"* — that is a schedule running out, not someone revoking
access, and reads very differently.

---

## 11. Ownership, without accounts

Publishing needs an owner, or any link-holder could unpublish or extend
someone else's meeting.

**Owner token.** When a meeting is created (cloud or local), the browser mints
a random 32-byte token, stores it beside the meeting, and — for anything that
reaches the server — sends `sha256(token)` as `owner_hash`. The server stores
the hash. `unpublish`, `extend`, `delete` and `make private` require the
matching token. Reading requires nothing, exactly as today.

Consequences worth stating:
- **Lose the browser, lose control of the published copy.** It still expires on
  schedule. `Never expire` publishes are the ones where this bites, which is a
  further reason not to make `Never` the default.
- **This closes a live hole.** Today `DELETE /api/meetings/{mid}` is
  unauthenticated: anyone with a shared link can permanently delete someone
  else's meeting and its audio. Rolling the token out to existing meetings is
  not possible retroactively, but new meetings get it, and the endpoint can
  require it whenever `owner_hash` is set.

---

## 12. Fallback to the cloud, and consent

One rule, no exceptions: **nothing leaves the device without an explicit
per-event click.** Not a preference set once, not a checkbox in the opt-in
panel, not a timeout that gives up and uploads.

- Every fallback prompt names exactly what would be uploaded (audio vs
  transcript) and where it then goes (your server, and Anthropic).
- Declining is always a complete, supported outcome — a transcript with no
  summary is a real thing the app can show and export.
- If the tab dies before the user can answer, nothing was uploaded, and the
  meeting reopens in the `Unfinished` state from row G with the same prompt.
- A meeting that falls back becomes a **cloud meeting** and its badge changes.
  Never leave a `🔒` badge on something the server processed.

---

## 12b. Bug: diarization re-runs on every summary change

Unrelated to local mode, found while tracing this. **PR 0.**

### What happens

Change a meeting's summary length, language, or context → `POST /regenerate`
clears `done`/`summary_markdown` → the next poll queues
`tasks.generate_summary_only` → that calls `finalize_meeting_processing`, whose
diarization gate is:

```python
if plain_transcript and diarization.is_enabled() and not mtg.client_processing:
```

`backend/app/tasks.py:434`. There is **no check on `mtg.diarization_attempted`**.
So every settings change on a server-processed meeting re-decodes all of the
audio and re-runs segmentation, embedding and clustering from scratch. On an
hour-long meeting that is minutes of CPU per click, and it is why changing
summary length feels so much slower than it should.

### Why it isn't a one-line fix

`finalize_meeting_processing` starts by calling `rebuild_full_transcript`,
which reassembles the transcript from the **unlabelled** chunk texts and throws
away the labelled `mtg.transcript_text`. So diarization is not gratuitous —
it's the only thing putting the speaker labels back. Skip it naively and every
regenerate silently strips the speaker names out of the summary.

Note that the on-device path already does the right thing three lines below,
under `if mtg.client_processing:` — it reuses `mtg.transcript_text` when it
exists. The fix generalises that.

### The fix

Add an explicit parameter rather than inferring intent:

```python
def finalize_meeting_processing(db, mtg, *, rediarize: bool = False) -> None:
```

- **Reuse** `mtg.transcript_text` whenever it is non-empty and
  `mtg.diarization_attempted` is set — the labelled transcript is already the
  best one available. Summarize from it, skip the audio entirely.
- **Diarize** only when `rediarize=True`, or when the meeting has never been
  through the pipeline (`not mtg.diarization_attempted`).
- `rediarize_meeting_in_worker` passes `rediarize=True`. That is the one path
  that genuinely wants the audio re-processed, and it stays untouched.

`processing_total` should then be 1 for a plain regenerate rather than 2, so
the UI stops promising a diarization step it is no longer running.

### Worth checking in the same pass

`generate_summary_only` retries three times with `time.sleep(60)` inside the
thread-pool worker. With diarization removed from that path the retries get
much cheaper, but a 60-second sleep still holds an executor thread hostage.

---

## 13. What gets removed

The comparison feature did its job and is now in the way: it exists to show a
local summary *next to* a cloud one, which is the opposite of the story local
mode tells.

**Delete:**
- `frontend/src/components/SummaryVersions.tsx` — tabs, side-by-side view,
  verdict buttons.
- `frontend/src/components/LocalSummaryPanel.tsx` — replaced by a much smaller
  progress card, since the run is now the summary rather than an experiment
  next to one.
- `frontend/src/components/LocalSummaryOptIn.tsx` — folded into the toggle.
- The `view === 'compare'` branch in `Summary.tsx`, including the 1400 px
  layout widening.
- Backend: `LocalSummaryRun`, `LocalSummaryRunCreate`,
  `LocalSummaryVerdictUpdate`, the three `/local-summaries` endpoints,
  `backend/utils/add_local_summary_table.py`, and the `localsummaryrun` table
  itself. The accumulated rows are dropped with it — the comparison has been
  made and the data has served its purpose.
- The `meetscribe_local_summary_thinking` preference. Thinking mode is a
  research knob; it triples time-to-first-token for no summary benefit.

**Keep, folded into Local mode:**
- `useOnDevice`, the Parakeet and diarization workers, `hub.ts`,
  `capabilities.ts` — unchanged, just driven by one switch.
- The GPU/CPU plan chooser, demoted to an `Advanced` disclosure inside the
  toggle popover. `auto` stays the default and almost nobody should touch it.
- `OnDeviceStats` on the summary page — it is genuinely useful for explaining
  why a run took eleven minutes.

**New dependency this creates:** `useLocalSummary` currently gets its prompt
from `GET /api/meetings/{mid}/summary-prompt`, which requires the transcript to
already be on the server. A local meeting has no server row, so that call is
impossible. See §14.2.

---

## 14. Implementation surface

### 14.1 Frontend, new

| File | Job |
|---|---|
| `src/local/store.ts` | IndexedDB (`meetscribe-local`, store `meetings`). `localStorage` is a ~5 MB cap shared with the history list; a two-hour transcript with word timings will not fit. |
| `src/local/mode.ts` | The `meetscribe_local_mode` preference, cross-tab, mirroring `summary/pref.ts`. |
| `src/local/publish.ts` | Publish / extend / unpublish, owner token handling. |
| `src/local/prompt.ts` | TS port of `build_summary_prompt` (§14.2). |
| `src/components/LocalModeToggle.tsx` | Pill + popover (§5). |
| `src/components/StorageBadge.tsx` | The four badges (§3, §4). |
| `src/components/SharePopover.tsx` | The share sheet (§2.3). |
| `src/components/TombstoneNotice.tsx` | The 410 screen (§10). |

Modified: `useRecording` (skip meeting creation and chunk upload in local mode),
`useMeetingSummary` (read from IndexedDB when the meeting is local; every
server call in it needs a local branch — there are nine), `HistoryList`,
`Record.tsx`, `Summary.tsx`, `InfoPanel.tsx`.

### 14.2 The prompt problem

`build_summary_prompt` lives in `backend/app/tasks.py` and is deliberately the
single source of truth. A local meeting cannot call it.

**Do not duplicate the templates in TypeScript.** Instead add
`GET /api/prompt-templates` returning the four templates from `prompts.py`
verbatim plus `SPEAKER_NOTE`, and format them client-side. The request carries
no meeting data, so it does not violate anything; the templates are bundled at
build time as an offline fallback. Placeholders are `{target_language}`,
`{context_section}`, `{full_transcript}`, `{date}`, `{duration}` — trivial to
interpolate.

Two pieces still need porting:
- `looks_diarized` — one regex, `/^Speaker \d+:/m`. Trivial.
- `detect_language_local` — Python `langdetect`. Use `franc-min` (~40 KB) and
  map ISO 639-3 back onto the same `LANG_MAP` names. Local and cloud may
  occasionally disagree on the detected language of the same transcript; that
  is acceptable and should be noted in a comment so nobody hunts it as a bug.

### 14.3 Backend

New:
- `MeetingTombstone` table + migration in `backend/utils/`, matching the
  existing `add_*.py` convention.
- `Meeting.origin` (`'recorded' | 'published'`), `Meeting.expires_at`,
  `Meeting.owner_hash`.
- `POST /api/meetings/{mid}/publish` — create-or-extend, requires owner token.
- `DELETE /api/meetings/{mid}/publish` — unpublish, requires owner token.
- `GET /api/meetings/{mid}/export` — the full record for `Make private`.
- `GET /api/prompt-templates`.
- An expiry sweep in the existing `cleanup_stuck_meetings` scheduler slot.

Changed: `GET /api/meetings/{mid}` returns 410 for tombstones;
`/api/meetings/sync` reports `status: 'gone'`; `DELETE /api/meetings/{mid}`
writes a tombstone and honours `owner_hash`. A published meeting must never be
queued for transcription or diarization — it arrives finished, and
`can_rediarize` is false because no audio came with it.

### 14.4 Order within each PR

**PR 0** — the diarization fix (§12b). Independent, ship first, it makes every
regenerate in the rest of this work faster to test.

**PR 1**
1. IndexedDB store, `local/mode.ts`, the toggle, the two-state badge. Local
   meetings that can be created and read, nothing else.
2. Prompt templates endpoint + TS formatter — this unblocks local
   summarization by removing the `/summary-prompt` dependency.
3. The local pipeline end to end: transcribe → diarize → summarize → title.
4. Consent-gated fallback (§12), replacing the current silent
   `requestServerFallback`.
5. `Export as Markdown` — the only way out of a local meeting until PR 2.
6. Remove the comparison feature and the old toggles; rewrite the InfoPanel
   changelog and correct the 0.7 GB figure (§8).

**PR 2**
1. Tombstones + the 410 screen. **First**, before any conversion feature —
   it is what makes conversion non-destructive for readers, and shipping a
   conversion without it strands people on a 404.
2. Owner token, and the `DELETE` hole it closes (§11).
3. Publish / share sheet / expiry sweep, plus the two extra badge states.
4. The recipient save prompt (§9.2b).
5. `Make private`.

**Later** — encrypted publish (§2.5), if it earns its place.

---

## 15. Model hosting and the Qwen download

### What was measured, 2026-09-10

- `webgpu/Qwen3-4B-ONNX` — 35 all-time downloads, Xet not enabled. q4f16 =
  1119.0 MB + 1932.7 MB = **3.05 GB**, one external-data file.
- `onnx-community/Qwen3-4B-ONNX` — 552 downloads, Xet not enabled. q4f16 =
  59.8 + 2096.0 + 677.2 = **2.83 GB**, two external-data files.
- Throughput from this machine, 40 MB ranged GET off each repo:
  **9.2 MB/s** and **9.9 MB/s** respectively.

### What that means

**Switching repos will not fix it.** The two are within 7% of each other from
here, which is what you'd expect — same origin, same CDN, neither Xet-enabled.
If you are seeing far worse than ~9 MB/s, that is regional routing or
throttling on your side of the link, not the repo.

**Forking to your own Hugging Face account will not help either.** Same
infrastructure, and a fresh fork starts at zero downloads, so it is even less
likely to be warm in an edge cache. Enabling Xet on a repo helps the `hf` CLI's
chunked transfer; a browser `fetch()` does not use it. Not the fix.

**Self-hosting behind a CDN is the fix, and this repo is already built for
it.** `VITE_PARAKEET_MODEL_BASE` + `scripts/serve_models.mjs` are exactly this
pattern for Parakeet, and `scripts/serve_models.mjs` already documents the three
headers a naive static host gets wrong (`Access-Control-Allow-Origin`,
`Cross-Origin-Resource-Policy`, `Accept-Ranges`) — mandatory here, because
`nginx.conf` sets `Cross-Origin-Embedder-Policy: require-corp`.

Recommended: **Cloudflare R2**, because egress is free and 3 GB × every new
user is otherwise a real bill. Backblaze B2 fronted by Cloudflare is the
equivalent. Add `VITE_SUMMARY_MODEL_BASE` alongside the Parakeet one, mirror
the seven q4f16 files, set `Cache-Control: public, max-age=31536000, immutable`
(as `GET /api/models/{name}` already does), and leave Hugging Face configured
as the fallback base.

### One correction to the code

The comment in `frontend/src/ondevice/summary/models.ts` says the `webgpu/` org
was chosen "because the repo is 3 GB rather than the 20 GB every-dtype one
under `onnx-community/`." That reasoning does not hold: transformers.js fetches
only `onnx/model_{dtype}.onnx` and its external data, so a q4f16 load from
`onnx-community` pulls 2.83 GB — **220 MB less than the `webgpu/` repo**, not
17 GB more. The repo total is irrelevant to what the browser downloads. If you
mirror to R2, mirror the `onnx-community` files and set
`externalDataChunks: 2`.

---

## 16. Decisions taken, and what is still open

### Settled (2026-09-10)

| Question | Decision |
|---|---|
| Keep `Never expire`? | **Yes.** It stays as one chip in the duration row, and it is the migration path from how the app works today. |
| Auto-copy for recipients? | **No — always ask.** Regardless of the recipient's own local mode setting. The prompt names the date, says what happens if they skip it, and is deliberately hard to miss. §9.2b. |
| Optional local audio retention? | **No.** On-device transcription is good enough that re-transcription is not worth hundreds of MB per meeting. Audio is discarded at finalize, always. |
| Warn about Parakeet's 25 languages? | **Yes, on the toggle itself**, at the same level as the other warnings — it is a hard failure, not a quality drop. §5.2. |
| What happens to the `LocalSummaryRun` eval data? | **Dropped with the table.** §13. |
| What if `navigator.storage.persist()` is refused? | **Refuse to enable Local mode.** Storing someone's only copy of a meeting in a bucket the browser may evict without warning, while telling them it is safe, is worse than not offering the feature. The message names the usual remedies (visit again, install the app). |

### Still open

1. **Encrypted publish (§2.5)** — worth it, or is a 7-day plaintext window
   acceptable given that the alternative is a link that dies if it loses its
   fragment? Deferred to after PR 2 either way.
2. **Local translation** — §7 recommends hiding the control rather than
   shipping a worse silent path. Confirm that is the call, or offer it clearly
   labelled as lower quality?
