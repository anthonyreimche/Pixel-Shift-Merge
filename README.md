# Pixel Shift Merge

A Safelight extension that opens pixel-shift RAW files as one full-colour image.

In pixel-shift mode the camera shoots four frames, moving the sensor by one pixel between them, so every point of the scene is seen once through a red filter, twice through green and once through blue. This extension merges the four frames into one image where each pixel has its own red, green and blue, with no demosaicing: finer detail, no colour moiré and less noise than a single frame.

Anything that moved between the frames (water, leaves, people, clouds) would show as a coloured ghost in a plain merge. Motion detection finds those areas and fills them from one frame, demosaiced as an ordinary photo is.

Needs Safelight 3.2.7 or later.

## What it reads

- **Pentax PEF and DNG** pixel-shift files (K-1, K-1 Mark II, K-3 II, K-70, KP and others that store the four frames in one file).
- **Sony ARQ** files, which Sony's software makes from a series of four pixel-shift ARW frames. Safelight hands a decoder one file at a time, so the four separate ARW frames themselves can't be merged here; make the ARQ first.

Any other PEF, DNG or ARQ is passed on to Safelight's own decoder, so ordinary photos open as before. So is a file larger than 64 megapixels a frame, such as a 16-shot ARQ: its merge would need more memory than is safe to take.

## Using it

On its first start the extension puts its decoder ahead of Safelight's for PEF, DNG and ARQ in **Preferences ▸ File formats**, unless you've already set an order there. You can move it back down at any time; it won't move itself again. It looks only at a file's header to tell a pixel-shift file from any other, and Safelight remembers the answer, so ordinary PEF and DNG files go straight to Safelight's own decoder and keep their previews and cache as they were.

The options are in **Preferences ▸ Extensions ▸ Pixel Shift Merge**. They apply to every pixel-shift photo, and a photo open in Develop is decoded again when you change one.

| Option | What it does |
| --- | --- |
| Use the first frame only | Reads pixel-shift files as ordinary photos: the first frame, demosaiced. |
| Motion detection | Finds what moved and fills it from one frame. Off merges every pixel. |
| Motion sensitivity | Higher finds smaller movements, and more noise mistaken for movement. |
| Fill motion areas from | The frame whose pixels stand in where something moved. |
| Smooth transitions | Blends the edges of motion areas into the merge, from 0 (a hard edge) to 0.95. |
| Equalize brightness of frames | Evens out frames whose light changed while they were shot, such as under flickering lamps. |
| Equalize per channel | Evens out red, green and blue each on its own, for light whose colour changed too. |
| Show motion | Paints the areas filled from one frame green. |
| Show the motion mask only | Shows the mask alone: white where one frame fills in, black where the frames merge. |

Grid thumbnails use the first frame alone at half size, so a folder of pixel-shift files imports about as fast as ordinary RAWs. A merge takes a few seconds; Safelight keeps it in its RAW cache.

## Accuracy

The merge is a port (see Credits) and was checked against the original on five sample files from raw.pixls.us (K-1 PEF and DNG, K-1 Mark II PEF, K-70 DNG, A7R III ARQ):

- With motion detection off, the merged image matches the original to within rounding once the two programs' camera matrices are accounted for.
- The motion masks agree on 99.95 % or more of the pixels (intersection over union 0.988 to 1.000).
- Where motion is found, this extension demosaics with RCD where the original uses AMaZE by default, so those areas differ a little.

The colour, white balance and brightness follow Safelight's own decode of the same file, so a pixel-shift photo looks like its first frame does without the extension.

## Credits

The merge, motion detection, brightness equalization and the ARQ frame layout are ported from RawTherapee 5.13 (`rtengine/pixelshift.cc` © 2016-2018 Ingo Weyrich; `rcd_demosaic.cc` © 2017-2020 Luis Sanz Rodríguez and Ingo Weyrich; `gauss.cc` © 2004-2010 Gábor Horváth; `rawimage.cc`, `dcraw.cc`), GPL-3.0-or-later. The highlight blend is dcraw's (Dave Coffin), as LibRaw ships it.

Frames are read with [LibRaw](https://www.libraw.org/) (LGPL-2.1 or CDDL-1.0) through [libraw-wasm](https://github.com/ybouane/LibRaw-Wasm) (ISC), shipped in `dist/libraw` with their licences (`dist/libraw/NOTICE.md`).

## Development

`npm run check` typechecks, builds and runs the unit tests.

Licensed under the GNU GPL v3 or later.
