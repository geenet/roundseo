/** Public-safe failure from a native intelligence collector or analysis step. */
export class IntelligenceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, options: { status?: number; code?: string } = {}) {
    super(message);
    this.name = 'IntelligenceError';
    this.status = options.status ?? 502;
    this.code = options.code ?? 'INTELLIGENCE_ERROR';
  }
}

export function publicIntelligenceError(error: unknown): IntelligenceError {
  if (error instanceof IntelligenceError) return error;
  return new IntelligenceError('RoundSEO could not complete this intelligence request.', { status: 500, code: 'INTELLIGENCE_ERROR' });
}
