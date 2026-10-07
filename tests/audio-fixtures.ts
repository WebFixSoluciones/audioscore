export function musicalAudioFixture() {
  const rate = 22050,
    duration = 5.5;
  const notes = [
    { pitch: 60, start: 0.2, end: 1.25 },
    { pitch: 64, start: 0.2, end: 1.25 },
    { pitch: 67, start: 0.2, end: 1.25 },
    { pitch: 72, start: 1.7, end: 2.55 },
    { pitch: 60, start: 2.9, end: 3.75 },
    { pitch: 67, start: 4.1, end: 5.0 },
  ];
  const samples = new Float32Array(Math.ceil(rate * duration));
  for (const note of notes) {
    const frequency = 440 * 2 ** ((note.pitch - 69) / 12);
    for (
      let i = Math.floor(note.start * rate);
      i < Math.floor(note.end * rate);
      i++
    ) {
      const time = i / rate - note.start;
      const envelope =
        Math.min(1, time / 0.012, (note.end - i / rate) / 0.08) *
        Math.exp(-time * 1.1);
      let value = 0;
      for (let harmonic = 1; harmonic <= 5; harmonic++)
        value +=
          Math.sin(2 * Math.PI * frequency * harmonic * time) / harmonic ** 1.7;
      samples[i] += 0.14 * value * Math.max(0, envelope);
    }
  }
  const pcm = Buffer.alloc(samples.length * 4);
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, index) => {
    pcm.writeFloatLE(value, index * 4);
    wav.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, value)) * 32767),
      44 + index * 2,
    );
  });
  return { pcm, wav, duration, expectedPitches: [60, 64, 67, 72] };
}
