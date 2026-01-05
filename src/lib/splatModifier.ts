import { SplatMesh, dyno } from "@sparkjsdev/spark";
import { SPLAT_GLOBALS, getSplatStatements } from "./splatShader";

export interface SplatEffectConfig {
    center: { x: number; y: number; z: number };
    maxRadius: number;
    noiseIntensity: number;
    noiseScale: number;
    revealSpeed: number;
    revealDelay: number;
    fadeInDuration: number;
    borderWidth: number;
}

export function setupSplatModifier(
    splatMesh: SplatMesh,
    animateT: ReturnType<typeof dyno.dynoFloat>,
    config: SplatEffectConfig
) {

    splatMesh.objectModifier = dyno.dynoBlock(
        { gsplat: dyno.Gsplat },
        { gsplat: dyno.Gsplat },
        ({ gsplat }) => {
            const d = new dyno.Dyno({
                inTypes: {
                    gsplat: dyno.Gsplat,
                    t: "float",
                },
                outTypes: { gsplat: dyno.Gsplat },
                globals: () => [dyno.unindent(SPLAT_GLOBALS)],
                statements: ({ inputs, outputs }) =>
                    dyno.unindentLines(getSplatStatements(config, inputs, outputs)),
            });

            gsplat = d.apply({
                gsplat,
                t: animateT,
            }).gsplat;

            return { gsplat };
        },
    );

    splatMesh.updateGenerator();
}
