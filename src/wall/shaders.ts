/**
 * The two shaders the wall is drawn with. They share no state with the scene
 * class — every value they need arrives as a uniform.
 */
export const VERTEX = /* glsl */ `
  uniform float uHalf;
  uniform float uBend;
  uniform float uFalloff;
  uniform float uDepthNear;
  uniform float uDepthFar;
  uniform float uCamDist;
  uniform float uLift;

  uniform float uExpand;       // 0..1 eased expansion progress
  uniform float uExpandMove;   // the same, except it SNAPS under reduced motion
  uniform float uOthersScale;  // what the unselected tiles shrink to (1 = not at all)
  uniform float uSelected;     // 1 on the clicked tile, 0 on the rest
  uniform vec2  uExpandCentre; // world-space centre of the half it expands into
  uniform float uExpandScale;  // how much the clicked tile grows
  uniform float uPush;         // how far the others travel before leaving
  uniform vec2  uFocus;        // world-space centre the others flee from

  varying vec2 vUv;

  void main() {
    vUv = uv;

    // One clock for both halves of the gesture: the clicked tile grows while
    // the rest shrink and scatter, and both reach their end state together so
    // the motion reads as a single coordinated movement.
    //
    // Geometry runs on uExpandMove, not uExpand. Under prefers-reduced-motion
    // that value jumps straight to its target, so nothing scales or travels —
    // the tile is simply already large. uExpand still eases, and the fragment
    // stage fades on it, which turns the whole gesture into a cross-fade.
    //
    // uOthersScale is 1.0 in that mode too, so the wall does not shrink either:
    // it dissolves at full size instead of snapping to a grid of tiny tiles and
    // then fading, which leaves both views on screen at once.
    float grow = uSelected > 0.5
      ? mix(1.0, uExpandScale, uExpandMove)
      : mix(1.0, uOthersScale, uExpandMove);
    vec4 world = modelMatrix * vec4(position * grow, 1.0);
    vec3 centre = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;

    if (uSelected > 0.5) {
      // Glide to the middle of whichever half it was nearest.
      world.xy += (uExpandCentre - centre.xy) * uExpandMove;
    } else {
      // Everything else is pushed radially away from the clicked tile — in
      // every direction, not just sideways — so the wall opens outward from
      // that point. Tiles nearest the focus get a stronger shove, which reads
      // as a shockwave rather than a uniform slide.
      vec2 away = centre.xy - uFocus;
      float dist = max(length(away), 1.0);
      vec2 dir = away / dist;
      float boost = 1.0 + 1.1 * exp(-dist / (uHalf * 0.55));
      world.xy += dir * uPush * boost * uExpandMove;
    }

    // The selected tile flattens as it expands; the rest keep warping.
    float bend = uBend * (1.0 - uSelected * uExpandMove);

    float nx = clamp(world.x / uHalf, -1.0, 1.0);
    float odd = sign(nx) * pow(abs(nx), uFalloff);
    float dz = odd * (odd > 0.0 ? uDepthNear : uDepthFar) * bend;

    float nxC = clamp(centre.x / uHalf, -1.0, 1.0);
    float oddC = sign(nxC) * pow(abs(nxC), uFalloff);
    float dzC = oddC * (oddC > 0.0 ? uDepthNear : uDepthFar) * bend;
    float perspC = uCamDist / max(1.0, uCamDist - dzC);

    world.z += dz;
    world.y += oddC * uLift * bend / perspC;
    world.x += centre.x * (1.0 - perspC) / perspC;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

export const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uDim;      // 0 = full colour, 1 = fully dimmed
  uniform float uHasMap;
  uniform float uExpand;   // shared clock with the vertex stage
  uniform float uSelected;
  uniform float uReveal;
  varying vec2 vUv;

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    if (tex.a < 0.01 || uHasMap < 0.5) discard;
    float grey = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
    vec3 washed = mix(tex.rgb, vec3(grey), 0.94);
    vec3 rgb = mix(tex.rgb, washed, uDim);
    // Scattered tiles fade to nothing exactly as the selected one lands.
    float leaving = uExpand * (1.0 - uSelected);
    gl_FragColor =
      vec4(rgb, tex.a * mix(1.0, 0.32, uDim) * (1.0 - leaving) * uReveal);

    // The texture is tagged sRGB, so three decodes it to linear when sampling.
    // A raw ShaderMaterial gets no automatic re-encode on output, so without
    // this the midtones stay linear and read dark and over-saturated. This is
    // the chunk three injects into its own materials.
    #include <colorspace_fragment>
  }
`
