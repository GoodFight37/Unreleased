struct Params {
  size: vec2f, pointer: vec2f,
  lens: vec4f,
  tint: vec4f,
  backdrop: vec4f, // x: hasCover, y: bgInvW, z: bgInvH, w: surfaceCount
  rect: vec4f, // normalized center and half-size, measured from DOM
  play: vec4f, // normalized center, radius in scene height, unused
  optics: vec4f, // refraction, rim, fringe, tint opacity
  look: vec4f, // frost mix, time, caustic, bevel
};
struct Surface {
  rect: vec4f, // cx_px, cy_px, halfW_px, halfH_px
  info: vec4f, // radius_px, kind, layer, hasPlayFusion
};
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var cover: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var blurred: texture_2d<f32>;
@group(0) @binding(4) var<uniform> surfaces: array<Surface, 32>;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let xy = array<vec2f, 3>(vec2f(-1., -1.), vec2f(3., -1.), vec2f(-1., 3.)); return vec4f(xy[i], 0., 1.);
}
fn smin(a: f32, b: f32, k: f32) -> f32 { let h = max(k - abs(a - b), 0.) / k; return min(a, b) - h*h*k*0.25; }
fn rounded_box(q: vec2f, b: vec2f, r: f32) -> f32 { let d = abs(q) - b + vec2f(r); return length(max(d, vec2f(0.))) + min(max(d.x, d.y), 0.) - r; }

fn scene_shape(uv: vec2f, aspect: f32, barScale: f32) -> vec2f {
  let q = (uv - p.rect.xy) * vec2f(aspect, 1.);
  let halfSize = p.rect.zw * vec2f(aspect, 1.);
  let radius = min(halfSize.y * 0.48, 0.26);
  let body = rounded_box(q, halfSize, radius);
  let dropq = (uv - p.play.xy) * vec2f(aspect, 1.);
  let drop = length(dropq) - p.play.z * (1.0 + p.lens.w * 0.22);
  let d = smin(body, drop, 0.018 * barScale);
  let lensq = (uv - p.lens.xy) * vec2f(aspect, 1.);
  let lensRadius = (0.020 + 0.015 * p.lens.z) * barScale;
  let lensd = length(lensq) - lensRadius;
  let shape = smin(d, lensd + (1. - p.lens.z) * 0.08 * barScale, 0.014 * barScale);
  return vec2f(body, shape);
}

fn background(uv: vec2f) -> vec3f {
  let c = textureSampleLevel(cover, samp, clamp(uv, vec2f(0.), vec2f(1.)), 0.).rgb;
  // Multi-lobe ambient field (no periodic wave ripples) so idle glass always has smooth depth to refract.
  let l1 = exp(-length((uv - vec2f(0.80, 0.16)) * vec2f(1.0, 1.35)) * 2.2);
  let l2 = exp(-length((uv - vec2f(0.18, 0.84)) * vec2f(1.05, 1.25)) * 2.1);
  let l3 = exp(-length((uv - vec2f(0.46, 0.44)) * vec2f(1.2, 1.1)) * 2.6);
  let secTint = vec3f(p.tint.g * 0.55 + 0.32, p.tint.b * 0.45 + 0.14, p.tint.r * 0.65 + 0.28);
  let triTint = mix(p.tint.rgb, vec3f(0.42, 0.68, 0.96), 0.55);
  let grad = 0.5 + 0.5 * (uv.x * 0.35 + uv.y * 0.65 - 0.5);
  let dark = vec3f(0.030, 0.034, 0.052)
    + p.tint.rgb * l1 * 0.42
    + secTint * l2 * 0.30
    + triTint * l3 * 0.18
    + vec3f(0.018, 0.022, 0.036) * grad;
  let light = vec3f(0.83, 0.86, 0.91)
    + p.tint.rgb * l1 * 0.14
    + secTint * l2 * 0.10
    + triTint * l3 * 0.07
    - vec3f(0.03) * grad;
  let artDark = min(c * 1.15, vec3f(1.)) * 0.76 + dark * 0.24;
  let artLight = mix(c * 0.76 + light * 0.24, c * 0.68 + light * 0.32, 0.35);
  let art = mix(artDark, artLight, p.tint.w);
  return select(mix(dark, light, p.tint.w), art, p.backdrop.x > 0.5);
}

@fragment fn fsBackground(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let inv = select(1. / ceil(p.size * 0.5), p.backdrop.yz, p.backdrop.y > 0. && p.backdrop.z > 0.);
  return vec4f(background(pos.xy * inv), 1.);
}

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / p.size; let aspect = p.size.x / p.size.y;
  let barScale = max(1.0, p.rect.w / 0.12);
  let sdf = scene_shape(uv, aspect, barScale);
  let shape = sdf.y;
  let aa = 0.0016 * barScale;
  let inside = 1. - smoothstep(-aa, aa, shape);
  let rim = exp(-abs(shape) * (145. / barScale));
  let eps = 0.001 * barScale;
  let dx = scene_shape(uv + vec2f(eps / aspect, 0.), aspect, barScale).y - shape;
  let dy = scene_shape(uv + vec2f(0., eps), aspect, barScale).y - shape;
  let normal = normalize(vec2f(dx, dy) + vec2f(0.00001));
  let edge = exp(-abs(shape) * (52. / barScale));
  let lensq = (uv - p.lens.xy) * vec2f(aspect, 1.);
  let lensFalloff = exp(-length(lensq) * (23. / barScale)) * p.lens.z;
  let bev = edge + edge * edge * p.look.w * 0.9;
  let shift = normal * bev * p.optics.x + lensq * lensFalloff * -0.65;
  let refracted = clamp(uv - shift / vec2f(aspect, 1.), vec2f(0.), vec2f(1.));
  let fringe = pow(edge, 1.8) * inside * p.optics.z * (1.2 + p.look.w * 0.8);
  let sharp = background(refracted);
  let frost = textureSampleLevel(blurred, samp, refracted, 0.).rgb;
  let glass = mix(sharp, frost, p.look.x);
  let chroma = vec3f(textureSampleLevel(blurred, samp, clamp(refracted + normal * fringe, vec2f(0.), vec2f(1.)), 0.).r, glass.g, textureSampleLevel(blurred, samp, clamp(refracted - normal * fringe, vec2f(0.), vec2f(1.)), 0.).b);
  let lightDir = normalize((p.pointer - uv)*vec2f(aspect, 1.) + vec2f(0.001));
  let shine = pow(max(dot(normal, lightDir), 0.), 2.5) * rim;
  // Bounded tint: white text on dark glass, dark text on light glass.
  let tintColor = mix(vec3f(0.025,0.035,0.055), vec3f(0.92,0.94,0.98), p.tint.w);
  let toned = mix(chroma, tintColor, p.optics.w);
  let caustic = p.tint.rgb * edge * (1. - p.tint.w) * 0.08;
  let body = toned + caustic;
  // Soft compression keeps relief inside the WCAG bounds (0.29 dark / 0.78 light) instead of a flat clamp.
  let darkBody = vec3f(0.29) * (vec3f(1.) - exp(-body * 1.7 / 0.29));
  let lightBody = vec3f(1.) - vec3f(0.22) * (vec3f(1.) - exp(-(vec3f(1.) - body) * 1.7 / 0.22));
  let accessible = mix(darkBody, lightBody, p.tint.w);
  let spec = (rim * p.optics.y * 0.55 + shine * p.optics.y * 1.45) * (1. + p.look.w * 0.65);
  let lit = accessible + spec * mix(vec3f(1.), vec3f(0.75,0.82,0.94), p.tint.w) * inside;
  let result = mix(background(uv), min(lit, vec3f(1.)), inside);
  return vec4f(result, 1.);
}

fn surface_sdf(px: vec2f, s: Surface) -> f32 {
  let r = min(s.info.x, min(s.rect.z, s.rect.w));
  var d = rounded_box(px - s.rect.xy, s.rect.zw, r);
  if (s.info.w > 0.5 && s.info.y < 4.5) {
    let playCenter = p.play.xy * p.size;
    let playR = p.play.z * p.size.y * (1.0 + p.lens.w * 0.18);
    let drop = length(px - playCenter) - playR;
    d = smin(d, drop, 15.0);
    let lensCenter = p.lens.xy * p.size;
    let lensR = 14.0 + 10.0 * p.lens.z;
    let lensd = length(px - lensCenter) - lensR;
    d = smin(d, lensd + (1. - p.lens.z) * 48.0, 10.0);
  }
  return d;
}

@fragment fn fsCompositor(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let px = pos.xy;
  let count = min(32, i32(p.backdrop.w));
  let passOverlay = p.rect.x > 0.5;
  var bestD = 1e6;
  var bestLayer = -1.0;
  var bestIdx = -1;
  for (var i = 0; i < count; i = i + 1) {
    let s = surfaces[i];
    if (abs(s.info.y - 6.0) < 0.2) { continue; }
    let isOverlay = s.info.z >= 1.5;
    if (isOverlay != passOverlay) { continue; }
    let q = abs(px - s.rect.xy) - s.rect.zw;
    if (q.x > 30. || q.y > 30.) { continue; }
    let d = surface_sdf(px, s);
    let layer = s.info.z;
    let limit = select(2.5, 13.0, s.info.y > 4.5);
    if (d < limit && (layer > bestLayer || (layer == bestLayer && d < bestD))) {
      bestD = d;
      bestLayer = layer;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) { return vec4f(0., 0., 0., 0.); }
  let s = surfaces[bestIdx];
  let uv = px / p.size;
  let aspect = p.size.x / p.size.y;

  // Slider thumb liquid glass pill + drop shadow + optical track loupe (Seek & Volume)
  if (s.info.y > 4.5 && s.info.y < 5.5) {
    let aa = 1.0;
    let inside = 1. - smoothstep(-aa, aa, bestD);
    // Soft shadow beneath pill (0 2px 8px): 18% black in dark mode, light-blue soft halo + hairline in light mode.
    if (inside <= 0.001) {
      let shDist = max(0., surface_sdf(px - vec2f(0., 2.2), s));
      let shAlpha = exp(-shDist * 0.34) * mix(0.22, 0.24, p.tint.w) * (1. - inside);
      let shCol = mix(vec3f(0.0), vec3f(0.18, 0.34, 0.62), p.tint.w);
      return vec4f(shCol * shAlpha, shAlpha);
    }
    let trackInfo = surfaces[min(bestIdx + 1, 31)];
    let lensBoost = clamp(trackInfo.info.w, 0., 1.);
    let dx = surface_sdf(px + vec2f(1., 0.), s) - bestD;
    let dy = surface_sdf(px + vec2f(0., 1.), s) - bestD;
    let normal = normalize(vec2f(dx, dy) + vec2f(0.0001));
    let rim = exp(-abs(bestD) * 0.92);
    let edge = exp(-abs(bestD) * 0.22);
    let centerQ = (px - s.rect.xy) / max(s.rect.zw, vec2f(1.));
    let radialLens = exp(-dot(centerQ, centerQ) * 1.15);
    // Magnify & refract background + underlying slider track smoothly with ~0.6px micro-frost.
    let magStrength = mix(0.24, 0.48, lensBoost);
    let refrPx = px - (px - s.rect.xy) * (magStrength * radialLens) + normal * (edge * 5.5 * (0.65 + lensBoost));
    let refrUv = clamp(refrPx / p.size, vec2f(0.), vec2f(1.));
    let bgSharp = background(refrUv);
    let bgSoft = textureSampleLevel(blurred, samp, refrUv, 0.).rgb;
    var domeCol = mix(bgSharp, bgSoft, 0.16 + 0.16 * lensBoost);
    // Analytically project & magnify the 5px track + accent fill behind the loupe dome.
    let trackY = trackInfo.rect.z;
    let trackHalfH = 2.6 * (1.0 + 0.42 * radialLens * (0.45 + lensBoost));
    let inTrackY = 1.0 - smoothstep(trackHalfH - 0.9, trackHalfH + 0.9, abs(refrPx.y - trackY));
    let inTrackX = step(trackInfo.rect.x, refrPx.x) * step(refrPx.x, trackInfo.rect.y);
    let splitX = mix(trackInfo.rect.x, trackInfo.rect.y, trackInfo.rect.w);
    let isFilled = 1.0 - smoothstep(splitX - 0.8, splitX + 0.8, refrPx.x);
    let railBase = mix(vec3f(0.38, 0.42, 0.50), vec3f(0.68, 0.73, 0.82), p.tint.w);
    let railCol = mix(railBase, min(p.tint.rgb * 1.28 + vec3f(0.14), vec3f(1.)), isFilled);
    domeCol = mix(domeCol, railCol, inTrackY * inTrackX * 0.85);
    // Specular: ~1.5px crisp bright white top edge + curved crystal dome sheen + pointer highlight + subtle bottom rim.
    let topEdge = pow(max(-normal.y, 0.), 1.35) * exp(-abs(bestD) * 0.50);
    let botEdge = pow(max(normal.y, 0.), 1.8) * exp(-abs(bestD) * 0.82);
    let ptrDir = normalize((p.pointer - uv) * vec2f(aspect, 1.) + vec2f(0.001));
    let ptrSpec = pow(max(dot(normal, ptrDir), 0.), 2.8) * rim;
    let crystalVeil = mix(vec3f(0.76, 0.82, 0.92), vec3f(0.96, 0.98, 1.0), p.tint.w);
    let veilMix = mix(0.32, 0.16, lensBoost);
    let domeGlint = clamp(0.5 - centerQ.y, 0., 1.) * mix(0.16, 0.10, p.tint.w);
    let veil = mix(domeCol, crystalVeil, veilMix) + vec3f(domeGlint);
    let fringe = pow(edge, 1.8) * p.optics.z * 2.1;
    let prism = vec3f(
      textureSampleLevel(blurred, samp, clamp(refrUv + normal * fringe, vec2f(0.), vec2f(1.)), 0.).r,
      veil.g,
      textureSampleLevel(blurred, samp, clamp(refrUv - normal * fringe, vec2f(0.), vec2f(1.)), 0.).b
    );
    let body = mix(veil, prism, edge * 0.45);
    let lightOutline = mix(0.0, 0.18, p.tint.w) * exp(-abs(bestD) * 1.15);
    let allRim = exp(-abs(bestD) * 0.72);
    let outCol = min(
      body * (1.0 - lightOutline)
      + vec3f(1.0) * (topEdge * 0.95 + ptrSpec * 0.50 + botEdge * 0.30)
      + mix(vec3f(0.92, 0.96, 1.0), vec3f(0.78, 0.88, 1.0), p.tint.w) * allRim * 0.45,
      vec3f(1.)
    );
    let alpha = clamp(mix(0.88, 0.98, rim) * inside, 0., 1.);
    return vec4f(outCol * alpha, alpha);
  }

  let aa = 1.0;
  let inside = 1. - smoothstep(-aa, aa, bestD);
  if (inside <= 0.001) { return vec4f(0., 0., 0., 0.); }
  let isPlayer = s.info.w > 0.5 && s.info.y < 4.5;
  let rimPolish = select(1.0, 0.72, s.info.y < 0.5);
  let interact = clamp(select(s.info.w, s.info.w - 1.0, isPlayer), 0., 0.5);
  let distIn = max(0., -bestD);
  let rim = exp(-abs(bestD) * 0.85);
  let edge = exp(-distIn * 0.11);
  let lip = exp(-distIn * 0.22);
  let dx = surface_sdf(px + vec2f(1., 0.), s) - bestD;
  let dy = surface_sdf(px + vec2f(0., 1.), s) - bestD;
  let normal = normalize(vec2f(dx, dy) + vec2f(0.0001));
  var lensShift = vec2f(0.);
  var dropGlow = 0.0;
  if (isPlayer) {
    if (p.lens.z > 0.001) {
      let lq = (uv - p.lens.xy) * vec2f(aspect, 1.);
      lensShift = lq * exp(-length(lq) * 18.) * p.lens.z * -0.58;
    }
    let dpq = (px - p.play.xy * p.size) / max(p.play.z * p.size.y, 1.0);
    dropGlow = exp(-dot(dpq, dpq) * 0.9) * (0.55 + 0.45 * p.lens.w);
  }
  let bev = edge * (0.85 + 0.55 * p.look.w) + pow(edge, 2.0) * p.look.w * 0.65;
  let shift = normal * bev * (p.optics.x * (0.92 + interact * 0.6)) + lensShift;
  let refracted = clamp(uv - shift / vec2f(aspect, 1.), vec2f(0.), vec2f(1.));
  let fringe = pow(edge, 2.2) * inside * p.optics.z * (1.8 + p.look.w * 0.9);
  let sharp = background(refracted);
  let frost = textureSampleLevel(blurred, samp, refracted, 0.).rgb;
  let glass = mix(sharp, frost, p.look.x);
  let chroma = vec3f(
    textureSampleLevel(blurred, samp, clamp(refracted + normal * fringe, vec2f(0.), vec2f(1.)), 0.).r,
    glass.g,
    textureSampleLevel(blurred, samp, clamp(refracted - normal * fringe, vec2f(0.), vec2f(1.)), 0.).b
  );
  let lightDir = normalize((p.pointer - uv) * vec2f(aspect, 1.) + vec2f(0.001));
  let shine = pow(max(dot(normal, lightDir), 0.), 3.0) * rim;
  let topCatch = pow(max(-normal.y, 0.), 1.5) * rim;
  let bounce = pow(max(dot(normal, -lightDir), 0.), 2.2) * rim;
  let tintColor = mix(vec3f(0.025, 0.032, 0.048), vec3f(0.94, 0.96, 0.99), p.tint.w);
  let toned = mix(chroma, tintColor, p.optics.w);
  // Bounded for WCAG AA >= 4.5:1 even when 20% of pure white/black scrolling content shows through.
  let darkBody = vec3f(0.17) * (vec3f(1.) - exp(-toned * 1.4 / 0.17));
  let lightBody = vec3f(1.) - vec3f(0.18) * (vec3f(1.) - exp(-(vec3f(1.) - toned) * 1.4 / 0.18));
  let accessible = mix(darkBody, lightBody, p.tint.w);
  // Outer bevel lip + Play droplet preserve real uncrushed optical refraction outside the text zone.
  let lipWeight = clamp(lip * 0.62 * rimPolish + dropGlow * 0.42 + interact * 0.28 * edge, 0., 0.85);
  let bevelColor = mix(chroma * mix(1.12, 1.0, p.tint.w) + p.tint.rgb * (0.14 * (1. - p.tint.w)), accessible, 0.35);
  let glassSurface = mix(accessible, bevelColor, lipWeight);
  let lightRimShadow = p.tint.w * exp(-abs(bestD) * 1.5) * 0.14;
  let spec = (rim * p.optics.y * (0.58 + 0.5 * interact) + shine * p.optics.y * 1.65 + topCatch * p.optics.y * 0.72 + bounce * p.optics.y * 0.28) * (1. + p.look.w * 0.55) * rimPolish;
  let specTint = mix(vec3f(0.96, 0.98, 1.0), vec3f(1.0), p.tint.w);
  let lit = min(glassSurface * (1.0 - lightRimShadow) + spec * specTint * inside, vec3f(1.));
  let isField = s.info.y > 1.5 && s.info.y < 2.5;
  let isSegThumb = s.info.y > 3.5 && s.info.y < 4.5;
  let baseAlpha = select(select(0.80, 0.82, isField), 0.86, isSegThumb);
  let a = clamp(mix(baseAlpha, 0.96, rim) * inside, 0., 1.);
  return vec4f(lit * a, a);
}
