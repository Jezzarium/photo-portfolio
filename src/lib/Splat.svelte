<script lang="ts">
    import { onMount } from "svelte";
    import * as THREE from "three";
    import { SplatMesh, dyno } from "@sparkjsdev/spark";
    import { setupSplatModifier } from "./splatModifier";
    const splatURL =
        "https://pub-be878abefabe4fbfbadb730928721595.r2.dev/P1037130.ply";

    const effectCenter = { x: 0, y: 0, z: 20 };
    const effectMaxRadius = 400;

    let container: HTMLDivElement;
    let isLoading = true;

    onMount(() => {
        const scene = new THREE.Scene();
        const fov = 35;
        const camera = new THREE.PerspectiveCamera(
            fov,
            window.innerWidth / window.innerHeight,
            0.1,
            1000,
        );

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);

        container.appendChild(renderer.domElement);

        const initX = -0.5;
        const initY = 1;

        const animateT = dyno.dynoFloat(0);
        let baseTime = 0;
        let splatLoaded = false;

        const splat = new SplatMesh({
            url: splatURL,
            onLoad: () => {
                isLoading = false;
                splatLoaded = true;
                baseTime = 0;
            },
        });
        splat.quaternion.set(1, 0, 0, 0);
        splat.position.set(initX, initY, 4);
        scene.add(splat);

        setupSplatModifier(splat, animateT, {
            center: effectCenter,
            maxRadius: effectMaxRadius,
            noiseIntensity: 0.1,
            noiseScale: 2,
            revealSpeed: 3,
            revealDelay: 2.0,
            fadeInDuration: 2,
            borderWidth: 0.5,
        });

        let mouseX = 0;
        let mouseY = 0;
        let targetX = 0;
        let targetY = 0;
        const moveMultiplier = 2;

        const onMouseMove = (event: MouseEvent) => {
            targetX = (event.clientX / window.innerWidth) * moveMultiplier;
            targetY = -(event.clientY / window.innerHeight) * moveMultiplier;
        };

        const onDeviceOrientation = (event: DeviceOrientationEvent) => {
            if (event.gamma !== null && event.beta !== null) {
                targetX = Math.max(-1, Math.min(1, event.gamma / 30));
                targetY = Math.max(-1, Math.min(1, event.beta / 30));
            }
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("deviceorientation", onDeviceOrientation);

        const targetFPS = 60;
        const interval = 1000 / targetFPS;
        let lastTime = 0;

        renderer.setAnimationLoop((time) => {
            const delta = time - lastTime;

            if (delta > interval) {
                lastTime = time - (delta % interval);

                if (splatLoaded) {
                    baseTime += 1 / 30;
                    animateT.value = baseTime;
                    splat.updateVersion();
                }

                const smoothing = 0.05;
                mouseX += (targetX - mouseX) * smoothing;
                mouseY += (targetY - mouseY) * smoothing;

                splat.position.x = initX + mouseX * 0.2;
                splat.position.y = initY + mouseY * 0.2;
                renderer.render(scene, camera);
            }
        });

        const onResize = () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener("resize", onResize);

        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("resize", onResize);
            renderer.setAnimationLoop(null);
            renderer.dispose();
            if (container && container.contains(renderer.domElement)) {
                container.removeChild(renderer.domElement);
            }
        };
    });
</script>

{#if isLoading}
    <div class="loading">Loading...</div>
{/if}
<div bind:this={container} style:opacity={isLoading ? 0 : 1}></div>

<style>
    :global(body) {
        margin: 0;
        overflow: hidden;
    }
    .loading {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        color: white;
        font-family: sans-serif;
        font-size: 1.5rem;
    }
</style>
