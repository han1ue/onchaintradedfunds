"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

function smoothRange(value: number, start: number, end: number) {
  const normalized = Math.min(Math.max((value - start) / (end - start), 0), 1);
  return normalized * normalized * (3 - 2 * normalized);
}

export function ETFChainScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [webglFailed, setWebglFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const contextAttributes: WebGLContextAttributes = {
      alpha: false,
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    };
    const webglContext =
      canvas.getContext("webgl2", contextAttributes) ||
      canvas.getContext("webgl", contextAttributes);
    if (!webglContext) {
      setWebglFailed(true);
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        context: webglContext,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
        preserveDrawingBuffer: true,
      });
    } catch {
      setWebglFailed(true);
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090e14);
    scene.fog = new THREE.Fog(0x090e14, 18, 34);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 70);
    camera.position.set(0, 1, 19);

    const ambient = new THREE.HemisphereLight(0xd9f7f2, 0x101721, 1.5);
    const key = new THREE.DirectionalLight(0xffffff, 3.6);
    key.position.set(6, 10, 12);
    const tealRim = new THREE.PointLight(0x37b7aa, 32, 25, 2);
    tealRim.position.set(-4, 2, 8);
    const goldRim = new THREE.PointLight(0xe6b64a, 20, 19, 2);
    goldRim.position.set(7, -2, 6);
    scene.add(ambient, key, tealRim, goldRim);

    const sceneRoot = new THREE.Group();
    scene.add(sceneRoot);

    const tealMaterial = new THREE.MeshStandardMaterial({
      color: 0x37b7aa,
      emissive: 0x0b302d,
      emissiveIntensity: 0.56,
      metalness: 0.76,
      roughness: 0.25,
    });
    const blueMaterial = new THREE.MeshStandardMaterial({
      color: 0x55a9d2,
      emissive: 0x0b2432,
      emissiveIntensity: 0.44,
      metalness: 0.75,
      roughness: 0.26,
    });
    const goldMaterial = new THREE.MeshStandardMaterial({
      color: 0xe6b64a,
      emissive: 0x352407,
      emissiveIntensity: 0.42,
      metalness: 0.77,
      roughness: 0.25,
    });

    const cage = new THREE.Group();
    cage.position.set(3.35, 1.15, 0);
    cage.rotation.set(0.05, -0.23, 0);
    sceneRoot.add(cage);

    const cageGeometry = new THREE.BoxGeometry(5.6, 4.35, 2.8);
    const cageSurfaceMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x8199a5,
      metalness: 0.38,
      roughness: 0.18,
      transmission: 0.22,
      transparent: true,
      opacity: 0.055,
      depthWrite: false,
    });
    const cageSurface = new THREE.Mesh(cageGeometry, cageSurfaceMaterial);
    const cageLineMaterial = new THREE.LineBasicMaterial({
      color: 0x75d8ce,
      transparent: true,
      opacity: 0.82,
    });
    const cageEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(cageGeometry),
      cageLineMaterial,
    );
    cage.add(cageSurface, cageEdges);

    const barMaterial = new THREE.MeshStandardMaterial({
      color: 0x53636f,
      emissive: 0x10272a,
      emissiveIntensity: 0.35,
      metalness: 0.88,
      roughness: 0.22,
    });
    const verticalBarGeometry = new THREE.BoxGeometry(0.055, 4.25, 0.055);
    const horizontalBarGeometry = new THREE.BoxGeometry(5.45, 0.055, 0.055);
    [-1.87, -0.62, 0.62, 1.87].forEach((x) => {
      [-1.43, 1.43].forEach((z) => {
        const bar = new THREE.Mesh(verticalBarGeometry, barMaterial);
        bar.position.set(x, 0, z);
        cage.add(bar);
      });
    });
    [-1.43, 1.43].forEach((z) => {
      [-1.42, 0, 1.42].forEach((y) => {
        const bar = new THREE.Mesh(horizontalBarGeometry, barMaterial);
        bar.position.set(0, y, z);
        cage.add(bar);
      });
    });

    const assetGeometry = new THREE.BoxGeometry(1, 0.74, 1.22);
    const assetMaterials = [tealMaterial, blueMaterial, goldMaterial];
    const assetWidths = [3.25, 2.58, 1.92];
    const rebalancedWidths = [2.62, 3.02, 2.18];
    const assetLayers = assetMaterials.map((material, index) => {
      const asset = new THREE.Mesh(assetGeometry, material);
      asset.position.set(-0.25, [0.92, 0, -0.92][index], 0);
      asset.scale.x = assetWidths[index];
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(assetGeometry),
        new THREE.LineBasicMaterial({ color: 0xd6e4e8, transparent: true, opacity: 0.36 }),
      );
      asset.add(edges);
      cage.add(asset);
      return asset;
    });

    const shareRingMaterial = new THREE.MeshBasicMaterial({
      color: 0x9ec2c8,
      transparent: true,
      opacity: 0.42,
    });
    const shareRing = new THREE.Mesh(
      new THREE.TorusGeometry(2.23, 0.025, 8, 96),
      shareRingMaterial,
    );
    shareRing.position.z = 1.46;
    cage.add(shareRing);

    const shareMaterial = new THREE.MeshBasicMaterial({
      color: 0xd2dce2,
      transparent: true,
      opacity: 0.92,
    });
    const shareGeometry = new THREE.BoxGeometry(0.36, 0.16, 0.08);
    const cageShares: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[] = [];
    for (let index = 0; index < 20; index += 1) {
      const angle = (index / 20) * Math.PI * 2;
      const share = new THREE.Mesh(shareGeometry, shareMaterial.clone());
      share.position.set(Math.cos(angle) * 2.23, Math.sin(angle) * 2.23, 1.5);
      share.rotation.z = angle + Math.PI / 2;
      cageShares.push(share);
      cage.add(share);
    }

    const chainRoot = new THREE.Group();
    chainRoot.position.y = -6;
    chainRoot.rotation.y = -0.08;
    sceneRoot.add(chainRoot);

    const blockSpacing = 4.45;
    const blockGeometry = new THREE.BoxGeometry(3.35, 0.72, 2.55);
    const blockMaterials: THREE.MeshPhysicalMaterial[] = [];
    const blockEdgeMaterials: THREE.LineBasicMaterial[] = [];
    const blockTopMaterials: THREE.MeshBasicMaterial[] = [];
    const supplyCounts = [8, 12, 15, 13, 18];
    const snapshotMaterial = new THREE.MeshBasicMaterial({
      color: 0x5ccfc2,
      transparent: true,
      opacity: 0.45,
    });
    const snapshotGeometry = new THREE.BoxGeometry(0.3, 0.055, 0.28);

    supplyCounts.forEach((count, blockIndex) => {
      const blockMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x17232d,
        metalness: 0.6,
        roughness: 0.26,
        transmission: 0.12,
        transparent: true,
        opacity: 0.68,
      });
      const edgeMaterial = new THREE.LineBasicMaterial({
        color: 0x536675,
        transparent: true,
        opacity: 0.35,
      });
      const topMaterial = new THREE.MeshBasicMaterial({
        color: blockIndex === supplyCounts.length - 1 ? 0xe6b64a : 0x37b7aa,
        transparent: true,
        opacity: 0.09,
        depthWrite: false,
      });
      blockMaterials.push(blockMaterial);
      blockEdgeMaterials.push(edgeMaterial);
      blockTopMaterials.push(topMaterial);

      const blockGroup = new THREE.Group();
      blockGroup.position.x = blockIndex * blockSpacing;

      const block = new THREE.Mesh(blockGeometry, blockMaterial);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(blockGeometry),
        edgeMaterial,
      );
      const top = new THREE.Mesh(new THREE.PlaneGeometry(3.05, 2.25), topMaterial);
      top.rotation.x = -Math.PI / 2;
      top.position.y = 0.371;
      blockGroup.add(block, edges, top);

      for (let shareIndex = 0; shareIndex < count; shareIndex += 1) {
        const snapshot = new THREE.Mesh(snapshotGeometry, snapshotMaterial);
        snapshot.position.set(
          -1.15 + (shareIndex % 6) * 0.46,
          0.42,
          -0.72 + Math.floor(shareIndex / 6) * 0.54,
        );
        blockGroup.add(snapshot);
      }

      chainRoot.add(blockGroup);

      if (blockIndex < supplyCounts.length - 1) {
        const connector = new THREE.Mesh(
          new THREE.BoxGeometry(blockSpacing - 3.25, 0.18, 0.34),
          barMaterial,
        );
        connector.position.set(blockIndex * blockSpacing + blockSpacing / 2, 0, 0);
        chainRoot.add(connector);
      }
    });

    const transferMaterial = new THREE.MeshBasicMaterial({
      color: 0xf2f6f8,
      transparent: true,
      opacity: 0,
    });
    const transferShares: THREE.Mesh[] = [];
    for (let index = 0; index < 5; index += 1) {
      const transferShare = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.18, 0.1),
        transferMaterial,
      );
      transferShares.push(transferShare);
      chainRoot.add(transferShare);
    }

    const activeBlockBeamMaterial = new THREE.MeshBasicMaterial({
      color: 0x45c8bb,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const activeBlockBeam = new THREE.Mesh(
      new THREE.BoxGeometry(3.28, 0.04, 2.48),
      activeBlockBeamMaterial,
    );
    activeBlockBeam.position.set(3.35, 0.41, 0);
    sceneRoot.add(activeBlockBeam);

    let targetScroll = 0;
    let easedScroll = 0;
    let animationFrame = 0;
    let previousTime = performance.now();
    let running = true;
    let viewportWidth = window.innerWidth;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function resize() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      viewportWidth = width;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.z = width < 700 ? 19 : width < 1_000 ? 19.5 : 20;
      camera.updateProjectionMatrix();

      if (width < 700) {
        sceneRoot.scale.setScalar(0.62);
        sceneRoot.position.set(0, 1.45, 0);
        cage.position.x = 0;
        activeBlockBeam.position.x = 0;
      } else if (width < 1_000) {
        sceneRoot.scale.setScalar(0.82);
        sceneRoot.position.set(0.9, 0.55, 0);
        cage.position.x = 2.15;
        activeBlockBeam.position.x = 2.15;
      } else {
        sceneRoot.scale.setScalar(1);
        sceneRoot.position.set(0, 0, 0);
        cage.position.x = 3.35;
        activeBlockBeam.position.x = 3.35;
      }
    }

    function updateScroll() {
      const scrollable = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
      targetScroll = Math.min(window.scrollY / scrollable, 1);
    }

    function render(time: number) {
      if (!running) return;

      const delta = Math.min((time - previousTime) / 1_000, 0.05);
      previousTime = time;
      easedScroll += (targetScroll - easedScroll) * (reduceMotion ? 1 : 0.1);

      const chainReveal = smoothRange(easedScroll, 0.08, 0.24);
      const stateProgress = smoothRange(easedScroll, 0.22, 0.9) * (supplyCounts.length - 1);
      const stateIndex = Math.min(Math.floor(stateProgress), supplyCounts.length - 2);
      const stateFraction = stateProgress - stateIndex;
      const mobileSceneTransition = smoothRange(easedScroll, 0.025, 0.13);

      if (viewportWidth < 700) {
        sceneRoot.scale.setScalar(THREE.MathUtils.lerp(0.48, 0.62, mobileSceneTransition));
        sceneRoot.position.y = THREE.MathUtils.lerp(1.95, 1.45, mobileSceneTransition);
        cage.position.x = THREE.MathUtils.lerp(4.5, 0, mobileSceneTransition);
        cage.position.y = THREE.MathUtils.lerp(2.05, 1.15, mobileSceneTransition);
        activeBlockBeam.position.x = cage.position.x;
      }

      const activeAnchor = cage.position.x;

      chainRoot.position.y = THREE.MathUtils.lerp(-6, -3.12, chainReveal);
      chainRoot.position.x = activeAnchor - stateProgress * blockSpacing;
      chainRoot.rotation.z = Math.sin(easedScroll * Math.PI) * -0.018;
      activeBlockBeam.position.y = chainRoot.position.y + 0.41;
      activeBlockBeamMaterial.opacity = chainReveal * 0.22;

      const currentCount = THREE.MathUtils.lerp(
        supplyCounts[stateIndex],
        supplyCounts[stateIndex + 1],
        stateFraction,
      );
      cageShares.forEach((share, index) => {
        const visibility = Math.min(Math.max(currentCount - index, 0), 1);
        share.scale.setScalar(0.25 + visibility * 0.75);
        share.material.opacity = visibility * 0.92;
      });

      const moveProgress = smoothRange(stateFraction, 0.16, 0.84);
      const transferPulse = Math.sin(moveProgress * Math.PI);
      transferMaterial.opacity = transferPulse * chainReveal;
      transferShares.forEach((share, index) => {
        const staggered = Math.min(Math.max(moveProgress * 1.35 - index * 0.08, 0), 1);
        const fromX = stateIndex * blockSpacing;
        const toX = (stateIndex + 1) * blockSpacing;
        share.position.x = THREE.MathUtils.lerp(fromX, toX, staggered);
        share.position.y = 0.58 + Math.sin(staggered * Math.PI) * (1.8 + index * 0.08);
        share.position.z = -0.62 + index * 0.31;
        share.rotation.z = staggered * Math.PI;
      });

      blockEdgeMaterials.forEach((material, index) => {
        const distance = Math.abs(index - stateProgress);
        const highlight = Math.max(1 - distance, 0);
        material.opacity = 0.2 + highlight * 0.72;
        blockTopMaterials[index].opacity = 0.05 + highlight * 0.28;
        blockMaterials[index].opacity = 0.46 + highlight * 0.3;
      });

      const rebalanceProgress = smoothRange(easedScroll, 0.7, 0.86);
      assetLayers.forEach((asset, index) => {
        asset.scale.x = THREE.MathUtils.lerp(
          assetWidths[index],
          rebalancedWidths[index],
          rebalanceProgress,
        );
      });

      shareRing.rotation.z += delta * (reduceMotion ? 0 : 0.09);
      cage.rotation.y = -0.23 + Math.sin(easedScroll * Math.PI * 1.5) * 0.08;
      cage.rotation.x = 0.05 + Math.sin(time * 0.00024) * (reduceMotion ? 0 : 0.025);
      cageLineMaterial.opacity = 0.72 + chainReveal * 0.2;
      activeBlockBeamMaterial.color.setHex(
        stateIndex === supplyCounts.length - 2 && stateFraction > 0.72 ? 0xe6b64a : 0x45c8bb,
      );

      camera.lookAt(0.8, -0.25, 0);
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(render);
    }

    function handleVisibility() {
      if (document.hidden) {
        running = false;
        window.cancelAnimationFrame(animationFrame);
        return;
      }
      if (!running) {
        running = true;
        previousTime = performance.now();
        animationFrame = window.requestAnimationFrame(render);
      }
    }

    resize();
    updateScroll();
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", updateScroll, { passive: true });
    document.addEventListener("visibilitychange", handleVisibility);
    animationFrame = window.requestAnimationFrame(render);

    return () => {
      running = false;
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", updateScroll);
      document.removeEventListener("visibilitychange", handleVisibility);

      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          geometries.add(object.geometry);
          const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
          objectMaterials.forEach((material) => materials.add(material));
        }
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      renderer.dispose();
    };
  }, []);

  if (webglFailed) {
    return (
      <div className="landingSceneFallback" aria-hidden="true">
        <span className="fallbackFrame" />
        <span className="fallbackAsset teal" />
        <span className="fallbackAsset blue" />
        <span className="fallbackAsset gold" />
      </div>
    );
  }

  return <canvas className="landingCanvas" ref={canvasRef} aria-hidden="true" />;
}
