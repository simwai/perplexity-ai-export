export const RAG_PROMPTS = {
  planner: (question: string) => `
Analyze: "${question}"
1. Strategy: "precise" (specific facts) or "exhaustive" (broad summary/entity history).
2. Variations: 3 semantic search phrases.
3. Hard Keywords: Identify any names, IDs, or unique technical terms for exact matching.
4. HyDE: Write 1-2 sentences that would plausibly appear in a saved answer to this question. Write as if it's content already stored, not as a reply.
Return JSON: {"strategy": "...", "queries": [], "hardKeywords": [], "hydePassage": "...", "filters": {}}
`,

  researcher: (question: string, context: string) => `
You are the Researcher. Analyze these snippets from the user's history for the question: "${question}"
Context:
${context}

Extract every specific fact, mention, date, or piece of code.
Return JSON array: [{"fact": "...", "node_id": N, "thread": "..."}]
`,

  narrator: (question: string, strategy: string, findings: string) => `
You are the Narrator. Synthesize these research findings into a cohesive, mightiest answer for: "${question}"
Strategy: ${strategy}
Findings:
${findings}

INSTRUCTIONS:
1. Provide a comprehensive, authoritative response.
2. If "exhaustive", list ALL relevant conversations and what they contributed.
3. Be specific with names and technical details.
4. Cite everything with [Find N].

ANSWER:
`,

  verifier: (question: string, answer: string) => `
Verify the answer.
Question: "${question}"
Answer: "${answer.slice(0, 500)}..."
Did I miss anything important?
Return JSON: {"status": "ok" | "missed-info", "suggestion": "..."}
`
} as const
