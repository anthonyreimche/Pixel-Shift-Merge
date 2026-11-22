# Pixel Shift Merge: behaviour

Issue anthonyreimche/SafeLight#223. A RAW decoder for pixel-shift files that merges the frames into one full-colour image without demosaicing, ported from RawTherapee 5.13's `rtengine/pixelshift.cc` (Ingo Weyrich, GPL-3.0-or-later).

## Files it reads

| File | What makes it pixel shift | Frames |
| --- | --- | --- |
| Pentax PEF (K-1, K-1 II, K-3 II, K-70, KP, ...) | four raw images of one size: IFD0 and three SubIFDs | IFD0, then the SubIFDs in order |
| Pentax DNG | four raw images of one size, one per IFD in the main chain | chain order |
| Sony ARQ (Imaging Edge's merge of four ARW frames) | one uncompressed raw image with four samples per pixel | rebuilt from the samples (RawTherapee's `sony_arq_load_raw`) |

Any other file is answered with null, so the next decoder (Safelight's own) reads it, as is any frame past 64 MP (a 16-shot ARQ). The four-frame path needs a PENTAX or RICOH make and NewSubfileType 0. Detection reads the TIFF directories only (`isPixelShift`), so it can serve as a cheap accepts() check. Four separate Sony ARW frames are out of reach: a decoder is handed one file.

The frames' sensor data comes from LibRaw (libraw-wasm 1.6.0, shipped in `dist/libraw`), one frame per open: the raw IFD LibRaw picks has its strip or tile pointers swapped for the wanted frame's. The black level comes from the DNG's BlackLevel tag when there is one, else LibRaw's; the white level, as-shot multipliers and camera matrix from LibRaw.

## Frame geometry

In the visible area's coordinates, frame k's sample at sensor (i + dy, j + dx) sees scene point (i, j): frame 1 (0, 0), frame 2 (1, 0), frame 3 (1, 1), frame 4 (0, 1), each sample of the colour the filter array has at the sensor position. Every scene point is seen once in red, twice in green, once in blue.

## Merge (RawTherapee's, kept)

Values are scaled as RawTherapee scales them before the merge: `max(0, raw - black) * scale`, `scale = (mul / max(mul)) * 65535 / (white - black)`, with `mul` RawTherapee's default automatic pre-demosaic white balance (rawimage.cc get_colorsCoeff: each colour's mean over 8x8 blocks free of near-black and near-white samples). The motion detection's clipping checks are judged in that scale; with the as-shot balance instead the masks agreed with RawTherapee's only to IoU 0.96.

- **Motion detection off**: red, blue and the mean of the two greens at every pixel but the outer one.
- **Motion detection on**: green pairs and red/blue crosses are tested against a noise model (electrons per ISO by camera body, read noise by ISO, sensitivity slider scales it by `2^(s - 1)`). The map is blurred (Young-van Vliet, sigma 1), a 3x3 sum of at least 11.91 marks motion, holes in the mask are filled, and motion pixels take the chosen frame demosaiced (RCD). Smooth transitions blend by `max(map - 1, 0)^(1 - smooth)`.
- **Equalize brightness**: each frame is scaled so its median matches the chosen frame's, by green alone or per channel.
- **Show motion**: motion pixels painted green. **Show the mask only**: the mask as grey.

Deviations from RawTherapee, on purpose:
- Motion areas are demosaiced with RCD, not AMaZE.
- Hole filling floods from all four sides of the area (RawTherapee seeds three sides and an uninitialized row).
- The read-noise table index is clamped to the table, so ISO below 100 or past the table reads the end.
- With motion detection off the outer pixel copies its inner neighbour; with it on, the four the merge leaves take the demosaiced frame. Only the RCD tiles that motion areas (and their smooth blend) need are demosaiced.

## Output (what core asks of a RAW decode)

Linear Rec. 709 at D65, `kind: "linear"`, the visible area, `oriented: false`: `v / 65535 * max(mul) / min(mul)` after dcraw's highlight blend (Safelight's own decode uses highlight mode 2), then the camera matrix LibRaw would use with the camera's white balance: the file's own `cmatrix` when it has one (every PEF), else `rgb_cam`. LibRaw's adjust_maximum (white lowered to the first frame's brightest sample when it sits between 75 % and 100 %) is applied as a gain. So the least amplified channel saturates at 1, and a merge of four identical frames matches Safelight's own decode of one frame but for the demosaic. `asShotMultipliers` reports the multipliers used. The mask views are grey, 1 = motion.

Grid thumbnails and other reduced requests (`fullSize` false, a target at most half the frame) use frame 1 alone, binned 2x2, so a library of pixel-shift files imports at the speed of single frames.

## Options (Preferences > Extensions > Pixel Shift Merge)

Global, as a decoder has no per-photo settings. The decoder's `version` carries a signature of them, so a change re-decodes open photos and the RAW cache files the new decode apart.

| Option | Default |
| --- | --- |
| Use the first frame only (answer null: Safelight's own decode) | off |
| Motion detection | on |
| Sensitivity, -2 to 2 | 0 |
| Fill motion areas from frame 1-4 | 1 |
| Smooth transitions, 0 to 0.95 (at 1 the whole image would be the one frame) | 0.7 |
| Equalize brightness of frames | off |
| Equalize per channel | off |
| Show motion | off |
| Show the mask only | off |

## Decoder order

On first start the extension puts its decoder ahead of Safelight's for PEF, DNG and ARQ, for formats the person hasn't ordered. The person can move it back in Preferences > File formats; it never touches an order they set.

`accepts` (Safelight 3.2.7) answers from the TIFF directories alone (`isPixelShift`, given up between reads when its signal fires) and from the options (false with Use the first frame only), which are in `version`, so Safelight may remember the answer per file. A file turned down goes to Safelight's decoder with Safelight's own cache keys.

`decode` answers null only for a file it can't merge (not pixel shift, or one LibRaw can't unpack). Failures that may pass are thrown with `transient: true` (errors.ts): a worker that didn't start, a file that couldn't be read, memory running out (in LibRaw or the merge). An abort is passed on as it is.

## Cost

One decode: four LibRaw opens (the file is copied for each), the merge in a worker of its own. Peak memory in the merge worker for a 36 MP frame: four 16-bit frames (290 MB), the float RGBA output (590 MB), the motion map (150 MB) and mask (37 MB).
