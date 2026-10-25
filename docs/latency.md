# Key-to-photon latency

Measured 2026-10-25 with `tools/latency.mjs` (2 interleaved runs × 150 key
presses per arm).

## Method

- Page: `tools/latency-scene.html`. It is a three.js scene with 20k lit
  instanced cubes, redrawn every frame. A 64 px square in the top-left corner
  flips black/white on each key press. As in a game, the frame loop applies
  the key on its next frame.
- Each arm opens the page fullscreen (GameShell on a fresh profile, Chrome
  with `--start-fullscreen --app=URL`).
- `tools/latency_probe.py` presses Right-arrow through `SendInput` and
  watches the square through DXGI desktop duplication (`dxcam`). It records
  the time from the key press to the first desktop frame that shows the
  change. The gap between presses is random (60–120 ms), so presses land at
  every point of the refresh cycle.
- The numbers include the OS input path, the browser, rendering and DWM
  composition. They do not include the display's scan-out and pixel
  response, which are the same for every arm. Use them to compare arms, not
  as absolute key-to-eye times.

Machine: Jiahua's PC, Windows 11, NVIDIA GeForce RTX 5080 (driver
32.0.16.2101), 2560×1440 at 165 Hz. GameShell on Electron 45.0.0
(Chromium 156), Chrome 155.0.8059.85.

## Results

Median with a bootstrap 95% confidence interval, all samples of both runs.
A "miss" is a press that did not show on screen within 250 ms.

| Arm | Flags | Median ms (95% CI) | p10 / p90 ms | Run 1 / run 2 median | Misses | Frame rate |
| --- | --- | --- | --- | --- | --- | --- |
| Chrome | — | 43.4 (41.3–44.5) | 37.2 / 48.3 | 46.2 / 38.4 | 0 / 300 | 165 |
| GameShell | — | 37.9 (37.5–38.0) | 30.5 / 40.1 | 31.1 / 38.7 | 0 / 300 | 166 |
| GameShell | `--low-latency` | **23.1 (22.9–23.3)** | 16.9 / 24.4 | 22.7 / 23.5 | 0 / 300 | 166 |
| GameShell | `--uncapped-fps --low-latency` | 21.7 (20.1–22.6) | 15.6 / 27.5 | 22.1 / 20.2 | 0 / 300 | 59 |
| GameShell | `--uncapped-fps` | 220.6 (187.9–227.8) | 7.6 / 253.6 | 232.7 / 187.0 | 196 / 300 | 4200–4700 |
| Chrome | `--disable-gpu-vsync --disable-frame-rate-limit` | 165.4 (5 samples) | — | — | 295 / 300 | 2300–2400 |

Low latency was made the default after this run and then turned back to
opt-in (`--low-latency`): in a real three.js game it caused visible frame
stutter and skipped frames, which this test does not measure.

## Findings

- **`--low-latency` is the largest gain.** It is about 15 ms faster than
  plain GameShell and about 20 ms faster than Chrome, at the same 166 fps.
  Both runs gave the same result. With `desynchronized`, the canvas is
  presented without waiting for Chromium's compositor.
- **Plain GameShell compared with plain Chrome:** the pooled medians differ
  by 5.5 ms, but the run-to-run spread is as large (GameShell run 2 and Chrome
  run 2 are both about 38.5 ms). There is no clear difference. The priority
  and throttling changes in GameShell help when the machine is busy, and this
  test ran on an idle machine.
- **Do not use `--uncapped-fps` alone.** The scene rendered at more than
  4000 fps, the frame queue filled up, and two thirds of the presses took more
  than 250 ms. The few fast samples (p10 7.6 ms) show what the flag could do
  without the queue. Chrome with the same switches did worse.
- `--uncapped-fps --low-latency` is about as fast as `--low-latency` alone,
  but the page's frame loop dropped to 59 fps. It is not worth using.

## Limits

- One machine, one page, an idle system. Measure the real game before
  changing defaults.
- Desktop duplication itself may stop full-screen independent flip, which
  could hide a gain that only shows without capture.
- The test measures latency only, not frame pacing. `desynchronized`
  presentation made a real game stutter and skip frames, so it stays opt-in.
  The frame-pacing test below shows why.

# Frame pacing

Measured 2026-10-25 with `tools/pacing.mjs`: PresentMon 2.6.0 records every
present, with no screen capture. Each arm runs the same scene fullscreen for
20 s while Right-arrow is pressed at random intervals. G-SYNC Compatible was
on (MSI MAG 321UP OLED, windowed and full screen mode). Same machine as above.

| Arm | Present mode | fps | Dropped | Displayed time median / sd | CPU start to display (median) |
| --- | --- | --- | --- | --- | --- |
| Chrome | Hardware Composed: Independent Flip | 164 | 0.10% | 6.06 / 0.03 ms | 17.5 ms |
| GameShell | Hardware Composed: Independent Flip | 165 | 0.00% | 6.06 / 0.02 ms | 17.7 ms |
| GameShell `--low-latency` | Composed: Flip | 165 | 0.10% | 6.06 / 0.29 ms | 17.5 ms |

- **`--low-latency` leaves the independent-flip path.** The desynchronized
  canvas is presented through DWM composition (Composed: Flip), and the time
  each frame stays on screen varies 10 times more. In this light scene that
  is only a few dropped frames. In a heavier game, with frame times that vary,
  it gives the stutter that was seen.
- **G-SYNC does not change anything at full frame rate.** Every arm renders
  at the 165 Hz cap, so each frame stays on screen for 6.06 ms, the same as
  fixed vsync. Variable refresh only cuts latency when the frame rate stays a
  little below the refresh rate.
- PresentMon 2.6 did not time the key presses (see below) (they are sent with
  `SendInput`), so its input-to-photon column is empty. Latency comes from
  `tools/latency.mjs`.

# NVIDIA Low Latency Mode: Ultra

Measured 2026-10-25 with `tools/latency.mjs` (2 runs × 150 presses per
arm). NVIDIA Control Panel program settings for `electron.exe` and
`GameShell.exe`: Low Latency Mode = Ultra, Vertical sync = On. G-SYNC
Compatible on. Chrome (`chrome.exe`) had no program setting, so it is the
control.

| Arm | Median ms (95% CI), Ultra | Median ms before | Frame rate |
| --- | --- | --- | --- |
| Chrome (control) | 39.0 (38.7–39.1) | 43.4 | 166 |
| GameShell | 38.7 (38.6–38.8) | 37.9 | 166 |
| GameShell `--low-latency` | 23.4 (23.3–23.6) | 23.1 | 165 |

- **Ultra did not change GameShell.** The latency stayed the same, and the
  frame rate stayed at 166. With G-SYNC and vsync, Ultra should cap the frame
  rate just below the refresh rate; it did not. The setting does not seem to
  apply to Chromium's presentation (D3D11 through ANGLE and DirectComposition).
- The control moved from 43.4 to 39.0 ms between sessions, which shows the
  session-to-session spread. Compare arms within one session.
- The pacing run for this setting failed (the harness stopped when Chrome's
  DevTools port was already closed; now fixed) and was not repeated, because
  the frame rate and latency did not change.
