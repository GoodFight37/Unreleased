@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var imageSampler: sampler;
@group(0) @binding(2) var<uniform> params: vec4f;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array<vec2f,3>(vec2f(-1.,-1.),vec2f(3.,-1.),vec2f(-1.,3.)); return vec4f(p[i],0.,1.);
}
fn blur(pos: vec2f, direction: vec2f) -> vec4f {
  let size = vec2f(textureDimensions(image));
  let uv = pos / size;
  let stepUv = direction * (params.x * 0.55) / size;
  var acc = textureSampleLevel(image, imageSampler, uv, 0.) * 0.227027;
  acc += (textureSampleLevel(image, imageSampler, uv + stepUv * 1., 0.) + textureSampleLevel(image, imageSampler, uv - stepUv * 1., 0.)) * 0.194595;
  acc += (textureSampleLevel(image, imageSampler, uv + stepUv * 2., 0.) + textureSampleLevel(image, imageSampler, uv - stepUv * 2., 0.)) * 0.121622;
  acc += (textureSampleLevel(image, imageSampler, uv + stepUv * 3., 0.) + textureSampleLevel(image, imageSampler, uv - stepUv * 3., 0.)) * 0.054054;
  acc += (textureSampleLevel(image, imageSampler, uv + stepUv * 4., 0.) + textureSampleLevel(image, imageSampler, uv - stepUv * 4., 0.)) * 0.016216;
  return acc;
}
@fragment fn horizontal(@builtin(position) p: vec4f) -> @location(0) vec4f { return blur(p.xy,vec2f(1.,0.)); }
@fragment fn vertical(@builtin(position) p: vec4f) -> @location(0) vec4f { return blur(p.xy,vec2f(0.,1.)); }
