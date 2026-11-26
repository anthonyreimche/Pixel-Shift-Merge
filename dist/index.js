//#region src/mosaic.ts
function e(e) {
	let t = (t, n) => {
		let r = e >>> ((t << 1 & 14 | n & 1) << 1) & 3;
		return r === 3 ? 1 : r;
	}, n = [
		t(0, 0),
		t(0, 1),
		t(1, 0),
		t(1, 1)
	], r = n.filter((e) => e === 0).length, i = n.filter((e) => e === 1).length, a = n.filter((e) => e === 2).length, o = n[0] === 1 && n[3] === 1 || n[1] === 1 && n[2] === 1;
	return r === 1 && i === 2 && a === 1 && o ? n : null;
}
function t(e, t, n, r) {
	return {
		data: e,
		base: n * t + r,
		row: t,
		col: 1,
		pos: [
			0,
			0,
			0,
			0
		]
	};
}
//#endregion
//#region src/camera.ts
function n(e) {
	let t = e.rawWidth - e.left, n = e.rawHeight - e.top;
	return e.width <= t && e.height <= n ? {
		width: e.width,
		height: e.height
	} : e.height <= t && e.width <= n ? {
		width: e.height,
		height: e.width
	} : {
		width: Math.min(e.width, t),
		height: Math.min(e.height, n)
	};
}
var r = (e) => typeof e == "object" && e ? e : {}, i = (e) => typeof e == "number" && Number.isFinite(e) ? e : 0, a = (e) => typeof e == "string" ? e.trim() : "", o = (e) => Array.isArray(e) ? e.map(i) : [];
function s(e, t) {
	let n = Array.isArray(e) ? e.map(o) : [];
	if (n.length < 3 || n.some((e) => e.length < 3)) return null;
	let r = n.slice(0, 3).flatMap((e) => e.slice(0, 3));
	return r[0] > t && r.some((e) => e !== 0) ? r : null;
}
function c(t) {
	let n = r(t), c = r(n.color_data), l = o(c.cam_mul), u = o(c.pre_mul), d = l[0] > 0 && l[1] > 0 && l[2] > 0 ? l : u;
	if (!(d[0] > 0 && d[1] > 0 && d[2] > 0)) return null;
	let f = s(c.cmatrix, .125) ?? s(c.rgb_cam, 0), p = i(c.maximum);
	return !f || p <= 0 ? null : {
		make: a(n.camera_make),
		model: a(n.camera_model),
		iso: i(n.iso_speed) || 100,
		cfa: e(i(n.filters)),
		black: i(c.black),
		white: p,
		mul: [
			d[0],
			d[1],
			d[2]
		],
		rgbCam: f,
		top: i(n.top_margin),
		left: i(n.left_margin),
		width: i(n.width),
		height: i(n.height)
	};
}
function l(e) {
	return [
		e[0] / e[1],
		1,
		e[2] / e[1]
	];
}
function u(e, t, n) {
	let r = t ?? [
		e.black,
		e.black,
		e.black,
		e.black
	];
	return {
		black: [
			r[0],
			r[1],
			r[2],
			r[3]
		],
		white: e.white,
		mul: [
			n[0],
			n[1],
			n[2]
		]
	};
}
//#endregion
//#region src/errors.ts
function d(e) {
	return Object.assign(Error(e), { transient: !0 });
}
function f(e) {
	return typeof e == "object" && !!e && "transient" in e && e.transient === !0;
}
var p = /out of memory|\bOOM\b|bad_alloc|allocation failed|enlarge memory|Invalid (typed )?array length|Array buffer allocation/i;
function m(e) {
	if (e instanceof RangeError || e instanceof DOMException && (e.name === "NotReadableError" || e.name === "NotFoundError")) return !0;
	let t = e instanceof Error ? e.message : typeof e == "string" ? e : "";
	return p.test(t);
}
function h(e, t) {
	if (f(e)) return e instanceof Error ? e : d(String(e));
	if (e instanceof DOMException && e.name === "AbortError") return e;
	let n = e instanceof Error ? e.message : String(e);
	return m(e) ? d(`${t}: ${n}`) : e instanceof Error ? e : /* @__PURE__ */ Error(`${t}: ${n}`);
}
//#endregion
//#region src/tiff.ts
function g(e) {
	return async (t, n) => new DataView(await e.slice(t, t + n).arrayBuffer());
}
var _ = {
	newSubfileType: 254,
	width: 256,
	height: 257,
	bitsPerSample: 258,
	compression: 259,
	make: 271,
	stripOffsets: 273,
	samplesPerPixel: 277,
	stripByteCounts: 279,
	tileOffsets: 324,
	tileByteCounts: 325,
	subIfds: 330,
	blackLevelRepeatDim: 50713,
	blackLevel: 50714
}, v = {
	1: 1,
	2: 1,
	3: 2,
	4: 4,
	5: 8,
	6: 1,
	7: 1,
	8: 2,
	9: 4,
	10: 8,
	11: 4,
	12: 8,
	13: 4
}, y = 1e3, b = 64, x = 65536, ee = class e {
	read;
	littleEndian;
	firstIfd;
	constructor(e, t, n) {
		this.read = e, this.littleEndian = t, this.firstIfd = n;
	}
	static async open(t) {
		let n = await t(0, 8);
		if (n.byteLength < 8) return null;
		let r = n.getUint16(0, !1);
		if (r !== 18761 && r !== 19789) return null;
		let i = r === 18761;
		return n.getUint16(2, i) === 42 ? new e(t, i, n.getUint32(4, i)) : null;
	}
	async ifd(e) {
		if (e < 8) return null;
		let t = await this.read(e, 2);
		if (t.byteLength < 2) return null;
		let n = t.getUint16(0, this.littleEndian);
		if (n === 0 || n > y) return null;
		let r = await this.read(e + 2, n * 12 + 4);
		if (r.byteLength < n * 12) return null;
		let i = /* @__PURE__ */ new Map();
		for (let t = 0; t < n; t++) {
			let n = t * 12, a = r.getUint16(n, this.littleEndian), o = r.getUint16(n + 2, this.littleEndian), s = r.getUint32(n + 4, this.littleEndian), c = e + 2 + n + 8, l = (v[o] ?? 1) * s <= 4 ? c : r.getUint32(n + 8, this.littleEndian);
			i.set(a, {
				tag: a,
				type: o,
				count: s,
				fieldAt: c,
				dataAt: l
			});
		}
		return {
			offset: e,
			entries: i,
			next: r.byteLength >= n * 12 + 4 ? r.getUint32(n * 12, this.littleEndian) : 0
		};
	}
	async values(e) {
		if (!e || e.count === 0 || e.count > x) return [];
		let t = v[e.type] ?? 1, n = await this.read(e.dataAt, t * e.count), r = this.littleEndian, i = [];
		for (let a = 0; a < e.count && (a + 1) * t <= n.byteLength; a++) {
			let o = a * t;
			switch (e.type) {
				case 3:
					i.push(n.getUint16(o, r));
					break;
				case 8:
					i.push(n.getInt16(o, r));
					break;
				case 4:
				case 13:
					i.push(n.getUint32(o, r));
					break;
				case 9:
					i.push(n.getInt32(o, r));
					break;
				case 5:
					i.push(n.getUint32(o, r) / (n.getUint32(o + 4, r) || 1));
					break;
				case 10:
					i.push(n.getInt32(o, r) / (n.getInt32(o + 4, r) || 1));
					break;
				case 11:
					i.push(n.getFloat32(o, r));
					break;
				case 12:
					i.push(n.getFloat64(o, r));
					break;
				default: i.push(n.getUint8(o));
			}
		}
		return i;
	}
	async first(e, t) {
		return (await this.values(e.entries.get(t)))[0];
	}
	async text(e) {
		if (!e || e.count === 0 || e.count > x) return "";
		let t = await this.read(e.dataAt, e.count), n = "";
		for (let e = 0; e < t.byteLength; e++) {
			let r = t.getUint8(e);
			if (r === 0) break;
			n += String.fromCharCode(r);
		}
		return n.trim();
	}
	async directories() {
		let e = [], t = /* @__PURE__ */ new Set(), n = async (r) => {
			if (e.length >= b || t.has(r)) return null;
			t.add(r);
			let i = await this.ifd(r);
			if (!i) return null;
			e.push(i);
			for (let e of await this.values(i.entries.get(_.subIfds))) await n(e);
			return i;
		}, r = this.firstIfd;
		for (; r;) r = (await n(r))?.next ?? 0;
		return e;
	}
};
function S(e) {
	let t = [e.entries.get(_.stripOffsets), e.entries.get(_.stripByteCounts)], n = [e.entries.get(_.tileOffsets), e.entries.get(_.tileByteCounts)];
	return (n[0] && n[1] ? n : t).filter((e) => e !== void 0);
}
var C = 6;
async function w(e, t) {
	let n = await e.first(t, _.width) ?? 0, r = await e.first(t, _.height) ?? 0, i = await e.first(t, _.bitsPerSample) ?? 0, a = await e.first(t, _.samplesPerPixel) ?? 1, o = await e.first(t, _.compression) ?? 1, s = await e.first(t, _.newSubfileType) ?? 0;
	return n <= 0 || r <= 0 || i <= 8 || s !== 0 || o === C || S(t).length !== 2 ? null : {
		ifd: t,
		width: n,
		height: r,
		bitsPerSample: i,
		samplesPerPixel: a,
		compression: o
	};
}
async function te(e, t) {
	let n = await e.values(t.entries.get(_.blackLevel));
	if (n.length === 0) return;
	let r = await e.values(t.entries.get(_.blackLevelRepeatDim)), i = r[0] ?? 1, a = r[1] ?? 1, o = (e, t) => n[e % i * a + t % a] ?? n[0];
	return [
		o(0, 0),
		o(0, 1),
		o(1, 0),
		o(1, 1)
	];
}
async function T(e) {
	let t = await ee.open(e);
	if (!t) return null;
	let n = await t.directories();
	if (n.length === 0) return null;
	let r = (await t.text(n[0].entries.get(_.make))).toUpperCase(), i = [];
	for (let e of n) {
		let n = await w(t, e);
		n && i.push(n);
	}
	if (i.length === 0) return null;
	let a = i.find((e) => e.samplesPerPixel === 4 && e.compression === 1 && (e.bitsPerSample === 14 || e.bitsPerSample === 16));
	if (a) {
		if (!r.startsWith("SONY") || !t.littleEndian || a.width * a.height > 64e6) return null;
		let e = await t.values(a.ifd.entries.get(_.stripByteCounts)), n = await t.values(a.ifd.entries.get(_.stripOffsets)), i = e.reduce((e, t) => e + t, 0);
		return !n.every((t, r) => r === 0 || t === n[r - 1] + e[r - 1]) || i !== a.width * a.height * 8 || n[0] % 2 != 0 ? null : {
			kind: "arq",
			littleEndian: t.littleEndian,
			image: a,
			dataOffset: n[0]
		};
	}
	if (!r.includes("PENTAX") && !r.includes("RICOH")) return null;
	let o = (e) => e.width * e.height * e.bitsPerSample, s = Math.max(...i.map(o)), c = i.filter((e) => o(e) === s && e.samplesPerPixel === 1);
	if (c.length !== 4 || c[0].width * c[0].height > 64e6) return null;
	let l = c.map((e) => S(e.ifd));
	if (!l.every((e) => e.every((e, t) => e.tag === l[0][t].tag && e.count === l[0][t].count && e.type === l[0][t].type))) return null;
	let u = await te(t, c[0].ifd);
	return {
		kind: "frames",
		littleEndian: t.littleEndian,
		frames: c,
		...u ? { black: u } : {}
	};
}
function E(e, t, n) {
	let r = S(t.frames[0].ifd), i = S(t.frames[n].ifd), a = r.map((t) => e.slice(t.fieldAt, t.fieldAt + 4));
	return r.forEach((t, n) => e.copyWithin(t.fieldAt, i[n].fieldAt, i[n].fieldAt + 4)), () => r.forEach((t, n) => e.set(a[n], t.fieldAt));
}
//#endregion
//#region src/decoder.ts
var D = "pixel-shift", O = [
	".pef",
	".dng",
	".arq"
], k = [
	0,
	1,
	1,
	2
];
function A() {
	return new DOMException("The decode was no longer needed.", "AbortError");
}
function j(e) {
	if (e.aborted) throw A();
}
function M(e, t, n) {
	return !e.fullSize && e.targetEdge !== void 0 && e.targetEdge <= Math.floor(Math.max(t, n) / 2);
}
async function ne(e, t) {
	let n = g(e);
	return await T((e, r) => (t && j(t), n(e, r))) !== null;
}
async function re(e, r, i, a) {
	let o = new Uint8Array(await r.arrayBuffer());
	j(a.signal);
	let s = [], l = async (t) => {
		let n = E(o, i, t);
		try {
			await e.open(o);
		} finally {
			n();
		}
		let r = await e.readout();
		return r ? (s.push(r), !0) : !1;
	};
	if (!await l(0)) return null;
	let u = c(await e.metadata());
	if (!u?.cfa) return null;
	let d = s[0], f = n(d), p = M(a, f.width, f.height);
	for (let e = 1; e < (p ? 1 : 4); e++) {
		if (j(a.signal), !await l(e)) return null;
		let t = s[e];
		if (t.rawWidth !== d.rawWidth || t.rawHeight !== d.rawHeight || t.top !== d.top || t.left !== d.left) return null;
	}
	let m = s.map((e) => t(e.data, e.rawWidth, e.top, e.left));
	return {
		camera: u,
		cfa: u.cfa,
		source: {
			kind: "views",
			views: m
		},
		...f,
		binned: p
	};
}
async function ie(e, t, r, i) {
	await e.open(new Uint8Array(await t.slice(0, r.dataOffset).arrayBuffer()));
	let a = c(await e.metadata());
	if (!a) return null;
	let { width: o, height: s } = r.image, l = n({
		rawWidth: o,
		rawHeight: s,
		top: a.top,
		left: a.left,
		width: a.width,
		height: a.height
	});
	if (l.width <= 0 || l.height <= 0) return null;
	let u = M(i, l.width, l.height);
	return {
		camera: a,
		cfa: k,
		source: {
			kind: "arq",
			file: t,
			dataOffset: r.dataOffset,
			rawWidth: o,
			rawHeight: s,
			top: a.top,
			left: a.left,
			shots: u ? [0] : [
				0,
				1,
				2,
				3
			]
		},
		...l,
		binned: u
	};
}
async function ae(e, t, n) {
	j(t);
	let r;
	try {
		r = e.libraw();
	} catch (e) {
		throw d(`LibRaw didn't start: ${e instanceof Error ? e.message : String(e)}`);
	}
	let i = () => r.dispose();
	t.addEventListener("abort", i, { once: !0 });
	try {
		return await n(r);
	} catch (e) {
		throw t.aborted ? A() : e;
	} finally {
		t.removeEventListener("abort", i), r.dispose();
	}
}
function N(e, t, n) {
	async function r(t, r) {
		if (e.firstFrameOnly) return null;
		let i = await T(g(t));
		if (!i) return null;
		let a = await ae(n, r.signal, (e) => i.kind === "arq" ? ie(e, t, i, r) : re(e, t, i, r));
		if (!a) return null;
		j(r.signal);
		let { camera: o, cfa: s, source: c, width: d, height: f, binned: p } = a, m = r.asShotMultipliers ?? o.mul, h = i.kind === "frames" ? i.black : void 0, _ = await n.merge({
			width: d,
			height: f,
			cfa: s,
			source: c,
			levels: u(o, h, m),
			rgbCam: o.rgbCam,
			shot: {
				make: o.make,
				model: o.model,
				iso: o.iso
			},
			settings: e,
			binned: p
		}, r.signal);
		return {
			kind: "linear",
			width: _.width,
			height: _.height,
			data: _.data,
			oriented: !1,
			asShotMultipliers: l(m),
			...p ? {
				sourceWidth: d,
				sourceHeight: f
			} : {}
		};
	}
	return {
		id: D,
		label: "Pixel shift merge",
		version: t,
		extensions: O,
		async accepts(t, n) {
			return !e.firstFrameOnly && await ne(t, n.signal);
		},
		async decode(e, t) {
			try {
				return await r(e, t);
			} catch (e) {
				throw h(e, "Pixel shift merge");
			}
		}
	};
}
//#endregion
//#region src/options.ts
var P = "pixel-shift-merge", F = {
	firstFrameOnly: !1,
	motionDetection: !0,
	sensitivity: 0,
	fillFrame: 0,
	smooth: .7,
	equalizeBrightness: !1,
	equalizePerChannel: !1,
	showMotion: !1,
	showMaskOnly: !1
}, I = .95, L = {
	firstFrameOnly: "firstFrameOnly",
	motionDetection: "motionDetection",
	sensitivity: "sensitivity",
	fillFrame: "fillFrame",
	smooth: "smooth",
	equalizeBrightness: "equalizeBrightness",
	equalizePerChannel: "equalizePerChannel",
	showMotion: "showMotion",
	showMaskOnly: "showMaskOnly"
}, R = [
	{
		key: L.firstFrameOnly,
		label: "Use the first frame only",
		type: "boolean",
		default: F.firstFrameOnly,
		hint: "Read pixel-shift files as an ordinary photo: the first frame, demosaiced."
	},
	{
		key: L.motionDetection,
		label: "Motion detection",
		type: "boolean",
		default: F.motionDetection,
		hint: "Find what moved between the frames and fill it from one frame, so it doesn't show as a coloured ghost."
	},
	{
		key: L.sensitivity,
		label: "Motion sensitivity",
		type: "number",
		default: F.sensitivity,
		min: -2,
		max: 2,
		step: .1,
		hint: "Higher finds smaller movements, and more noise mistaken for movement."
	},
	{
		key: L.fillFrame,
		label: "Fill motion areas from",
		type: "select",
		default: "1",
		options: [
			{
				value: "1",
				label: "Frame 1"
			},
			{
				value: "2",
				label: "Frame 2"
			},
			{
				value: "3",
				label: "Frame 3"
			},
			{
				value: "4",
				label: "Frame 4"
			}
		],
		hint: "The frame whose demosaiced pixels stand in where something moved."
	},
	{
		key: L.smooth,
		label: "Smooth transitions",
		type: "number",
		default: F.smooth,
		min: 0,
		max: I,
		step: .05,
		hint: "Blend the edges of motion areas into the merge. 0 is a hard edge."
	},
	{
		key: L.equalizeBrightness,
		label: "Equalize brightness of frames",
		type: "boolean",
		default: F.equalizeBrightness,
		hint: "Even out frames whose light changed while they were shot, such as under flickering lamps."
	},
	{
		key: L.equalizePerChannel,
		label: "Equalize per channel",
		type: "boolean",
		default: F.equalizePerChannel,
		hint: "Even out red, green and blue each on its own, for light whose colour changed too."
	},
	{
		key: L.showMotion,
		label: "Show motion",
		type: "boolean",
		default: F.showMotion,
		hint: "Paint the areas filled from one frame green."
	},
	{
		key: L.showMaskOnly,
		label: "Show the motion mask only",
		type: "boolean",
		default: F.showMaskOnly,
		hint: "Show only the motion mask: white where the frame fills in, black where the frames merge."
	}
], z = (e, t, n) => Math.min(n, Math.max(t, e));
function B(e, t, n, r, i) {
	let a = e(t, n);
	return typeof a == "number" && Number.isFinite(a) ? z(a, r, i) : n;
}
function V(e, t, n) {
	let r = e(t, n);
	return typeof r == "boolean" ? r : n;
}
function H(e) {
	let t = Number(e(L.fillFrame, "1"));
	return t === 2 ? 1 : t === 3 ? 2 : t === 4 ? 3 : 0;
}
function U(e) {
	return {
		firstFrameOnly: V(e, L.firstFrameOnly, F.firstFrameOnly),
		motionDetection: V(e, L.motionDetection, F.motionDetection),
		sensitivity: B(e, L.sensitivity, F.sensitivity, -2, 2),
		fillFrame: H(e),
		smooth: B(e, L.smooth, F.smooth, 0, I),
		equalizeBrightness: V(e, L.equalizeBrightness, F.equalizeBrightness),
		equalizePerChannel: V(e, L.equalizePerChannel, F.equalizePerChannel),
		showMotion: V(e, L.showMotion, F.showMotion),
		showMaskOnly: V(e, L.showMaskOnly, F.showMaskOnly)
	};
}
function W(e) {
	let t = (e) => +!!e;
	return e.firstFrameOnly ? "first" : `${e.motionDetection ? `m${e.sensitivity.toFixed(2)}f${e.fillFrame + 1}s${e.smooth.toFixed(2)}v${t(e.showMotion)}k${t(e.showMaskOnly)}` : "m-"}${e.equalizeBrightness ? `e${t(e.equalizePerChannel)}` : "e-"}`;
}
//#endregion
//#region src/placement.ts
var G = [
	"pef",
	"dng",
	"arq"
], K = "libraw", q = "placedDecoder";
function oe(e, t) {
	let n = G.filter((t) => !e[t]?.length);
	if (n.length === 0) return null;
	let r = { ...e };
	for (let e of n) r[e] = [t, K];
	return r;
}
function se(e, t) {
	if (e.settings.get(q, !1)) return;
	let n = oe(e.stores.useSettings.getState().decoderOrder ?? {}, t);
	n && e.appSettings.update({ decoderOrder: n }), e.settings.set(q, !0);
}
//#endregion
//#region src/libraw.ts
var J = () => new DOMException("The LibRaw session was ended.", "AbortError"), Y = (e) => typeof e == "number" && Number.isFinite(e) ? e : 0, X = class {
	worker;
	chain = Promise.resolve();
	next = 0;
	failPending = null;
	ended = !1;
	constructor(e) {
		this.worker = new Worker(e, { type: "module" });
	}
	call(e, t) {
		let n = () => new Promise((n, r) => {
			if (this.ended) {
				r(J());
				return;
			}
			let i = ++this.next;
			this.failPending = r;
			let a = (e) => {
				this.failPending = null, e();
			};
			this.worker.onmessage = ({ data: e }) => a(() => {
				e?.error ? r(m(e.error) ? d(`LibRaw: ${e.error}`) : /* @__PURE__ */ Error(`LibRaw: ${e.error}`)) : n(e?.out);
			}), this.worker.onerror = (e) => a(() => r(d(e.message || "the LibRaw worker failed"))), this.worker.postMessage({
				id: i,
				fn: e,
				args: t
			});
		}), r = this.chain.then(n, n);
		return this.chain = r.catch(() => void 0), r;
	}
	async open(e) {
		await this.call("open", [e, {}]);
	}
	async readout() {
		let e = await this.call("rawImageData", []);
		if (typeof e != "object" || !e) return null;
		let t = e, n = t.data;
		return !(n instanceof Uint16Array) || !(n.buffer instanceof ArrayBuffer) ? null : {
			rawWidth: Y(t.raw_width),
			rawHeight: Y(t.raw_height),
			top: Y(t.top_margin),
			left: Y(t.left_margin),
			width: Y(t.width),
			height: Y(t.height),
			data: new Uint16Array(n.buffer, n.byteOffset, n.length)
		};
	}
	metadata() {
		return this.call("metadata", [!0]);
	}
	dispose() {
		this.ended || (this.ended = !0, this.worker.terminate(), this.failPending?.(J()), this.failPending = null);
	}
}, Z = "(function(){let e=/out of memory|\\bOOM\\b|bad_alloc|allocation failed|enlarge memory|Invalid (typed )?array length|Array buffer allocation/i;function t(t){if(t instanceof RangeError||t instanceof DOMException&&(t.name===`NotReadableError`||t.name===`NotFoundError`))return!0;let n=t instanceof Error?t.message:typeof t==`string`?t:``;return e.test(n)}function n(e,t){let n=Math.max(...t.mul),r=/* @__PURE__ */ new Float64Array(4);for(let i=0;i<4;i++)r[i]=t.mul[e[i]]/n*65535/(t.white-t.black[i]);return r}function r(e,t){let r=n(e,t);return[0,1,2,3].map(e=>{let n=/* @__PURE__ */ new Float32Array(65536),i=t.black[e];for(let t=0;t<65536;t++)n[t]=Math.max(0,t-i)*r[e];return n})}let i=[0,1,3,2];function a(e,t,n,r,a){let o=i[a],s=o&1,c=o>>1&1,l=t*4;return{data:e,base:(n-s)*l+(r-c)*4,row:l,col:4,pos:[0,1,2,3]}}function o(e,t,n,r){let i=(n&1)<<1|r&1,a=e.data[e.base+n*e.row+r*e.col+e.pos[i]];return a===void 0?0:t[i][a]}function s(e,t){let n=Math.min(...e.black),r=e.white-n,i=t-n;return i>0&&i<r&&i>r*.75?r/i:1}let c=[[1,1,1],[1.7320508,-1.7320508,0],[-1,-1,2]],l=[[1,.8660254,-.5],[1,-.8660254,-.5],[1,0,1]];function u(e,t,n,r=[1,1,1]){let i=Math.max(...t),a=Math.min(...t),o=65535*a/i,s=i/a/65535,u=n,d=[0,0,0],f=[0,0,0],p=[0,0,0],m=[0,0,0];for(let t=0;t<e.length;t+=4){let n=Math.min(65535,e[t]*r[0]),i=Math.min(65535,e[t+1]*r[1]),a=Math.min(65535,e[t+2]*r[2]);if(n>o||i>o||a>o){d[0]=n,d[1]=i,d[2]=a,f[0]=Math.min(n,o),f[1]=Math.min(i,o),f[2]=Math.min(a,o);let e=0,t=0;for(let n=0;n<3;n++)p[n]=c[n][0]*d[0]+c[n][1]*d[1]+c[n][2]*d[2],m[n]=c[n][0]*f[0]+c[n][1]*f[1]+c[n][2]*f[2],n>0&&(e+=p[n]*p[n],t+=m[n]*m[n]);let r=e>0?Math.sqrt(t/e):0;p[1]*=r,p[2]*=r,n=(l[0][0]*p[0]+l[0][1]*p[1]+l[0][2]*p[2])/3,i=(l[1][0]*p[0]+l[1][1]*p[1]+l[1][2]*p[2])/3,a=(l[2][0]*p[0]+l[2][1]*p[1]+l[2][2]*p[2])/3}e[t]=(u[0]*n+u[1]*i+u[2]*a)*s,e[t+1]=(u[3]*n+u[4]*i+u[5]*a)*s,e[t+2]=(u[6]*n+u[7]*i+u[8]*a)*s,e[t+3]=1}}function d(e){for(let t=0;t<e.length;t+=4){let n=e[t+1]/65535;e[t]=e[t+1]=e[t+2]=n,e[t+3]=1}}function f(e){let t=e<2.5?3.97156-4.14554*Math.sqrt(1-.26891*e):.98711*e-.9633,n=1.57825+2.44413*t+1.4281*t*t+.422205*t*t*t,r=2.44413*t+2.85619*t*t+1.26661*t*t*t,i=-1.4281*t*t-1.26661*t*t*t,a=.422205*t*t*t,o=1-(r+i+a)/n;r/=n,i/=n,a/=n;let s=[[-a*r+1-a*a-i,(a+r)*(i+a*r),a*(r+a*i)],[r+a*i,-(i-1)*(i+a*r),-(a*r+a*a+i-1)*a],[a*r+i+r*r-i*i,r*i+a*i*i-r*a*a-a*a*a-a*i+a,a*(r+a*i)]],c=(1+i+(r-a)*a)/((1+r-i+a)*(1-r-i-a));for(let e of s)for(let t=0;t<3;t++)e[t]*=c;return{B:o,b1:r,b2:i,b3:a,M:s}}function p(e,t,n,r,i,a){let{B:o,b1:s,b2:c,b3:l,M:u}=i,d=r=>e[t+r*n];a[0]=d(0)*(o+s+c+l),a[1]=o*d(1)+s*a[0]+d(0)*(c+l),a[2]=o*d(2)+s*a[1]+c*a[0]+l*d(0);for(let e=3;e<r;e++)a[e]=o*d(e)+s*a[e-1]+c*a[e-2]+l*a[e-3];let f=d(r-1),p=a[r-1]-f,m=a[r-2]-f,h=a[r-3]-f,g=f+u[0][0]*p+u[0][1]*m+u[0][2]*h,_=f+u[1][0]*p+u[1][1]*m+u[1][2]*h,v=f+u[2][0]*p+u[2][1]*m+u[2][2]*h;a[r-1]=g,a[r-2]=o*a[r-2]+s*a[r-1]+c*_+l*v,a[r-3]=o*a[r-3]+s*a[r-2]+c*a[r-1]+l*_;for(let e=r-4;e>=0;e--)a[e]=o*a[e]+s*a[e+1]+c*a[e+2]+l*a[e+3];for(let i=0;i<r;i++)e[t+i*n]=a[i]}function m(e,t,n,r){let i=f(r),a=new Float64Array(Math.max(t,n));for(let r=0;r<n;r++)p(e,r*t,1,t,i,a);for(let r=0;r<t;r++)p(e,r,t,n,i,a)}let h=1e-5,g=1e-10,_=65536,v=e=>e*e,y=(e,t,n)=>e*t+(1-e)*n;var b=class{cols;flags;constructor(e,t){this.cols=Math.ceil(e/176),this.flags=new Uint8Array(this.cols*Math.ceil(t/176))}need(e,t){if(e<9||t<9)return;let n=Math.floor((e-9)/176),r=Math.floor((t-9)/176);r<this.cols&&n*this.cols+r<this.flags.length&&(this.flags[n*this.cols+r]=1)}wanted=(e,t)=>this.flags[e*this.cols+t]===1};function x(e,t,n,r,i,a=()=>!0){let o=(e,t)=>n[(e&1)<<1|t&1],s=Math.ceil(t/176),c=Math.ceil(e/176),l=/* @__PURE__ */ new Float32Array(37636),u=[/* @__PURE__ */ new Float32Array(37636),/* @__PURE__ */ new Float32Array(37636),/* @__PURE__ */ new Float32Array(37636)],d=/* @__PURE__ */ new Float32Array(37636),f=/* @__PURE__ */ new Float32Array(18818),p=f,m=/* @__PURE__ */ new Float32Array(18818),b=/* @__PURE__ */ new Float32Array(18818),x=[/* @__PURE__ */ new Float32Array(186),/* @__PURE__ */ new Float32Array(186),/* @__PURE__ */ new Float32Array(186)],C=/* @__PURE__ */ new Float32Array(188);for(let n=0;n<s;n++)for(let S=0;S<c;S++){if(!a(n,S))continue;let w=n*176,T=Math.min(w+194,t);if(w+9===T-9)continue;let E=S*176,D=Math.min(E+194,e);if(E+9===D-9)continue;let O=Math.min(T-w,194),k=Math.min(D-E,194);for(let e=w;e<T;e++){let t=o(e,E),n=o(e,E+1);for(let i=E,a=(e-w)*194;i<D;i++,a++){let o=Math.min(1,Math.max(0,r(e,i)/_));l[a]=o,u[t][a]=o,u[n][a]=o}}for(let e=3;e<Math.min(O-3,5);e++)for(let t=4,n=e*194+t;t<k-4;t++,n++)x[e-3][t-4]=v(l[n-582]-l[n-194]-l[n+194]+l[n+582]-3*(l[n-388]+l[n+388])+6*l[n]);let A=x[0],j=x[1],M=x[2];for(let e=4;e<O-4;e++){for(let t=3,n=e*194+t;t<k-3;t++,n++)C[t-3]=v(l[n-3]-l[n-1]-l[n+1]+l[n+3]-3*(l[n-2]+l[n+2])+6*l[n]);for(let t=4,n=(e+1)*194+t;t<k-4;t++,n++)M[t-4]=v(l[n-582]-l[n-194]-l[n+194]+l[n+582]-3*(l[n-388]+l[n+388])+6*l[n]);for(let t=4,n=e*194+t;t<k-4;t++,n++){let e=Math.max(g,A[t-4]+j[t-4]+M[t-4]),r=Math.max(g,C[t-4]+C[t-3]+C[t-2]);d[n]=e/(e+r)}let t=A;A=j,j=M,M=t}for(let e=2;e<O-2;e++)for(let t=2+(o(e,0)&1),n=e*194+t,r=n>>1;t<k-2;t+=2,n+=2,r++)p[r]=l[n]+.5*(l[n-194]+l[n+194]+l[n-1]+l[n+1])+.25*(l[n-194-1]+l[n-194+1]+l[n+194-1]+l[n+194+1]);for(let e=4;e<O-4;e++)for(let t=4+(o(e,0)&1),n=e*194+t,r=n>>1;t<k-4;t+=2,n+=2,r++){let e=l[n],t=h+(Math.abs(l[n-194]-l[n+194])+Math.abs(e-l[n-388]))+(Math.abs(l[n-194]-l[n-582])+Math.abs(l[n-388]-l[n-776])),i=h+(Math.abs(l[n-194]-l[n+194])+Math.abs(e-l[n+388]))+(Math.abs(l[n+194]-l[n+582])+Math.abs(l[n+388]-l[n+776])),a=h+(Math.abs(l[n-1]-l[n+1])+Math.abs(e-l[n-2]))+(Math.abs(l[n-1]-l[n-3])+Math.abs(l[n-2]-l[n-4])),o=h+(Math.abs(l[n-1]-l[n+1])+Math.abs(e-l[n+2]))+(Math.abs(l[n+1]-l[n+3])+Math.abs(l[n+2]-l[n+4])),s=p[r],c=l[n-194]*(s+s)/(h+s+p[r-194]),f=l[n+194]*(s+s)/(h+s+p[r+194]),m=l[n-1]*(s+s)/(h+s+p[r-1]),g=l[n+1]*(s+s)/(h+s+p[r+1]),_=(i*c+t*f)/(t+i),v=(a*g+o*m)/(o+a),b=d[n],x=.25*(d[n-194-1]+d[n-194+1]+(d[n+194-1]+d[n+194+1])),S=Math.abs(.5-b)<Math.abs(.5-x)?x:b;u[1][n]=y(S,v,_)}for(let e=3;e<O-3;e++)for(let t=3,n=e*194+t,r=n>>1;t<k-3;t+=2,n+=2,r++)m[r]=v(l[n-582-3]-l[n-194-1]-l[n+194+1]+l[n+582+3]-3*(l[n-388-2]+l[n+388+2])+6*l[n]),b[r]=v(l[n-582+3]-l[n-194+1]-l[n+194-1]+l[n+582-3]-3*(l[n-388+2]+l[n+388-2])+6*l[n]);for(let e=4;e<O-4;e++)for(let t=4+(o(e,0)&1),n=e*194+t,r=n>>1,i=n-194-1>>1,a=n+194-1>>1;t<k-4;t+=2,n+=2,r++,i++,a++){let e=Math.max(g,m[i]+m[r]+m[a+1]),t=Math.max(g,b[i+1]+b[r]+b[a]);f[r]=e/(e+t)}for(let e=4;e<O-4;e++){let t=4+(o(e,0)&1),n=u[2-o(e,t)],r=u[1];for(let i=t,a=e*194+i,o=a>>1,s=a-194-1>>1,c=a+194-1>>1;i<k-4;i+=2,a+=2,o++,s++,c++){let e=f[o],t=.25*(f[s]+f[s+1]+f[c]+f[c+1]),i=Math.abs(.5-e)<Math.abs(.5-t)?t:e,l=h+Math.abs(n[a-194-1]-n[a+194+1])+Math.abs(n[a-194-1]-n[a-582-3])+Math.abs(r[a]-r[a-388-2]),u=h+Math.abs(n[a-194+1]-n[a+194-1])+Math.abs(n[a-194+1]-n[a-582+3])+Math.abs(r[a]-r[a-388+2]),d=h+Math.abs(n[a-194+1]-n[a+194-1])+Math.abs(n[a+194-1]-n[a+582-3])+Math.abs(r[a]-r[a+388-2]),p=h+Math.abs(n[a-194-1]-n[a+194+1])+Math.abs(n[a+194+1]-n[a+582+3])+Math.abs(r[a]-r[a+388+2]),m=n[a-194-1]-r[a-194-1],g=n[a-194+1]-r[a-194+1],_=n[a+194-1]-r[a+194-1],v=(l*(n[a+194+1]-r[a+194+1])+p*m)/(l+p),b=(u*_+d*g)/(u+d);n[a]=r[a]+y(i,b,v)}}for(let e=4;e<O-4;e++)for(let t=4+(o(e,1)&1),n=e*194+t;t<k-4;t+=2,n+=2){let e=d[n],t=.25*(d[n-194-1]+d[n-194+1]+(d[n+194-1]+d[n+194+1])),r=Math.abs(.5-e)<Math.abs(.5-t)?t:e,i=u[1],a=i[n],o=h+Math.abs(a-i[n-388]),s=h+Math.abs(a-i[n+388]),c=h+Math.abs(a-i[n-2]),l=h+Math.abs(a-i[n+2]),f=i[n-194],p=i[n+194],m=i[n-1],g=i[n+1];for(let e=0;e<=2;e+=2){let t=u[e],i=Math.abs(t[n-194]-t[n+194]),d=Math.abs(t[n-1]-t[n+1]),h=o+i+Math.abs(t[n-194]-t[n-582]),_=s+i+Math.abs(t[n+194]-t[n+582]),v=c+d+Math.abs(t[n-1]-t[n-3]),b=l+d+Math.abs(t[n+1]-t[n+3]),x=t[n-194]-f,S=t[n+194]-p,C=t[n-1]-m,w=t[n+1]-g,T=(h*S+_*x)/(h+_),E=(b*C+v*w)/(b+v);t[n]=a+y(r,E,T)}}let N=w+9,P=T-(s-1,9),F=E+9,I=D-(c-1,9);for(let t=N;t<P;t++)for(let n=F;n<I;n++){let r=(t-w)*194+n-E,a=(t*e+n)*4;i[a]=Math.max(0,u[0][r]*_),i[a+1]=Math.max(0,u[1][r]*_),i[a+2]=Math.max(0,u[2][r]*_)}}S(e,t,9,n,r,i)}function S(e,t,n,r,i,a){let o=(e,t)=>r[(e&1)<<1|t&1],s=[0,0,0],c=[0,0,0],l=(n,r)=>{s[0]=s[1]=s[2]=0,c[0]=c[1]=c[2]=0;for(let a=n-1;a<n+2;a++)if(!(a<0||a>=t))for(let t=r-1;t<r+2;t++){if(t<0||t>=e)continue;let n=o(a,t);s[n]+=i(a,t),c[n]++}let l=o(n,r),u=(n*e+r)*4;for(let e=0;e<3;e++)a[u+e]=e===l?i(n,r):s[e]/c[e]};for(let r=0;r<t;r++)if(r<n||r>=t-n)for(let t=0;t<e;t++)l(r,t);else{for(let t=0;t<Math.min(n,e);t++)l(r,t);for(let t=Math.max(n,e-n);t<e;t++)l(r,t)}}let C=.01,w=13500,T=[3.4,3.1,2.5,2.5,2.5,2.5,2.3,2.5,2.3,2.3,2.4,2.3,1.75,1.75,1.75,1.75,1.75,1.75,1.75,1.75,1.75,1.5,1.5,1.5,1.5,1.5,1.5,1.5],E=[3.45,3.15,3.45,3,3,3,2.7,2.7,2.7,2.5,2.5,2.5,2.4,2.4,2.4,2.4,2.4,2.4,2.4,2.4,2.4,2.4,2.4,2.4,2.4,2.4,2.4,2.4,2.4,2.4,2.4,2.4,2.4,2.4,2.4,2.4,2.4,2.4,2.4,2.4],D=[4,4,4,4,4,4,4,4,4,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3],O=[4.2,3.9,3.6,3.55,3.5,3.45,3.35,3.3,1.3,1.2,1.2,1.2,1.15,1.2,1.15,1.15,1.1,1.1,1.05,1.05,1.05,1,1,1,1,1,1,1,1.1,1.1,1.1];function k(e){let t=Math.round(Math.log2(e.iso/100)*3),n=e=>e[Math.min(e.length-1,Math.max(0,Number.isFinite(t)?t:0))];return/sony/i.test(e.make)?{nRead:n(O),ePerIso:.8}:e.model.includes(`K-3`)?{nRead:n(T),ePerIso:.35}:e.model.includes(`K-1`)?{nRead:n(E),ePerIso:.75}:{nRead:n(D),ePerIso:.5}}function A(e,t,n,r){let i=(e-t)*n;i*=i;let a=(e+t)*.5*n,o=C*a;return i-25*(a+r+o*o)}function j(e,t,n,r,i,a,o,s){if(e>a||t>a||n>a||r>a||i>a)return 0;let c=((e+t)*.5-i)*o;c*=c;let l=((n+r)*.5-i)*o;l*=l;let u=(e+t+(n+r))*.25*o,d=C*u;return Math.min(c,l)-25*(u+s+d*d)}function M(e,t){let n=Math.floor(t/2),r=0,i=0;for(;i<n;)i+=e[r],r++;let a=(i-t/2)/e[r-1];return a*(r-2)+(1-a)*(r-1)}function N(e,t,n){let r=n.map(e=>M(e,t));return r.map(t=>r[e]/t)}let P=e=>e>=65535?65535:e<=0?0:Math.floor(e);function F(e,t,r,i,a,s){let{width:c,height:l,cfa:u,frames:d}=e,f=(e,t)=>u[(e&1)<<1|t&1],p=(e,t,n)=>{let i=d[e],a=(t&1)<<1|n&1;return r[a][i.data[i.base+t*i.row+n*i.col+i.pos[a]]]},h=a.motionDetection,g=h&&a.showMotion,_=h&&a.showMaskOnly,v=1-a.smooth,y=a.smooth>0,S=a.fillFrame,C=e=>x(c,l,u,(e,t)=>o(d[S],r,e,t),s,e),T={mask:null,brightness:{red:[1,1,1,1],green:[1,1,1,1],blue:[1,1,1,1]}};if(h&&v===0&&!g&&!_)return C(),T;let E=n(u,t),D=e=>E[u.indexOf(e)],O=e=>t.white-t.black[u.indexOf(e)],M=k(i),F=M.ePerIso*2**(a.sensitivity-1)*(100/i.iso),L=F/D(0)*(65535/O(0)),te=F/D(1)*(65535/O(1)),ne=F/D(2)*(65535/O(2)),re=65535/D(0),ie=65535/D(2),R=M.nRead*M.nRead,z=[1,1,1,1],B=[1,1,1,1],V=[1,1,1,1];if(a.equalizeBrightness){let e=[0,1,2,3].map(()=>/* @__PURE__ */ new Uint32Array(65536)),t=[0,1,2,3].map(()=>/* @__PURE__ */ new Uint32Array(65536)),n=[0,1,2,3].map(()=>/* @__PURE__ */ new Uint32Array(65536));for(let r=1;r<l-1;r++){let i=f(r,1)+f(r,2)===3;for(let a=1,o=f(r,1)&1;a<c-1;a++,o^=1)e[1-o][P(p(1-o,r-o+1,a))]++,e[3-o][P(p(3-o,r+o,a+1))]++,i?(t[2-o][P(p(2-o,r+1,a-o+1))]++,n[3*o][P(p(3*o,r,a+o))]++):(t[3*o][P(p(3*o,r,a+o))]++,n[2-o][P(p(2-o,r+1,a-o+1))]++)}let r=Math.floor((l-2)*(c-2)/4),i=Math.floor((l-2)*(c-2)/2);z=N(S,r,t),V=N(S,r,n),B=N(S,i,e),a.equalizePerChannel||(z=B,V=B),T.brightness={red:z,green:B,blue:V}}let H=(e,t,n)=>{let i=d[e],a=(t&1)<<1|n&1;return{data:i.data,at:i.base+t*i.row+n*i.col+i.pos[a],step:2*i.col,table:r[a]}},U=(e,t)=>{let n=f(e,1)+f(e,2)===3,r=n?t.blue:t.red,i=n?t.red:t.blue;for(let a=1;a<=2;a++){let o=f(e,a)&1,s=(n?V:z)[3*o],l=(n?z:V)[2-o],u=B[1-o],d=B[3-o],p=H(3*o,e,a+o),m=H(2-o,e+1,a-o+1),h=H(1-o,e-o+1,a),g=H(3-o,e+o,a+1);for(let e=a,n=p.at,o=m.at,f=h.at,_=g.at;e<c-1;e+=2,n+=p.step,o+=m.step,f+=h.step,_+=g.step)r[e]=p.table[p.data[n]]*s,i[e]=m.table[m.data[o]]*l,t.g1[e]=h.table[h.data[f]]*u,t.g2[e]=g.table[g.data[_]]*d}},W=()=>({red:new Float32Array(c),blue:new Float32Array(c),g1:new Float32Array(c),g2:new Float32Array(c),row:-1});if(!h){let e=W();for(let t=1;t<l-1;t++){U(t,e);for(let n=1,r=(t*c+1)*4;n<c-1;n++,r+=4)s[r]=e.red[n],s[r+1]=(e.g1[n]+e.g2[n])*.5,s[r+2]=e.blue[n]}return I(s,c,l),T}let G=+(S===1||S===2),K=+(S===2||S===3),q=4-G,J=l-(4+G),Y=4-K,X=c-(4+K),ae=[W(),W(),W()],Z=e=>{let t=ae[e%3];return t.row!==e&&(U(e,t),t.row=e),t},Q=new Float32Array(c*l);for(let e=q;e<J;e++){let t=Z(e-1),n=Z(e),r=Z(e+1);for(let i=Y;i<X;i++){let a=e*c+i;Q[a]=.99,A(n.g1[i],n.g2[i],te,R)>0?Q[a]=2:(j(n.red[i+1],n.red[i-1],t.red[i],r.red[i],n.red[i],re,L,R)>0||j(n.blue[i+1],n.blue[i-1],t.blue[i],r.blue[i],n.blue[i],ie,ne,R)>0)&&(Q[a]=1.7)}}m(Q,c,l,1);let $=new Uint8Array(c*l);for(let e=q;e<J;e++)for(let t=Y;t<X;t++){let n=0;for(let r=-1;r<=1;r++){let i=(e+r)*c+t;n+=Q[i-1]+Q[i]+Q[i+1]}n>=11.91&&($[e*c+t]=255)}if(ee($,c,Y,X,q,J),T.mask=$,!_&&!g){let e=new b(c,l);for(let t=q;t<J;t++)for(let n=Y,r=t*c+n;n<X;n++,r++)($[r]===255||y&&Q[r]>1)&&e.need(t+G,n+K);C(e.wanted)}for(let e=q;e<J;e++){let t=Z(e);for(let n=Y;n<X;n++){let r=e*c+n,i=((e+G)*c+n+K)*4,a=Q[r]-1,o=y?v===0?1:a>0?a**+v:0:0;if(_){let e=y?o*32768:$[r]===255?65535:0;s[i]=s[i+1]=s[i+2]=e}else if($[r]===255)g&&(s[i]=0,s[i+1]=w,s[i+2]=0);else{let e=(t.g1[n]+t.g2[n])*.5;y?(s[i]=o*(g?0:s[i])+(1-o)*t.red[n],s[i+1]=o*(g?w:s[i+1])+(1-o)*e,s[i+2]=o*(g?0:s[i+2])+(1-o)*t.blue[n]):(s[i]=t.red[n],s[i+1]=e,s[i+2]=t.blue[n])}}}return T}function I(e,t,n){let r=(t,n)=>{e[t]=e[n],e[t+1]=e[n+1],e[t+2]=e[n+2]};for(let e=1;e<n-1;e++)r(e*t*4,(e*t+1)*4),r((e*t+t-1)*4,(e*t+t-2)*4);for(let e=0;e<t;e++)r(e*4,(t+e)*4),r(((n-1)*t+e)*4,((n-2)*t+e)*4)}function ee(e,t,n,r,i,a){if(r<=n||a<=i)return;let o=new Uint8Array(e.length),s=[],c=(n,r)=>{let i=n*t+r;e[i]===0&&!o[i]&&(o[i]=1,s.push(i))};for(let e=n;e<r;e++)c(i,e),c(a-1,e);for(let e=i;e<a;e++)c(e,n),c(e,r-1);for(let e=s.pop();e!==void 0;e=s.pop()){let o=Math.floor(e/t),s=e-o*t;o>i&&c(o-1,s),o<a-1&&c(o+1,s),s>n&&c(o,s-1),s<r-1&&c(o,s+1)}for(let s=i;s<a;s++)for(let i=n;i<r;i++){let n=s*t+i;e[n]===0&&!o[n]&&(e[n]=255)}}function L(e,t,n,r,i,a){let o=[0,0,0,0],s=[0,0,0,0],c=[0,0,0,0],l=[0,0,0,0];for(let t=0;t<r;t+=8){let u=Math.min(t+8,r);for(let r=0;r<n;r+=8){let d=Math.min(r+8,n);c.fill(0),l.fill(0);let f=!0;for(let n=t;n<u&&f;n++)for(let t=r;t<d;t++){let r=(n&1)<<1|t&1,o=e.data[e.base+n*e.row+t*e.col+e.pos[r]];if(o>a-25||o<i[r]+8){f=!1;break}c[r]+=o-i[r],l[r]++}if(f)for(let e=0;e<4;e++)o[e]+=c[e],s[e]+=l[e]}}let u=[0,0,0],d=[];for(let e=0;e<4;e++){if(o[e]<=0)return null;let n=s[e]/o[e];t[e]===1?d.push(n):u[t[e]]=n}return u[1]=d.reduce((e,t)=>e+t,0)/d.length,[u[0],u[1],u[2]]}function te(e,t,n){let r=Math.max(...e),i=Math.max(...t),a=a=>t[a]/i/(e[a]/r)*n;return[a(0),a(1),a(2)]}function ne(e,t,n){let r=e.col===1?1:4,i=0;for(let a=0;a<n;a++){let n=e.base+a*e.row;for(let a=0;a<t;a++)for(let t=0;t<r;t++){let r=e.data[n+a*e.col+t];r>i&&(i=r)}}return i}async function re(e){if(e.kind===`views`)return e.views;let{file:t,dataOffset:n,rawWidth:r,rawHeight:i,top:o,left:s,shots:c}=e,l=await t.slice(n,n+r*i*8).arrayBuffer(),u=new Uint16Array(l);if(u.length!==r*i*4)throw Error(`the file ends before its samples do`);return c.map(e=>a(u,r,o,s,e))}async function ie(e){let t=await re(e.source),n={width:e.width,height:e.height,cfa:e.cfa,frames:t},i=e.levels,a=s(i,ne(t[0],e.width,e.height)),o=e.binned?null:L(t[0],e.cfa,e.width,e.height,i.black,i.white),c=o?{...i,mul:o}:i,l=r(e.cfa,c),f=te(c.mul,i.mul,a);if(e.binned){let t=R(n,l);return u(t.data,i.mul,e.rgbCam,f),{...t,mask:null}}let p=new Float32Array(n.width*n.height*4),m=F(n,c,l,e.shot,e.settings,p);return e.settings.motionDetection&&e.settings.showMaskOnly?d(p):u(p,i.mul,e.rgbCam,f),{data:p,width:n.width,height:n.height,mask:m.mask}}function R(e,t){let n=Math.floor(e.width/2),r=Math.floor(e.height/2),i=e.frames[0],a=new Float32Array(n*r*4),o=e.cfa;for(let e=0;e<r;e++)for(let r=0;r<n;r++){let s=(e*n+r)*4;a[s]=a[s+1]=a[s+2]=0;for(let n=0;n<4;n++){let c=2*e+(n>>1),l=2*r+(n&1),u=t[n][i.data[i.base+c*i.row+l*i.col+i.pos[n]]];a[s+o[n]]+=o[n]===1?u*.5:u}}return{data:a,width:n,height:r}}onmessage=async e=>{let n;try{n={output:await ie(e.data)}}catch(e){n={error:e instanceof Error?e.message:String(e),transient:t(e)}}postMessage(n,{transfer:`output`in n?[n.output.data.buffer]:[]})}})();\n//# sourceMappingURL=merge-worker-BhDzdQbO.js.map", Q = typeof self < "u" && self.Blob && new Blob(["(self.URL || self.webkitURL).revokeObjectURL(self.location.href);", Z], { type: "text/javascript;charset=utf-8" });
function ce(e) {
	let t;
	try {
		if (t = Q && (self.URL || self.webkitURL).createObjectURL(Q), !t) throw "";
		let n = new Worker(t, { name: e?.name });
		return n.addEventListener("error", () => {
			(self.URL || self.webkitURL).revokeObjectURL(t);
		}), n;
	} catch {
		return new Worker("data:text/javascript;charset=utf-8," + encodeURIComponent(Z), { name: e?.name });
	}
}
//#endregion
//#region src/runtime.ts
function le(e) {
	let t = /* @__PURE__ */ new Set();
	if (e.source.kind === "views") for (let n of e.source.views) n.data.buffer instanceof ArrayBuffer && t.add(n.data.buffer);
	return [...t];
}
function ue(e, t) {
	let n;
	try {
		n = new ce({ name: "pixel-shift-merge" });
	} catch (e) {
		return Promise.reject(d(`the merge worker didn't start: ${e instanceof Error ? e.message : String(e)}`));
	}
	return new Promise((r, i) => {
		let a = () => {
			t.removeEventListener("abort", o), n.terminate();
		}, o = () => {
			a(), i(new DOMException("The decode was no longer needed.", "AbortError"));
		};
		t.addEventListener("abort", o, { once: !0 }), n.onmessage = ({ data: e }) => {
			a(), "output" in e ? r(e.output) : i(e.transient ? d(e.error) : Error(e.error));
		}, n.onerror = (e) => {
			a(), i(d(e.message || "the merge worker failed"));
		}, n.postMessage(e, le(e));
	});
}
var de = (e) => ({
	libraw: () => new X(e.assetUrl("dist/libraw/worker.js")),
	merge: ue
}), fe = 400;
function $(e) {
	return `1.0.1+${e}`;
}
function pe(e, t = de(e)) {
	e.registerSettings({
		title: "Pixel Shift Merge",
		fields: R,
		keywords: [
			"pixel shift",
			"multi shot",
			"motion",
			"Pentax",
			"Sony",
			"ARQ"
		]
	});
	let n = () => {
		let n = U((t, n) => e.settings.get(t, n));
		e.library.registerDecoder(N(n, $(W(n)), t));
	};
	n();
	let r;
	e.settings.onChange(() => {
		clearTimeout(r), r = setTimeout(n, 400);
	}), se(e, `${P}/${D}`);
}
//#endregion
export { fe as REREGISTER_DELAY_MS, pe as activate, $ as decoderVersion };

//# sourceMappingURL=index.js.map