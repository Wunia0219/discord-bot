export function resetAnubisIdle(state) {
  state.clearTracks();
  state.setAnimation(0, 'idle', true);
}

export function playAnubisResult(state, wins) {
  if (!wins.length) return;
  state.clearTracks();
  const action = state.setAnimation(0, 'action', false);
  // Start the return blend only after the entire action has played.
  state.addAnimation(0, 'idle', true, action.animation.duration);
}
