export class CrossEncoderReranker {
  async rerank(_query: string, passages: string[]): Promise<string[]> {
    return passages
  }
}
