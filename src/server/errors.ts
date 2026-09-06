export class GameError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}

/** Injected by the authority, never supplied by a client command. */
export interface EngineClock {
  now: number;
  uuid: () => string;
  die: () => number;
}
