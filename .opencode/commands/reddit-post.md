---
description: Draft a high-engagement Reddit post for the project by researching top-performing posts in the best subreddits.
argument-hint: [subreddit-override]
---

Draft a Reddit post that is optimized for likes and engagement, grounded in actual top-performing posts rather than generic “human-sounding” advice.

Parse `$ARGUMENTS`:
- If a subreddit name is provided, treat it as an override and include it in the candidate set.
- Otherwise, infer candidates from the project content.

## 1) Understand the project

Read the following files and extract the project’s actual purpose, differentiators, target users, and the problems it solves:

- `README.md`
- `CHANGELOG.md`
- `docs/*.md`
- `package.json`

Do not guess from the repo name alone. Use concrete details from these files.

## 2) Build a candidate subreddit shortlist

Create a ranked list of subreddits where this project could be shared. Rank by:
- estimated audience reach
- promotional-post permissiveness / moderation strictness

Prefer high-reach communities where self-promotion is tolerated if the post is useful. Select the top 3 candidates.

If the user supplied a subreddit override, place it first and still surface the next 2 best matches.

## 3) Research top-performing posts with Playwright MCP

For each of the 3 selected subreddits, use the Playwright MCP browser tools to inspect recent high-upvote posts. Extract the common patterns across the top posts:

- Title structure and length
- Hook style
- Body structure
- How evidence or results are shown
- How self-promotion is framed
- What anti-patterns still perform

Keep the research bounded and read-only. If a subreddit is private, modded, or otherwise inaccessible, mark it SKIPPED and move to the next candidate.

## 4) Draft the post

Using the project details and the extracted Reddit patterns, draft one post tuned for likes.

Anti-AI-slop rules:
- No generic praise
- No emoji-heavy intros
- No corporate voice
- No vague claims
- No over-formatted structure

The draft should read like a real developer sharing something they built because it actually helped.

## 5) Output

Present:
1. Ranked subreddit shortlist with rationale
2. Extracted engagement patterns from the top posts
3. The drafted post ready for the user to review and submit

Do not post to Reddit. This command only produces draft text.
