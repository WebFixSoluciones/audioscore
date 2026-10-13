export type ChannelMix = {
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
};
export const defaultMix: ChannelMix = {
  volume: 0.75,
  pan: 0,
  muted: false,
  solo: false,
};
export function audibleGain(channel: ChannelMix, hasSolo: boolean) {
  return channel.muted || (hasSolo && !channel.solo) ? 0 : channel.volume;
}
// The same stereo matrix is used for browser listening and local WAV export.
export function panMatrix(pan: number) {
  const angle = (Math.abs(pan) * Math.PI) / 2;
  return pan >= 0
    ? ([Math.cos(angle), 0, Math.sin(angle), 1] as const)
    : ([1, Math.sin(angle), 0, Math.cos(angle)] as const);
}
