export const SPLAT_GLOBALS = `
    vec3 hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(vec3(p.x * p.y * p.z, p.x + p.y * p.z, p.x * p.y + p.z));
    }

    vec3 noise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        
        vec3 n000 = hash(i + vec3(0,0,0));
        vec3 n100 = hash(i + vec3(1,0,0));
        vec3 n010 = hash(i + vec3(0,1,0));
        vec3 n110 = hash(i + vec3(1,1,0));
        vec3 n001 = hash(i + vec3(0,0,1));
        vec3 n101 = hash(i + vec3(1,0,1));
        vec3 n011 = hash(i + vec3(0,1,1));
        vec3 n111 = hash(i + vec3(1,1,1));
        
        vec3 x0 = mix(n000, n100, f.x);
        vec3 x1 = mix(n010, n110, f.x);
        vec3 x2 = mix(n001, n101, f.x);
        vec3 x3 = mix(n011, n111, f.x);
        
        vec3 y0 = mix(x0, x1, f.y);
        vec3 y1 = mix(x2, x3, f.y);
        
        return mix(y0, y1, f.z);
    }
`;

export function getSplatStatements(config: {
    revealSpeed: number;
    revealDelay: number;
    maxRadius: number;
    center: { x: number; y: number; z: number };
    borderWidth: number;
    noiseIntensity: number;
    noiseScale: number;
    fadeInDuration: number;
}, inputs: any, outputs: any) {
    return `
        ${outputs.gsplat} = ${inputs.gsplat};
        float t = ${inputs.t};
        float s = smoothstep(0., ${config.revealSpeed.toFixed(1)}, t - ${config.revealDelay.toFixed(1)}) * ${config.maxRadius.toFixed(1)};
        vec3 scales = ${inputs.gsplat}.scales;
        
        // Effect Center
        vec3 center = vec3(${config.center.x.toFixed(3)}, ${config.center.y.toFixed(3)}, ${config.center.z.toFixed(3)});
        
        // Calculate position relative to effect center
        vec3 p = ${inputs.gsplat}.center - center;
        float l = length(p.xz);
        
        // Magic Effect
        float border = abs(s - l - ${config.borderWidth.toFixed(2)});
        p *= 1. - .2 * exp(-20. * border);
        vec3 finalScales = mix(scales, vec3(0.002), smoothstep(s - ${config.borderWidth.toFixed(2)}, s, l + ${config.borderWidth.toFixed(2)}));
        
        // Apply effect modifications relative to center, then add center back
        ${outputs.gsplat}.center = p + center + ${config.noiseIntensity.toFixed(3)} * noise(p.xyz * ${config.noiseScale.toFixed(2)} + t * .5) * smoothstep(s - ${config.borderWidth.toFixed(2)}, s, l + ${config.borderWidth.toFixed(2)});
        ${outputs.gsplat}.scales = finalScales;
        
        // Fade in
        float fadeIn = smoothstep(0., ${config.fadeInDuration.toFixed(1)}, t);
        ${outputs.gsplat}.rgba *= fadeIn;
        ${outputs.gsplat}.rgba += exp(-20. * border);
    `;
}
