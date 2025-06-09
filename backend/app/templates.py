"""
Universal Markdown templates for MeetScribe
-------------------------------------------

Six compact skeletons that cover the meeting types users hit most often.
The Celery worker picks (or adapts) the one that best fits the recording,
translates the headings to the dominant language, fills in the details
and removes any section that has no supporting evidence in the transcript.

Square-bracket placeholders MUST be replaced with concrete text or the
whole line / section must be removed.
"""

TEMPLATES: str = """
1) General Work Meeting
# [YYYY-MM-DD] — [HH:MM - HH:MM]
## Participants
[List names and roles]
## Objective
[Short objective / agenda]
## Key Discussion Points
- ...
## Decisions Made
- ...
## Action Items
- [Name] — [Task] (Due: [Date])
## Next Steps
- ...
## Open Questions
- ...

2) Educational Lecture / Webinar
# [YYYY-MM-DD] — [HH:MM - HH:MM]
## Topic
[Topic title]
## Speaker(s)
[List speaker names / titles]
## Key Concepts
- ...
## Examples / Case Studies
- ...
## Q&A Highlights
- ...
## Takeaways
- ...
## Recommended Resources
- ...

3) Product Demo / Sales Call
# [YYYY-MM-DD] — [HH:MM - HH:MM]
## Participants
[Presenter / Seller][,] [Client / Prospect]
## Customer Context
[Background, pains, objectives]
## Demo Highlights
- ...
## Questions & Answers
- ...
## Objections / Concerns
- ...
## Next Steps & Commitments
- ...
## Action Items
- ...

4) Agile Ceremony (Stand-up / Planning / Review / Retro)
# [YYYY-MM-DD] — [HH:MM - HH:MM]
## Ceremony Type
[Stand-up / Sprint Planning / Review / Retrospective]
## Attendees
[List team members]
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

5) Brainstorming / Workshop
# [YYYY-MM-DD] — [HH:MM - HH:MM]
## Goal
[Overall goal]
## Participants
[List]
## Ideas Generated
1. ...
2. ...
3. ...
## Prioritisation / Votes
- ...
## Decisions
- ...
## Action Items
- ...
## Next Steps
- ...

6) Informal Conversation / Interview / Podcast
# [YYYY-MM-DD] — [HH:MM - HH:MM]
## Speakers
[List]
## Context
[Background / setting]
## Main Topics
- ...
## Memorable Quotes
- "..."
## Key Takeaways
- ...
## Resources Mentioned
- ...
"""
