"""
Long Markdown templates for the summary generator.

Keeping them in a dedicated module keeps main.py tidy.
"""

TEMPLATES = """
1. General Meeting Summary Template
# Meeting Summary

**Type:** [General Meeting / Consultation / Project Meeting / Project Presentation]

**Date:** [YYYY-MM-DD, if available]
**Time:** [HH:MM - HH:MM, if available]
**Location:** [Physical/Virtual Location, if available]

## Participants (if available)
- [Name 1, if available]
- [Name 2, if available]

## Agenda/Objectives (if available)
- [Objective 1, if available]
- [Objective 2, if available]

## Key Discussion Points
- [Topic 1]
  - [Summary/Details]
- [Topic 2]
  - [Summary/Details]

## Decisions Made (if available)
- [Decision 1, if available]
- [Decision 2, if available]

## Action Items (if available)
- Task: [Task 1, if available]; Owner: [Person, if available]; Deadline: [Date, if available]
- Task: [Task 2, if available]; Owner: [Person, if available]; Deadline: [Date, if available]

## Next Steps (if available)
- [Next Step 1, if available]
- [Next Step 2, if available]

## Additional Notes
[Any other relevant information or context]

2. Consultation Session Template
# Consultation Session Summary

**Type:** Consultation

**Date:** [YYYY-MM-DD, if available]
**Time:** [HH:MM - HH:MM, if available]
**Client:** [Client Name, if available]

## Attendees (if available)
- [Consultant Name, if available]
- [Client Name/Representative, if available]
- [Other Participants, if available]

## Topics Discussed
- [Topic 1]
  - [Summary]
- [Topic 2]
  - [Summary]

## Recommendations (if available)
- [Recommendation 1, if available]
- [Recommendation 2, if available]

## Follow-Up Actions (if available)
- [Action 1, if available]
- [Action 2, if available]

## Next Steps (if available)
- [Next Step 1, if available]
- [Next Step 2, if available]

3. Project Meeting Template
# Project Meeting Summary

**Type:** Project Meeting

**Date:** [YYYY-MM-DD, if available]
**Time:** [HH:MM - HH:MM, if available]
**Project:** [Project Name, if available]

## Participants (if available)
- [Team Member 1, if available]
- [Team Member 2, if available]

## Agenda (if available)
- [Agenda Item 1, if available]
- [Agenda Item 2, if available]

## Progress Updates
- [Update 1]
- [Update 2]

## Issues/Risks Identified (if available)
- [Issue/Risk 1, if available]
- [Issue/Risk 2, if available]

## Decisions (if available)
- [Decision 1, if available]
- [Decision 2, if available]

## Action Items (if available)
- Task: [Task 1, if available]; Owner: [Person, if available]; Deadline: [Date, if available]
- Task: [Task 2, if available]; Owner: [Person, if available]; Deadline: [Date, if available]

## Next Steps (if available)
- [Next Step 1, if available]
- [Next Step 2, if available]

4. Project Presentation Summary Template
# Project Presentation Summary

**Type:** Project Presentation

**Date:** [YYYY-MM-DD, if available]
**Time:** [HH:MM - HH:MM, if available]
**Presenter:** [Presenter Name, if available]

## Attendees (if available)
- [Attendee 1, if available]
- [Attendee 2, if available]

## Presentation Topics
- [Topic 1]
  - [Key Points]
- [Topic 2]
  - [Key Points]

## Questions & Answers (if available)
- **Q:** [Question, if available]
  - **A:** [Answer, if available]
- **Q:** [Question, if available]
  - **A:** [Answer, if available]

## Feedback/Next Steps (if available)
- [Feedback 1, if available]
- [Next Step 1, if available]

5. Brainstorming Session Template
# Brainstorming Session Summary

**Type:** Brainstorming

**Date:** [YYYY-MM-DD, if available]
**Time:** [HH:MM - HH:MM, if available]

## Participants (if available)
- [Participant 1, if available]
- [Participant 2, if available]

## Goals (if available)
- [Goal 1, if available]
- [Goal 2, if available]

## Ideas Generated
- [Idea 1]
- [Idea 2]

## Top Ideas (Voted/Selected, if available)
- [Top Idea 1, if available]
- [Top Idea 2, if available]

## Next Steps (if available)
- [Next Step 1, if available]
- [Next Step 2, if available]

6. Retrospective/Review Meeting Template
# Retrospective Meeting Summary

**Type:** Retrospective/Review

**Date:** [YYYY-MM-DD, if available]
**Time:** [HH:MM - HH:MM, if available]
**Project/Team:** [Name, if available]

## Participants (if available)
- [Participant 1, if available]
- [Participant 2, if available]

## What Went Well
- [Positive 1]
- [Positive 2]

## What Could Be Improved
- [Improvement 1]
- [Improvement 2]

## Action Items (if available)
- [Action 1, if available]
- [Action 2, if available]

## Next Steps (if available)
- [Next Step 1, if available]
- [Next Step 2, if available]
"""
