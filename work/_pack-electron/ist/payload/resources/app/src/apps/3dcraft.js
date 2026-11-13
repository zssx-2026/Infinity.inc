/*
 * 3dcraft.js - 3DCraft, the geometry half of the Craft family.
 *
 * 3DCraft is the scene builder: it reads and writes the interchange formats a
 * modeller actually hands over (Wavefront OBJ, STL), measures them, and hands
 * the heavy lifting to the local Blender install when one exists.
 *
 * Everything here is real work on real bytes. parseObj walks the file line by
 * line, resolves the index forms OBJ allows (1-based, negative-relative, the
 * v/vt/vn triple with any part omitted) and fan-triangulates polygons so the
 * triangle count matches what a renderer would actually draw. parseStl reads
 * the binary record layout directly and falls back to the ASCII dialect when
 * the byte count does not agree with the declared triangle count. Neither
 * needs a dependency, a network call, or a running host.
 *
 * Two rules hold throughout:
 *   1. run() never throws. A missing file, an unknown format, a truncated STL
 *      and an unknown action all come back as ok:false with an uppercase snake
 *      error code, because the Studio shell renders whatever it is given.
 *   2. plan() is pure. It describes the steps and touches nothing, so the UI
 *      can show a preview before anything is read or written.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const META = {
  id: '3dcraft',
  name: '3DCraft',
  version: '1.0.0-pre5',
  branch: 'craft',
  codecs: [
    { ext: '.is-3dcp', since: '0.30.0' },
    { ext: '.is-3dcpx', since: '0.30.0' }
  ],
  hosts: ['blender']
};

const CODEC_SINCE = '0.30.0';

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function supportsCodec(version) {
  const a = parseVersion(version);
  const b = parseVersion(CODEC_SINCE);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function toVec3(value) {
  if (!Array.isArray(value) || value.length < 3) return [0, 0, 0];
  const x = Number(value[0]);
  const y = Number(value[1]);
  const z = Number(value[2]);
  return [isNum(x) ? x : 0, isNum(y) ? y : 0, isNum(z) ? z : 0];
}

function toVec2(value) {
  if (!Array.isArray(value) || value.length < 2) return [0, 0];
  const u = Number(value[0]);
  const v = Number(value[1]);
  return [isNum(u) ? u : 0, isNum(v) ? v : 0];
}

/* Shortest round-tripping decimal form: String(n) is exact, and the fixed
 * fallback only kicks in for exponent notation, which not every OBJ reader
 * in the wild accepts. */
function fmtNum(n) {
  if (!isNum(n)) return '0';
  const s = String(n);
  if (s.indexOf('e') !== -1 || s.indexOf('E') !== -1) return n.toFixed(12);
  return s;
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalOfTriangle(tri) {
  const n = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]));
  const len = Math.sqrt(dot(n, n));
  if (!len) return [0, 0, 0];
  return [n[0] / len, n[1] / len, n[2] / len];
}

/* ------------------------------------------------------------------ */
/* 包围盒与体积                                                        */
/* ------------------------------------------------------------------ */

export function boundsOf(points) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let count = 0;
  const list = Array.isArray(points) ? points : [];
  for (const point of list) {
    if (!Array.isArray(point) || point.length < 3) continue;
    let usable = false;
    for (let i = 0; i < 3; i += 1) {
      const value = Number(point[i]);
      if (!Number.isFinite(value)) continue;
      usable = true;
      if (value < min[i]) min[i] = value;
      if (value > max[i]) max[i] = value;
    }
    if (usable) count += 1;
  }
  if (!count) return { min: null, max: null, size: null, center: null, count: 0 };
  return {
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    count
  };
}

/* Signed volume by the divergence theorem: each triangle contributes the
 * tetrahedron it forms with the origin. A closed, outward-wound mesh sums to
 * its true volume; the sign carries the winding, which is why both the signed
 * and the absolute value are reported. */
export function computeVolume(triangles) {
  let signed = 0;
  let counted = 0;
  const list = Array.isArray(triangles) ? triangles : [];
  for (const tri of list) {
    if (!Array.isArray(tri) || tri.length < 3) continue;
    const a = toVec3(tri[0]);
    const b = toVec3(tri[1]);
    const c = toVec3(tri[2]);
    signed += dot(a, cross(b, c)) / 6;
    counted += 1;
  }
  return { signedVolume: signed, volume: Math.abs(signed), triangles: counted };
}

/* ------------------------------------------------------------------ */
/* Wavefront OBJ                                                       */
/* ------------------------------------------------------------------ */

function resolveObjIndex(token, count) {
  if (token === undefined || token === null || token === '') return -1;
  const n = parseInt(String(token), 10);
  if (!Number.isFinite(n) || n === 0) return -1;
  if (n > 0) return n - 1;
  const back = count + n;
  return back >= 0 ? back : -1;
}

export function parseObj(text) {
  if (typeof text !== 'string') throw new TypeError('OBJ 源必须是字符串');
  const vertices = [];
  const normals = [];
  const uvs = [];
  const polygons = [];
  const faces = [];
  const warnings = [];
  const groups = [];
  let currentGroup = null;

  const lines = text.split(/\r?\n/);
  for (let li = 0; li < lines.length; li += 1) {
    const raw = lines[li];
    const line = raw.trim();
    if (!line) continue;
    if (line[0] === '#') continue;
    const parts = line.split(/\s+/);
    const tag = parts[0];
    if (tag === 'v') {
      vertices.push([Number(parts[1]) || 0, Number(parts[2]) || 0, Number(parts[3]) || 0]);
    } else if (tag === 'vn') {
      normals.push([Number(parts[1]) || 0, Number(parts[2]) || 0, Number(parts[3]) || 0]);
    } else if (tag === 'vt') {
      uvs.push([Number(parts[1]) || 0, Number(parts[2]) || 0]);
    } else if (tag === 'f') {
      const refs = [];
      for (let i = 1; i < parts.length; i += 1) {
        const token = parts[i];
        if (!token) continue;
        const seg = token.split('/');
        const v = resolveObjIndex(seg[0], vertices.length);
        const vt = resolveObjIndex(seg[1], uvs.length);
        const vn = resolveObjIndex(seg[2], normals.length);
        if (v < 0 || v >= vertices.length) {
          warnings.push('第 ' + (li + 1) + ' 行顶点索引越界：' + token);
          continue;
        }
        refs.push([v, vt, vn]);
      }
      if (refs.length < 3) {
        warnings.push('第 ' + (li + 1) + ' 行有效顶点不足 3 个，已跳过');
        continue;
      }
      polygons.push(refs);
      if (currentGroup) currentGroup.faces += 1;
      /* Fan triangulation: a convex polygon of n vertices becomes n-2
       * triangles, which is what the renderer will actually submit. */
      for (let i = 1; i + 1 < refs.length; i += 1) {
        faces.push([refs[0], refs[i], refs[i + 1]]);
      }
    } else if (tag === 'o' || tag === 'g') {
      currentGroup = { kind: tag, name: parts.slice(1).join(' ') || null, at: faces.length, faces: 0 };
      groups.push(currentGroup);
    } else if (tag === 's' || tag === 'usemtl' || tag === 'mtllib' || tag === 'l' || tag === 'p') {
      /* 平滑组、材质与线/点元素不影响几何统计，留待渲染侧消费。 */
    }
  }

  const bounds = boundsOf(vertices);
  const points = faces.map((face) => [vertices[face[0][0]], vertices[face[1][0]], vertices[face[2][0]]]);
  const volume = computeVolume(points);

  return {
    format: 'obj',
    vertices,
    normals,
    uvs,
    faces,
    polygons,
    triangleCount: faces.length,
    polygonCount: polygons.length,
    groups,
    bounds,
    volume: volume.volume,
    signedVolume: volume.signedVolume,
    warnings
  };
}

export function exportObj(mesh) {
  const canonical = canonicalize(mesh);
  const out = [];
  out.push('# 3DCraft OBJ export');
  out.push('# vertices ' + canonical.vertices.length + ' normals ' + canonical.normals.length +
    ' uvs ' + canonical.uvs.length + ' triangles ' + canonical.faces.length);
  for (const v of canonical.vertices) out.push('v ' + fmtNum(v[0]) + ' ' + fmtNum(v[1]) + ' ' + fmtNum(v[2]));
  for (const t of canonical.uvs) out.push('vt ' + fmtNum(t[0]) + ' ' + fmtNum(t[1]));
  for (const n of canonical.normals) out.push('vn ' + fmtNum(n[0]) + ' ' + fmtNum(n[1]) + ' ' + fmtNum(n[2]));
  for (const face of canonical.faces) {
    const tokens = face.map((ref) => objToken(ref));
    out.push('f ' + tokens.join(' '));
  }
  return out.join('\n') + '\n';
}

function objToken(ref) {
  const v = ref[0] + 1;
  const vt = ref[1];
  const vn = ref[2];
  if (vt >= 0 && vn >= 0) return v + '/' + (vt + 1) + '/' + (vn + 1);
  if (vt >= 0) return v + '/' + (vt + 1);
  if (vn >= 0) return v + '//' + (vn + 1);
  return String(v);
}

/* ------------------------------------------------------------------ */
/* STL                                                                 */
/* ------------------------------------------------------------------ */

function looksLikeAsciiStl(buffer) {
  const head = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('utf8').toLowerCase();
  if (head.indexOf('facet normal') !== -1) return true;
  if (head.trimStart().startsWith('solid')) return head.indexOf('endsolid') !== -1 || head.indexOf('vertex') !== -1;
  return false;
}

export function parseStl(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const warnings = [];
  if (buf.length < 15) throw new Error('STL 文件太短，无法解析');

  let format = null;
  if (buf.length >= 84) {
    const declared = buf.readUInt32LE(80);
    const expected = 84 + declared * 50;
    if (expected === buf.length) format = 'binary';
    else if (expected <= buf.length && declared > 0 && !looksLikeAsciiStl(buf)) {
      format = 'binary';
      warnings.push('声明 ' + declared + ' 个三角，尾部多出 ' + (buf.length - expected) + ' 字节');
    }
  }
  if (!format) {
    if (looksLikeAsciiStl(buf)) format = 'ascii';
    else if (buf.length >= 84) {
      const declared = buf.readUInt32LE(80);
      throw new Error('STL 字节数 ' + buf.length + ' 与声明的三角数 ' + declared + ' 不匹配');
    } else {
      throw new Error('STL 既不是合法二进制也不是 ASCII 方言');
    }
  }

  if (format === 'ascii') return parseAsciiStl(buf.toString('utf8'), warnings);
  return parseBinaryStl(buf, warnings);
}

function parseBinaryStl(buf, warnings) {
  const declared = buf.readUInt32LE(80);
  const header = buf.subarray(0, 80).toString('utf8').replace(/\u0000+/g, '').trim();
  const triangles = [];
  const points = [];
  let offset = 84;
  for (let i = 0; i < declared; i += 1) {
    if (offset + 50 > buf.length) {
      warnings.push('三角数据在第 ' + i + ' 个处截断');
      break;
    }
    const normal = [buf.readFloatLE(offset), buf.readFloatLE(offset + 4), buf.readFloatLE(offset + 8)];
    const a = [buf.readFloatLE(offset + 12), buf.readFloatLE(offset + 16), buf.readFloatLE(offset + 20)];
    const b = [buf.readFloatLE(offset + 24), buf.readFloatLE(offset + 28), buf.readFloatLE(offset + 32)];
    const c = [buf.readFloatLE(offset + 36), buf.readFloatLE(offset + 40), buf.readFloatLE(offset + 44)];
    const attribute = buf.readUInt16LE(offset + 48);
    triangles.push({ normal, vertices: [a, b, c], attribute });
    points.push(a, b, c);
    offset += 50;
  }
  const volume = computeVolume(triangles.map((t) => t.vertices));
  return {
    format: 'binary',
    header,
    declaredTriangles: declared,
    triangles,
    triangleCount: triangles.length,
    bounds: boundsOf(points),
    volume: volume.volume,
    signedVolume: volume.signedVolume,
    warnings
  };
}

function parseAsciiStl(text, warnings) {
  const lines = text.split(/\r?\n/);
  const triangles = [];
  const points = [];
  let normal = [0, 0, 0];
  let verts = [];
  let solid = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const tag = parts[0].toLowerCase();
    if (tag === 'solid') {
      solid = parts.slice(1).join(' ') || null;
    } else if (tag === 'facet' && (parts[1] || '').toLowerCase() === 'normal') {
      normal = [Number(parts[2]) || 0, Number(parts[3]) || 0, Number(parts[4]) || 0];
      verts = [];
    } else if (tag === 'vertex') {
      verts.push([Number(parts[1]) || 0, Number(parts[2]) || 0, Number(parts[3]) || 0]);
    } else if (tag === 'endfacet') {
      if (verts.length === 3) {
        triangles.push({ normal: normal.slice(), vertices: verts.slice(), attribute: 0 });
        points.push(verts[0], verts[1], verts[2]);
      } else {
        warnings.push('endfacet 处顶点数为 ' + verts.length + '，已跳过');
      }
      verts = [];
    }
  }
  const volume = computeVolume(triangles.map((t) => t.vertices));
  return {
    format: 'ascii',
    header: solid,
    declaredTriangles: triangles.length,
    triangles,
    triangleCount: triangles.length,
    bounds: boundsOf(points),
    volume: volume.volume,
    signedVolume: volume.signedVolume,
    warnings
  };
}

export function exportStl(mesh, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const canonical = canonicalize(mesh);
  const tris = canonical.faces.map((face) => {
    const points = face.map((ref) => canonical.vertices[ref[0]] || [0, 0, 0]);
    const stored = face[0][2] >= 0 ? canonical.normals[face[0][2]] : null;
    return { points, normal: stored || normalOfTriangle(points) };
  });
  const buf = Buffer.alloc(84 + tris.length * 50);
  const label = typeof opts.header === 'string' ? opts.header : 'Infinity Studio 3DCraft binary STL';
  buf.write(label.slice(0, 79), 0, 80, 'utf8');
  buf.writeUInt32LE(tris.length, 80);
  let offset = 84;
  for (const tri of tris) {
    for (let i = 0; i < 3; i += 1) buf.writeFloatLE(tri.normal[i], offset + i * 4);
    for (let v = 0; v < 3; v += 1) {
      for (let i = 0; i < 3; i += 1) buf.writeFloatLE(tri.points[v][i], offset + 12 + v * 12 + i * 4);
    }
    buf.writeUInt16LE(0, offset + 48);
    offset += 50;
  }
  return buf;
}

/* ------------------------------------------------------------------ */
/* 规范化：把任意已解析网格收敛成 { vertices, normals, uvs, faces }     */
/* ------------------------------------------------------------------ */

function canonicalize(mesh) {
  if (!mesh || typeof mesh !== 'object') throw new TypeError('mesh 必须是对象');
  const vertices = Array.isArray(mesh.vertices) ? mesh.vertices.map(toVec3) : [];
  const normals = Array.isArray(mesh.normals) ? mesh.normals.map(toVec3) : [];
  const uvs = Array.isArray(mesh.uvs) ? mesh.uvs.map(toVec2) : [];
  const out = { vertices, normals, uvs, faces: [] };

  if (Array.isArray(mesh.faces) && mesh.faces.length && Array.isArray(mesh.faces[0]) &&
    Array.isArray(mesh.faces[0][0])) {
    out.faces = mesh.faces.map((face) => face.map((ref) => [Number(ref[0]) || 0, ref[1] === undefined ? -1 : Number(ref[1]), ref[2] === undefined ? -1 : Number(ref[2])]));
    return out;
  }
  if (Array.isArray(mesh.triangles) && mesh.triangles.length) {
    const first = mesh.triangles[0];
    if (first && Array.isArray(first.vertices)) {
      const index = new Map();
      const weldVerts = [];
      const weldNormals = [];
      const faces = [];
      for (const tri of mesh.triangles) {
        const points = (tri.vertices || []).map(toVec3);
        if (points.length < 3) continue;
        const normal = Array.isArray(tri.normal) ? toVec3(tri.normal) : normalOfTriangle(points);
        weldNormals.push(normal);
        const ni = weldNormals.length - 1;
        const refs = points.map((point) => {
          const key = point.map((n) => Math.round(n * 1e6) / 1e6).join(',');
          let vi = index.get(key);
          if (vi === undefined) {
            vi = weldVerts.length;
            index.set(key, vi);
            weldVerts.push(point);
          }
          return [vi, -1, ni];
        });
        faces.push(refs);
      }
      out.vertices = weldVerts;
      out.normals = weldNormals;
      out.faces = faces;
      return out;
    }
    if (first && Array.isArray(first[0])) {
      out.faces = mesh.triangles.map((face) => face.map((ref) => [Number(ref[0]) || 0, ref[1] === undefined ? -1 : Number(ref[1]), ref[2] === undefined ? -1 : Number(ref[2])]));
      return out;
    }
  }
  if (Array.isArray(mesh.polygons) && mesh.polygons.length) {
    for (const poly of mesh.polygons) {
      for (let i = 1; i + 1 < poly.length; i += 1) {
        out.faces.push([poly[0].slice(), poly[i].slice(), poly[i + 1].slice()]);
      }
    }
    return out;
  }
  throw new Error('无法识别的网格结构：需要 vertices/faces 或 triangles');
}

/* ------------------------------------------------------------------ */
/* 文件读取与格式识别                                                  */
/* ------------------------------------------------------------------ */

function sniffFormat(buf, filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.obj') return 'obj';
  if (ext === '.stl') return 'stl';
  if (ext === '.json') return 'json';
  if (buf.length >= 84) {
    const declared = buf.readUInt32LE(80);
    if (84 + declared * 50 === buf.length && declared > 0) return 'stl';
  }
  const head = buf.subarray(0, Math.min(buf.length, 2048)).toString('utf8').trim().toLowerCase();
  if (head.startsWith('solid') || head.indexOf('facet normal') !== -1) return 'stl';
  if (head.startsWith('v ') || head.indexOf('\nv ') !== -1 || head.indexOf('\nvn ') !== -1 ||
    head.indexOf('\nvt ') !== -1 || head.indexOf('\nf ') !== -1) return 'obj';
  if (head.startsWith('{') || head.startsWith('[')) return 'json';
  return null;
}

function loadMesh(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return { ok: false, error: 'MISSING_INPUT', message: '缺少输入文件路径' };
  }
  const abs = path.resolve(filePath);
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch (err) {
    return { ok: false, error: 'FILE_NOT_FOUND', message: '读不到文件：' + abs };
  }
  if (!stat.isFile()) {
    return { ok: false, error: 'NOT_A_FILE', message: '不是普通文件：' + abs };
  }
  let buf;
  try {
    buf = fs.readFileSync(abs);
  } catch (err) {
    return { ok: false, error: 'READ_FAILED', message: '读取失败：' + ((err && err.message) || abs) };
  }
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const format = sniffFormat(buf, abs);
  if (!format) {
    return { ok: false, error: 'UNSUPPORTED_FORMAT', message: '无法识别的网格格式：' + abs };
  }
  try {
    if (format === 'obj') {
      const mesh = parseObj(buf.toString('utf8'));
      return { ok: true, path: abs, bytes: stat.size, sha256, format, mesh };
    }
    if (format === 'stl') {
      const mesh = parseStl(buf);
      return { ok: true, path: abs, bytes: stat.size, sha256, format: 'stl', mesh };
    }
    const json = JSON.parse(buf.toString('utf8'));
    const canonical = canonicalize(json);
    const points = canonical.faces.map((face) => [canonical.vertices[face[0][0]], canonical.vertices[face[1][0]], canonical.vertices[face[2][0]]]);
    const volume = computeVolume(points);
    const mesh = {
      format: 'json',
      vertices: canonical.vertices,
      normals: canonical.normals,
      uvs: canonical.uvs,
      faces: canonical.faces,
      triangleCount: canonical.faces.length,
      bounds: boundsOf(canonical.vertices),
      volume: volume.volume,
      signedVolume: volume.signedVolume,
      warnings: []
    };
    return { ok: true, path: abs, bytes: stat.size, sha256, format: 'json', mesh };
  } catch (err) {
    return { ok: false, error: 'PARSE_FAILED', message: (err && err.message) || String(err) };
  }
}

function normalizeInput(input) {
  if (typeof input === 'string') return { input, output: null, format: null, version: null, text: null };
  if (input && typeof input === 'object') {
    return {
      input: input.input || input.path || input.file || null,
      output: input.output || input.out || input.target || null,
      format: input.format || input.to || null,
      version: input.version || null,
      text: typeof input.text === 'string' ? input.text : null
    };
  }
  return { input: null, output: null, format: null, version: null, text: null };
}

function meshSummary(mesh) {
  const faces = Array.isArray(mesh.faces) ? mesh.faces : [];
  const triangles = Array.isArray(mesh.triangles) ? mesh.triangles : [];
  const bounds = mesh.bounds && mesh.bounds.min ? mesh.bounds : boundsOf(mesh.vertices || []);
  return {
    format: mesh.format || null,
    vertices: Array.isArray(mesh.vertices) ? mesh.vertices.length : 0,
    normals: Array.isArray(mesh.normals) ? mesh.normals.length : 0,
    uvs: Array.isArray(mesh.uvs) ? mesh.uvs.length : 0,
    triangles: faces.length || triangles.length,
    polygons: Array.isArray(mesh.polygons) ? mesh.polygons.length : null,
    bounds,
    volume: typeof mesh.volume === 'number' ? mesh.volume : null,
    signedVolume: typeof mesh.signedVolume === 'number' ? mesh.signedVolume : null,
    warnings: Array.isArray(mesh.warnings) ? mesh.warnings.slice() : []
  };
}

/* ------------------------------------------------------------------ */
/* 宿主探测                                                            */
/* ------------------------------------------------------------------ */

function probeBlender() {
  const record = {
    id: 'blender',
    name: 'Blender',
    kind: 'renderer',
    found: false,
    path: null,
    version: null,
    source: null,
    banner: null,
    error: null
  };
  const candidates = [];
  if (process.env.BLENDER_PATH) candidates.push({ cmd: process.env.BLENDER_PATH, source: 'env' });
  candidates.push({ cmd: 'blender', source: 'PATH' });
  const roots = [];
  if (process.env.ProgramFiles) roots.push(path.join(process.env.ProgramFiles, 'Blender Foundation'));
  else roots.push('C:/Program Files/Blender Foundation');
  if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Blender Foundation'));
  roots.push('C:/Program Files (x86)/Steam/steamapps/common/Blender');
  for (const root of roots) {
    let entries = [];
    try {
      if (!fs.existsSync(root)) continue;
      entries = fs.readdirSync(root);
    } catch (err) {
      continue;
    }
    for (const entry of entries) {
      const exe = path.join(root, entry, 'blender.exe');
      try {
        if (fs.existsSync(exe)) candidates.push({ cmd: exe, source: 'install' });
      } catch (err) {
        /* 目录不可读就当它不存在 */
      }
    }
    const direct = path.join(root, 'blender.exe');
    try {
      if (fs.existsSync(direct)) candidates.push({ cmd: direct, source: 'install' });
    } catch (err) {
      /* 同上 */
    }
  }

  for (const candidate of candidates) {
    let result = null;
    try {
      result = spawnSync(candidate.cmd, ['--version'], {
        timeout: 8000,
        windowsHide: true,
        encoding: 'utf8'
      });
    } catch (err) {
      continue;
    }
    if (!result || result.error || result.status !== 0) continue;
    const text = String(result.stdout || '').split('\n')[0].trim();
    const m = text.match(/Blender\s+([0-9][0-9.]*)/i);
    return {
      ...record,
      found: true,
      path: candidate.cmd,
      version: m ? m[1] : null,
      source: candidate.source,
      banner: text || null,
      error: null
    };
  }
  return { ...record, error: 'HOST_NOT_FOUND' };
}

export function renderers() {
  const list = [];
  list.push({
    id: 'native',
    name: '3DCraft 内置网格管线',
    kind: 'software',
    found: true,
    path: null,
    version: META.version,
    source: 'builtin',
    banner: '解析、统计、转换在本进程完成，不依赖外部渲染器',
    error: null
  });
  list.push(probeBlender());
  return list;
}

/* ------------------------------------------------------------------ */
/* 能力面                                                              */
/* ------------------------------------------------------------------ */

export function capabilities() {
  return {
    id: META.id,
    name: META.name,
    version: META.version,
    features: [
      'obj-parse',
      'stl-parse',
      'obj-export',
      'stl-export',
      'mesh-stats',
      'mesh-convert',
      'mesh-bounds',
      'renderer-probe'
    ],
    formats: ['obj', 'stl', 'json'],
    hosts: META.hosts.slice(),
    implemented: true
  };
}

export function plan(action, input) {
  const act = String(action || '').toLowerCase();
  const opts = normalizeInput(input);
  const steps = [];
  const warnings = [];

  if (act === 'stats' || act === 'bounds') {
    if (!opts.input) warnings.push('缺少输入文件路径');
    if (opts.version && !supportsCodec(opts.version)) {
      warnings.push('项目版本 ' + opts.version + ' 低于 3DCraft 编解码门槛 ' + CODEC_SINCE);
    }
    steps.push({ kind: 'read', detail: '读取网格文件 ' + (opts.input || '<未指定>') });
    steps.push({ kind: 'parse', detail: '按扩展名与魔数识别 OBJ / STL / JSON，解析顶点、法线、UV 与三角面' });
    if (act === 'stats') {
      steps.push({ kind: 'measure', detail: '统计顶点数、三角数、包围盒、体积并计算文件 SHA-256' });
    } else {
      steps.push({ kind: 'measure', detail: '只计算包围盒与中心点' });
    }
    return { ok: true, action: act, steps, warnings };
  }

  if (act === 'convert' || act === 'export') {
    const target = String(opts.format || path.extname(String(opts.output || '')).replace('.', '') || '').toLowerCase();
    if (!opts.input) warnings.push('缺少输入文件路径');
    if (!opts.output) warnings.push('缺少输出文件路径');
    if (!target) warnings.push('无法确定目标格式，请在 format 或输出扩展名中指定');
    if (target && ['obj', 'stl', 'json'].indexOf(target) === -1) warnings.push('目标格式 ' + target + ' 不受支持');
    steps.push({ kind: 'read', detail: '读取 ' + (opts.input || '<未指定>') });
    steps.push({ kind: 'parse', detail: '解析为统一的顶点/面表示' });
    steps.push({ kind: 'encode', detail: '按 ' + (target || '<未确定>') + ' 重新编码' });
    steps.push({ kind: 'write', detail: '写入 ' + (opts.output || '<未指定>') + ' 并回读校验字节数' });
    return { ok: warnings.length === 0, action: act, steps, warnings };
  }

  if (act === 'parse') {
    steps.push({ kind: 'parse', detail: '直接解析调用方传入的 OBJ 文本' });
    return { ok: true, action: act, steps, warnings };
  }

  return { ok: false, action: act || null, steps: [], warnings: ['未知动作：' + String(action)], error: 'UNKNOWN_ACTION' };
}

/* ------------------------------------------------------------------ */
/* 执行面                                                              */
/* ------------------------------------------------------------------ */

function fail(action, error, message) {
  return { ok: false, action, error, message };
}

function doStats(input) {
  const opts = normalizeInput(input);
  const loaded = loadMesh(opts.input);
  if (!loaded.ok) return { ok: false, error: loaded.error, message: loaded.message };
  const summary = meshSummary(loaded.mesh);
  return {
    ok: true,
    result: {
      path: loaded.path,
      format: loaded.format,
      bytes: loaded.bytes,
      sha256: loaded.sha256,
      vertices: summary.vertices,
      normals: summary.normals,
      uvs: summary.uvs,
      triangles: summary.triangles,
      polygons: summary.polygons,
      bounds: summary.bounds,
      size: summary.bounds.size,
      center: summary.bounds.center,
      volume: summary.volume,
      signedVolume: summary.signedVolume,
      warnings: summary.warnings
    }
  };
}

function doBounds(input) {
  const opts = normalizeInput(input);
  const loaded = loadMesh(opts.input);
  if (!loaded.ok) return { ok: false, error: loaded.error, message: loaded.message };
  const bounds = loaded.mesh.bounds && loaded.mesh.bounds.min
    ? loaded.mesh.bounds
    : boundsOf(loaded.mesh.vertices || []);
  return {
    ok: true,
    result: {
      path: loaded.path,
      format: loaded.format,
      sha256: loaded.sha256,
      bounds,
      size: bounds.size,
      center: bounds.center,
      triangles: meshSummary(loaded.mesh).triangles
    }
  };
}

function doConvert(input) {
  const opts = normalizeInput(input);
  if (!opts.output) return { ok: false, error: 'MISSING_OUTPUT', message: '缺少输出文件路径' };
  const loaded = loadMesh(opts.input);
  if (!loaded.ok) return { ok: false, error: loaded.error, message: loaded.message };

  const target = String(opts.format || path.extname(String(opts.output)).replace('.', '') || '').toLowerCase();
  if (['obj', 'stl', 'json'].indexOf(target) === -1) {
    return { ok: false, error: 'UNSUPPORTED_FORMAT', message: '不支持的目标格式：' + (target || '<空>') };
  }

  const outPath = path.resolve(String(opts.output));
  const canonical = canonicalize(loaded.mesh);
  let buffer;
  try {
    if (target === 'obj') {
      buffer = Buffer.from(exportObj(canonical), 'utf8');
    } else if (target === 'stl') {
      buffer = exportStl(canonical);
    } else {
      const points = canonical.faces.map((face) => [canonical.vertices[face[0][0]], canonical.vertices[face[1][0]], canonical.vertices[face[2][0]]]);
      const volume = computeVolume(points);
      buffer = Buffer.from(JSON.stringify({
        format: 'is-3d-mesh',
        generator: '3DCraft ' + META.version,
        source: loaded.path,
        vertices: canonical.vertices,
        normals: canonical.normals,
        uvs: canonical.uvs,
        triangles: canonical.faces,
        triangleCount: canonical.faces.length,
        bounds: boundsOf(canonical.vertices),
        volume: volume.volume
      }, null, 2), 'utf8');
    }
  } catch (err) {
    return { ok: false, error: 'ENCODE_FAILED', message: (err && err.message) || String(err) };
  }

  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buffer);
  } catch (err) {
    return { ok: false, error: 'WRITE_FAILED', message: '写入失败：' + ((err && err.message) || outPath) };
  }

  let written = 0;
  try {
    written = fs.statSync(outPath).size;
  } catch (err) {
    written = 0;
  }
  if (written !== buffer.length) {
    return { ok: false, error: 'WRITE_VERIFY_FAILED', message: '回读字节数不一致：期望 ' + buffer.length + '，实际 ' + written };
  }

  return {
    ok: true,
    result: {
      input: loaded.path,
      output: outPath,
      from: loaded.format,
      to: target,
      bytes: written,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      vertices: canonical.vertices.length,
      triangles: canonical.faces.length,
      bounds: boundsOf(canonical.vertices)
    }
  };
}

function doParseText(input) {
  const opts = normalizeInput(input);
  const text = typeof opts.text === 'string' ? opts.text : (typeof input === 'string' && input.indexOf('\n') !== -1 ? input : null);
  if (typeof text !== 'string') return { ok: false, error: 'MISSING_TEXT', message: '缺少 OBJ 文本' };
  let mesh;
  try {
    mesh = parseObj(text);
  } catch (err) {
    return { ok: false, error: 'PARSE_FAILED', message: (err && err.message) || String(err) };
  }
  const summary = meshSummary(mesh);
  return { ok: true, result: { format: 'obj', bytes: Buffer.byteLength(text, 'utf8'), ...summary } };
}

export function run(action, input) {
  const act = String(action || '').toLowerCase();
  try {
    if (act === 'stats') return { action: act, ...doStats(input) };
    if (act === 'bounds') return { action: act, ...doBounds(input) };
    if (act === 'convert' || act === 'export') return { action: act, ...doConvert(input) };
    if (act === 'parse') return { action: act, ...doParseText(input) };
    if (act === 'renderers' || act === 'probe') {
      return { ok: true, action: act, result: { renderers: renderers() } };
    }
    return fail(act || null, 'UNKNOWN_ACTION', '未知动作：' + String(action));
  } catch (err) {
    return fail(act || null, 'INTERNAL_ERROR', (err && err.message) || String(err));
  }
}

export default {
  META,
  capabilities,
  plan,
  run,
  parseObj,
  parseStl,
  exportObj,
  exportStl,
  boundsOf,
  computeVolume,
  renderers,
  supportsCodec
};
