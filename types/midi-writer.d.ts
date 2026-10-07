// midi-writer-js 3.2.1 ships declarations behind an inaccessible exports path.
// This narrow declaration mirrors only the public API used by this application.
declare module "midi-writer-js" {
  class Track {
    addTrackName(name: string): Track;
    setTimeSignature(numerator: number, denominator: number): Track;
    setTempo(bpm: number, tick?: number): Track;
    addEvent(
      event: NoteEvent | ProgramChangeEvent | PitchBendEvent | TempoEvent,
    ): Track;
  }
  class NoteEvent {
    constructor(options: {
      pitch: number[];
      duration: string;
      startTick: number;
      velocity: number;
      channel: number;
    });
  }
  class ProgramChangeEvent {
    constructor(options: { instrument: number; channel: number });
  }
  class PitchBendEvent {
    constructor(options: { bend: number; channel: number; delta?: number });
  }
  class TempoEvent {
    constructor(options: { bpm: number; tick: number; delta: number });
  }
  const api: {
    Track: typeof Track;
    NoteEvent: typeof NoteEvent;
    ProgramChangeEvent: typeof ProgramChangeEvent;
    PitchBendEvent: typeof PitchBendEvent;
    TempoEvent: typeof TempoEvent;
    Writer: new (tracks: Track[]) => { buildFile(): Uint8Array };
  };
  export default api;
}
