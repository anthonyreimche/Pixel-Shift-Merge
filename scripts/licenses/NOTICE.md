# Third-party software in this folder

`worker.js`, `libraw.js` and `libraw.wasm` are libraw-wasm 1.6.0, a WebAssembly build of LibRaw with Little CMS, copied unchanged except that `import.meta.url` reads `self.location.href`.

## LibRaw

Copyright (C) 2008-2026 LibRaw LLC (https://www.libraw.org, info@libraw.org).
LibRaw is used under the GNU Lesser General Public License 2.1 (`LibRaw-LICENSE.LGPL`); it is also offered under the Common Development and Distribution License 1.0 (`LibRaw-LICENSE.CDDL`). See `LibRaw-COPYRIGHT`. Source: https://github.com/LibRaw/LibRaw. The wasm can be rebuilt or replaced from libraw-wasm's sources (below).

## libraw-wasm

Copyright (c) ybouane and the libraw-wasm contributors. Source: https://github.com/ybouane/LibRaw-Wasm. Its package declares the ISC licence; the repository ships no licence file, so the ISC text follows:

> Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

## Little CMS

Copyright (c) 1998-2024 Marti Maria Saguer. MIT licence: https://github.com/mm2/Little-CMS/blob/master/LICENSE.
