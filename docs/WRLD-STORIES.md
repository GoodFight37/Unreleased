# Planned: WRLD videos for stories and TikTok

Status: product direction, not an implemented video-export feature. Updated November 17, 2026.

The starting point is the existing full-screen WRLD listening view: large artwork,
track information, an ambient background and synchronized lyrics that move with
the music. Preserve that listening experience. Its animated lyrics already come
from the original Unreleased player; this fork should build on them.

The next project is to make that existing full-screen experience worth sharing as
a **video**. Keep its current landscape composition as the reference. Alternative
layouts, including a vertical story or TikTok format, are optional and must not
take over or degrade the regular full-screen view. A separate Share Studio workflow is on hold.
Integration with LyricsEdit has not been decided.

## Direction to explore

- Improve the existing full-screen composition first; an optional 9:16 layout can
  be explored alongside it, without forcing a format change.
- Lyrics and word highlighting timed to the audio, with readable, restrained motion.
- Juice WRLD artwork and album-inspired atmosphere, especially Legends Never Die,
  with visual proposals reviewed before introducing a new logo or visual identity.
- A clean presentation while recording: controls can disappear and reappear without
  losing access to playback or Back.
- A short, clearly selected excerpt. Compare a simple screen-recording experience
  with direct video export before deciding which workflow to build.

The target is an edit someone wants to post, rather than a static image of a
music player. Keep the process simple enough for a listener who does not use a
video editor. Avoid a wall of visualizer settings or disconnected templates.

## Questions for a future audit

1. Which parts of the current WRLD layout, lyric timing and animation can be reused?
2. How can the existing landscape view remain intact while optional layouts handle
   long titles, multiple lyric lengths and safe space for platform overlays?
3. How can preview, playback and any future encoding share timing so audio and
   lyrics stay aligned, including a selected excerpt's start and end?
4. How should missing lyrics, line-only timing, word timing and ad-libs behave?
5. Which workflow gives the cleanest result with the fewest steps, and what would
   require a separate renderer or integration with an existing editor?

Assess these against actual rendered motion and a real video with audio. Source
inspection or a still screenshot cannot establish export quality or synchronization.
The existing experimental Share Studio exports do not validate this future WRLD
workflow. Review the proposal before implementation.

## Completion criteria to agree before implementation

A shared clip, in its chosen layout, should preserve the excerpt, keep lyrics and audio aligned,
remain readable after recording, hide incidental application controls, and end
cleanly. Test the resulting video and listening view separately, including pause,
seeking and window-size changes. No video or post should be published automatically.
