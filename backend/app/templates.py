"""
Universal Markdown templates for MeetScribe
-------------------------------------------

Seven skeletons that cover almost every use-case.
The worker picks (or fuses) whichever one fits the recording,
translates the headings to the dominant language, fills in the blanks
and drops any empty section.

Square-bracket placeholders MUST be replaced with real text
—or the whole line/section must be deleted.
"""

TEMPLATES: str = """
1) General Work Meeting
# [YYYY-MM-DD] — [HH:MM–HH:MM]
## Participants
[List names / roles]
## Objective
[Goal / agenda]
## Key Discussion Points
- ...
## Decisions
- ...
## Action Items
- [Name] — [Task] (Due [Date])
## Next Steps
- ...
## Open Questions
- ...

2) Educational Lecture / Webinar
# [YYYY-MM-DD] — [HH:MM–HH:MM]
## Topic
[Title]
## Speaker(s)
[List]
## Key Concepts Explained
- ...
## Examples & Case Studies
- ...
## Q&A Highlights
- ...
## Takeaways
- ...
## Suggested Resources
- ...

3) Product Demo / Sales Call
# [YYYY-MM-DD] — [HH:MM–HH:MM]
## Participants
[Presenter][,] [Customer]
## Customer Context
[Needs / pains]
## Demo Highlights
- ...
## Questions & Objections
- ...
## Commitments & Next Steps
- ...
## Action Items
- ...

4) Agile Ceremony (Stand-up / Planning / Review / Retro)
# [YYYY-MM-DD] — [HH:MM–HH:MM]
## Ceremony Type
[Stand-up / Sprint Planning / Review / Retro]
## Attendees
[List]
## Agenda & Status
- ...
## Blockers
- ...
## Decisions
- ...
## Action Items
- ...
## Sprint Goals / Outcomes
- ...
## Retro Insights
- ...

5) Brainstorm / Workshop
# [YYYY-MM-DD] — [HH:MM–HH:MM]
## Goal
[Purpose]
## Participants
[List]
## Ideas Generated
1. ...
2. ...
3. ...
## Voting / Priorities
- ...
## Decisions
- ...
## Action Items
- ...
## Next Steps
- ...

6) Informal Conversation / Interview / Podcast
# [YYYY-MM-DD] — [HH:MM–HH:MM]
## Speakers
[List]
## Context
[Setting / background]
## Main Topics
- ...
## Notable Quotes
- “...”
## Key Takeaways
- ...
## Resources Mentioned
- ...

7) Chronological Narrative / Lore Explainer
# [YYYY-MM-DD] — [HH:MM–HH:MM]
## Topic
[Subject]
## Narrator
[Name]
## Chronological Timeline
### [Period 1 / Year]
Paragraph (3-6 sentences) describing what happened.
### [Period 2 / Year]
Paragraph ...
### [Period 3 / Year]
Paragraph ...
<!-- Repeat as many periods as needed; use sub-headings to keep flow clear -->
## Big Themes & Insights
- ...
## Why It Matters
[Relevance / practical takeaways]
## Further Reading / Watching
- ...
"""
