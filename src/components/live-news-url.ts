const YOUTUBE_HOME = 'https://www.youtube.com/';

/** Output boundary only: do not change or persist the supplied channel record. */
export function youtubeWatchUrl(channel: { videoId?: unknown; handle?: unknown }): string {
  const { videoId, handle } = channel;
  if (typeof videoId === 'string' && videoId.length === 11 && /^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return `${YOUTUBE_HOME}watch?v=${encodeURIComponent(videoId)}`;
  }
  if (typeof handle === 'string') {
    // Compare the whole match: JavaScript's $ also matches before a final newline.
    // Unicode letters/marks/numbers preserve configured international handles.
    const match = /^@[\p{L}\p{M}\p{N}_.-]{1,100}$/u.exec(handle);
    if (match?.[0] === handle) {
      return `${YOUTUBE_HOME}@${encodeURIComponent(handle.slice(1))}`;
    }
  }
  return YOUTUBE_HOME;
}
