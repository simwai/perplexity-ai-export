export interface ExtractedFact {
  fact: string
  citations: number[]
}

export class PipelinePlan {
  constructor(
    public readonly originalQuery: string,
    public readonly hydeDocument: string,
    public readonly mode: string
  ) {}

  get searchLimit(): number {
    return this.mode === 'exhaustive' ? 50 : 20
  }
}
