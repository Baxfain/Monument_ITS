export const VERTEX_SHADER = `#version 300 es
in vec3 a_position;
in vec3 a_normal;
in vec2 a_uv;
in float a_windWeight;
in float a_windPhase;

uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
uniform mat3 u_normalMatrix;
uniform float u_time;
uniform float u_windSpeed;
uniform float u_windAmplitude;
uniform vec2 u_windDirection;

out vec3 v_worldPosition;
out vec3 v_normal;
out vec2 v_uv;

void main() {
  vec4 worldPosition = u_model * vec4(a_position, 1.0);
  vec3 windAxis = normalize(vec3(u_windDirection.x, 0.0, u_windDirection.y));
  float phase = u_time * u_windSpeed + a_windPhase + dot(worldPosition.xz, vec2(0.19, 0.13));
  float wave = sin(phase);
  float weight = a_windWeight;
  worldPosition.xyz += windAxis * (wave * u_windAmplitude * weight);
  v_worldPosition = worldPosition.xyz;
  v_normal = normalize(u_normalMatrix * a_normal - windAxis * (cos(phase) * u_windAmplitude * u_windSpeed * weight * 0.08));
  v_uv = a_uv;
  gl_Position = u_projection * u_view * worldPosition;
}
`;

export const SKY_VERTEX_SHADER = `#version 300 es
out vec2 v_ndc;

void main() {
  const vec2 positions[3] = vec2[3](
    vec2(-1.0, -1.0),
    vec2(3.0, -1.0),
    vec2(-1.0, 3.0)
  );
  v_ndc = positions[gl_VertexID];
  gl_Position = vec4(v_ndc, 1.0, 1.0);
}
`;

export const SKY_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_ndc;

uniform vec3 u_cameraForward;
uniform vec3 u_cameraRight;
uniform vec3 u_cameraUp;
uniform vec3 u_sunDirection;
uniform vec3 u_skyTopColor;
uniform vec3 u_skyHorizonColor;
uniform vec3 u_sunColor;
uniform vec3 u_haloColor;
uniform vec2 u_viewSize;
uniform float u_tanHalfFov;
uniform float u_sunAngularRadius;
uniform float u_haloAngularRadius;
uniform float u_haloIntensity;
uniform float u_haloFalloff;

out vec4 outColor;

void main() {
  float aspect = u_viewSize.x / max(u_viewSize.y, 1.0);
  vec3 viewRay = normalize(
    u_cameraForward
    + u_cameraRight * (v_ndc.x * aspect * u_tanHalfFov)
    + u_cameraUp * (v_ndc.y * u_tanHalfFov)
  );
  float sunAlignment = dot(viewRay, normalize(u_sunDirection));

  float skyBlend = smoothstep(-0.12, 0.42, viewRay.y);
  vec3 skyColor = mix(u_skyHorizonColor, u_skyTopColor, skyBlend);

  float haloExtent = max(1.0 - cos(u_haloAngularRadius), 0.000001);
  float haloDistance = max(1.0 - sunAlignment, 0.0) / haloExtent;
  float haloEdge = 1.0 - smoothstep(0.78, 1.0, haloDistance);
  float halo = exp(-haloDistance * u_haloFalloff) * haloEdge * u_haloIntensity;
  skyColor = mix(skyColor, u_haloColor, clamp(halo, 0.0, 1.0));

  float sunCosine = cos(u_sunAngularRadius);
  float antialias = max(fwidth(sunAlignment), 0.000001);
  float sunDisk = smoothstep(sunCosine - antialias, sunCosine + antialias, sunAlignment);
  outColor = vec4(mix(skyColor, u_sunColor, sunDisk), 1.0);
}
`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 v_worldPosition;
in vec3 v_normal;
in vec2 v_uv;

uniform vec3 u_baseColor;
uniform vec3 u_lightDirection;
uniform vec3 u_lightColor;
uniform vec3 u_cameraPosition;
uniform float u_ambientStrength;
uniform float u_diffuseStrength;
uniform float u_shininess;
uniform float u_specularStrength;
uniform vec2 u_uvRepeat;
uniform int u_hasTexture;
uniform int u_doubleSided;
uniform int u_unlit;
uniform sampler2D u_diffuseTexture;

out vec4 outColor;

void main() {
  vec3 albedo = u_baseColor;
  if (u_hasTexture == 1) {
    albedo *= texture(u_diffuseTexture, v_uv * u_uvRepeat).rgb;
  }
  vec3 normal = normalize(v_normal);
  vec3 viewDirection = normalize(u_cameraPosition - v_worldPosition);
  if (u_unlit == 1) {
    vec3 emissiveColor = pow(max(albedo, vec3(0.0)), vec3(1.0 / 2.2));
    outColor = vec4(emissiveColor, 1.0);
    return;
  }

  if (u_doubleSided == 1 && !gl_FrontFacing) normal = -normal;
  vec3 lightDirection = normalize(u_lightDirection);
  vec3 halfDirection = normalize(lightDirection + viewDirection);

  float normalLight = dot(normal, lightDirection);
  float diffuse = max(normalLight, 0.0);
  float specular = normalLight > 0.0
    ? pow(max(dot(normal, halfDirection), 0.0), u_shininess)
    : 0.0;
  vec3 light = vec3(u_ambientStrength) + u_lightColor * diffuse * u_diffuseStrength;
  vec3 linearColor = albedo * light + u_lightColor * specular * u_specularStrength;
  vec3 displayColor = pow(max(linearColor, vec3(0.0)), vec3(1.0 / 2.2));
  outColor = vec4(displayColor, 1.0);
}
`;
