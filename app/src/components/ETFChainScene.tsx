"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

const TICKERS = ["TSLA", "AMZN", "AMD"] as const;
const STATE_WEIGHTS = [
  [44, 34, 22],
  [40, 35, 25],
  [36, 39, 25],
  [42, 33, 25],
  [38, 37, 25],
] as const;

function smoothRange(value: number, start: number, end: number) {
  const normalized = Math.min(Math.max((value - start) / (end - start), 0), 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function allocationWidth(weight: number) {
  return weight * 0.075;
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
    scene.fog = new THREE.Fog(0x090e14, 17, 30);

    const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 60);
    camera.position.set(0, 3.2, 18);

    const ambient = new THREE.HemisphereLight(0xd9f7f2, 0x0b1017, 1.65);
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(7, 10, 9);
    const tealRim = new THREE.PointLight(0x37b7aa, 26, 22, 2);
    tealRim.position.set(-2, 3, 7);
    const goldRim = new THREE.PointLight(0xe6b64a, 18, 18, 2);
    goldRim.position.set(8, 0, 7);
    scene.add(ambient, key, tealRim, goldRim);

    const sceneRoot = new THREE.Group();
    sceneRoot.rotation.y = -0.08;
    scene.add(sceneRoot);

    const stockMaterials = [
      new THREE.MeshStandardMaterial({
        color: 0x37b7aa,
        emissive: 0x0a302d,
        emissiveIntensity: 0.58,
        metalness: 0.72,
        roughness: 0.24,
        transparent: true,
      }),
      new THREE.MeshStandardMaterial({
        color: 0x55a9d2,
        emissive: 0x0b2635,
        emissiveIntensity: 0.48,
        metalness: 0.72,
        roughness: 0.24,
        transparent: true,
      }),
      new THREE.MeshStandardMaterial({
        color: 0xe6b64a,
        emissive: 0x352407,
        emissiveIntensity: 0.46,
        metalness: 0.74,
        roughness: 0.24,
        transparent: true,
      }),
    ];

    const textures = new Set<THREE.Texture>();

    function createLabel(text: string, color = "#dce7ed", width = 1.25) {
      const labelCanvas = document.createElement("canvas");
      labelCanvas.width = 512;
      labelCanvas.height = 128;
      const context = labelCanvas.getContext("2d");
      if (context) {
        context.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
        context.fillStyle = "rgba(9, 14, 20, 0.82)";
        context.fillRect(0, 15, labelCanvas.width, 98);
        context.strokeStyle = "rgba(128, 151, 166, 0.55)";
        context.lineWidth = 3;
        context.strokeRect(2, 17, labelCanvas.width - 4, 94);
        context.fillStyle = color;
        context.font = "600 52px ui-monospace, SFMono-Regular, Consolas, monospace";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(text, labelCanvas.width / 2, labelCanvas.height / 2 + 1);
      }

      const texture = new THREE.CanvasTexture(labelCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      textures.add(texture);

      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(width, width * 0.28, 1);
      return sprite;
    }

    const chainRoot = new THREE.Group();
    chainRoot.position.y = -0.8;
    sceneRoot.add(chainRoot);

    const plateSpacing = 5.35;
    const plateGeometry = new THREE.BoxGeometry(4.2, 0.16, 2.8);
    const stockGeometry = new THREE.BoxGeometry(1, 0.7, 0.64);
    const rowY = [2.05, 1.25, 0.45];

    const plateMaterials: THREE.MeshPhysicalMaterial[] = [];
    const plateEdgeMaterials: THREE.LineBasicMaterial[] = [];
    const blockLabelMaterials: THREE.SpriteMaterial[] = [];
    const snapshotMaterials: THREE.MeshStandardMaterial[][] = [];
    const snapshotEdgeMaterials: THREE.LineBasicMaterial[][] = [];
    const snapshotLabelMaterials: THREE.SpriteMaterial[][] = [];

    STATE_WEIGHTS.forEach((weights, stateIndex) => {
      const plateGroup = new THREE.Group();
      plateGroup.position.x = stateIndex * plateSpacing;

      const plateMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x17242d,
        metalness: 0.68,
        roughness: 0.26,
        transmission: 0.08,
        transparent: true,
        opacity: 0.58,
      });
      const edgeMaterial = new THREE.LineBasicMaterial({
        color: stateIndex === STATE_WEIGHTS.length - 1 ? 0xe6b64a : 0x5fcfc3,
        transparent: true,
        opacity: 0.34,
      });
      plateMaterials.push(plateMaterial);
      plateEdgeMaterials.push(edgeMaterial);

      const plate = new THREE.Mesh(plateGeometry, plateMaterial);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(plateGeometry),
        edgeMaterial,
      );
      plateGroup.add(plate, edges);

      const blockLabel = createLabel(
        `BLOCK ${18_420 + stateIndex}`,
        stateIndex === STATE_WEIGHTS.length - 1 ? "#f0c05a" : "#7ce1d5",
        1.68,
      );
      blockLabel.position.set(1.15, 0.38, 1.15);
      blockLabelMaterials.push(blockLabel.material);
      plateGroup.add(blockLabel);

      const stateMaterials: THREE.MeshStandardMaterial[] = [];
      const stateEdgeMaterials: THREE.LineBasicMaterial[] = [];
      const stateLabelMaterials: THREE.SpriteMaterial[] = [];
      weights.forEach((weight, assetIndex) => {
        const width = allocationWidth(weight);
        const material = stockMaterials[assetIndex].clone();
        material.opacity = 0.9;
        stateMaterials.push(material);

        const stock = new THREE.Mesh(stockGeometry, material);
        stock.scale.x = width;
        stock.position.set(-1.75 + width / 2, rowY[assetIndex], 0);
        const stockEdgeMaterial = new THREE.LineBasicMaterial({
          color: 0xe5eef2,
          transparent: true,
          opacity: 0.28,
        });
        stateEdgeMaterials.push(stockEdgeMaterial);
        const stockEdges = new THREE.LineSegments(
          new THREE.EdgesGeometry(stockGeometry),
          stockEdgeMaterial,
        );
        stock.add(stockEdges);
        plateGroup.add(stock);

        const label = createLabel(
          `${TICKERS[assetIndex]}  ${weight}%`,
          assetIndex === 2 ? "#f3cb72" : "#dce7ed",
          1.64,
        );
        label.position.set(-0.94, rowY[assetIndex], 0.5);
        stateLabelMaterials.push(label.material);
        plateGroup.add(label);
      });
      snapshotMaterials.push(stateMaterials);
      snapshotEdgeMaterials.push(stateEdgeMaterials);
      snapshotLabelMaterials.push(stateLabelMaterials);
      chainRoot.add(plateGroup);
    });

    const transferGroups = TICKERS.map((ticker, assetIndex) => {
      const group = new THREE.Group();
      const material = stockMaterials[assetIndex].clone();
      material.opacity = 0;
      const stock = new THREE.Mesh(stockGeometry, material);
      const edgeMaterial = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
      });
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(stockGeometry),
        edgeMaterial,
      );
      stock.add(edges);
      group.add(stock);

      const label = createLabel(
        ticker,
        assetIndex === 2 ? "#f3cb72" : "#eef5f7",
        1.24,
      );
      label.position.z = 0.5;
      label.material.opacity = 0;
      group.add(label);
      chainRoot.add(group);
      return {
        group,
        material,
        edgeMaterial,
        labelMaterial: label.material,
        assetIndex,
      };
    });

    const activeOutlineMaterial = new THREE.LineBasicMaterial({
      color: 0x7ce1d5,
      transparent: true,
      opacity: 0.72,
    });
    const activeOutline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(4.34, 0.05, 2.94)),
      activeOutlineMaterial,
    );
    activeOutline.position.y = -0.13;
    sceneRoot.add(activeOutline);

    let targetScroll = 0;
    let easedScroll = 0;
    let animationFrame = 0;
    let running = true;
    let viewportWidth = window.innerWidth;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function resize() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      viewportWidth = width;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.z = width < 700 ? 18.5 : width < 1_000 ? 19 : 19.5;
      camera.updateProjectionMatrix();

      if (width < 700) {
        sceneRoot.scale.setScalar(0.72);
        sceneRoot.position.set(0, 1.55, 0);
      } else if (width < 1_000) {
        sceneRoot.scale.setScalar(1);
        sceneRoot.position.set(0.8, 0.5, 0);
      } else {
        sceneRoot.scale.setScalar(1.2);
        sceneRoot.position.set(0, 0, 0);
      }
    }

    function updateScroll() {
      const scrollable = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
      targetScroll = Math.min(window.scrollY / scrollable, 1);
    }

    function render(time: number) {
      if (!running) return;

      easedScroll += (targetScroll - easedScroll) * (reduceMotion ? 1 : 0.1);

      const stateProgress =
        smoothRange(easedScroll, 0.08, 0.9) * (STATE_WEIGHTS.length - 1);
      const stateIndex = Math.min(
        Math.floor(stateProgress),
        STATE_WEIGHTS.length - 2,
      );
      const stateFraction = stateProgress - stateIndex;
      const mobileTransition = smoothRange(easedScroll, 0.025, 0.13);
      const desktopAnchor = viewportWidth < 1_000 ? 2.2 : 3.65;
      const anchor =
        viewportWidth < 700
          ? THREE.MathUtils.lerp(3.6, 1.2, mobileTransition)
          : desktopAnchor;

      if (viewportWidth < 700) {
        const finalVisibility = 1 - smoothRange(easedScroll, 0.76, 0.86);
        sceneRoot.scale.setScalar(
          THREE.MathUtils.lerp(0.6, 0.72, mobileTransition) * finalVisibility,
        );
        sceneRoot.position.y = THREE.MathUtils.lerp(2.2, 1.55, mobileTransition);
      }

      chainRoot.position.x = anchor - stateProgress * plateSpacing;
      activeOutline.position.x = anchor;
      activeOutline.position.y = chainRoot.position.y - 0.13;

      const transferAmount = Math.sin(stateFraction * Math.PI);
      const transferVisibility =
        smoothRange(stateFraction, 0.12, 0.32) *
        (1 - smoothRange(stateFraction, 0.68, 0.88));
      const staticLabelVisibility = 1 - transferVisibility;
      const currentVisibility = 1 - smoothRange(stateFraction, 0.08, 0.62);
      const nextVisibility = smoothRange(stateFraction, 0.38, 0.92);
      plateMaterials.forEach((material, index) => {
        const visibility =
          index === stateIndex
            ? currentVisibility
            : index === stateIndex + 1
              ? nextVisibility
              : 0;
        material.opacity = visibility * 0.68;
        plateEdgeMaterials[index].opacity = visibility * 0.8;
        blockLabelMaterials[index].opacity = visibility * (1 - transferAmount * 0.82);
        snapshotMaterials[index].forEach((snapshotMaterial) => {
          snapshotMaterial.opacity =
            visibility * (0.92 - transferAmount * 0.78);
        });
        snapshotEdgeMaterials[index].forEach((edgeMaterial) => {
          edgeMaterial.opacity =
            visibility * (0.3 - transferAmount * 0.25);
        });
        snapshotLabelMaterials[index].forEach((labelMaterial) => {
          labelMaterial.opacity =
            visibility * staticLabelVisibility * 0.98;
        });
      });

      const moveProgress = smoothRange(stateFraction, 0.1, 0.9);
      transferGroups.forEach(
        ({ group, material, edgeMaterial, labelMaterial, assetIndex }) => {
          const currentWeight = STATE_WEIGHTS[stateIndex][assetIndex];
          const nextWeight = STATE_WEIGHTS[stateIndex + 1][assetIndex];
          const currentWidth = allocationWidth(currentWeight);
          const nextWidth = allocationWidth(nextWeight);
          const fromX =
            stateIndex * plateSpacing - 1.75 + currentWidth / 2;
          const toX =
            (stateIndex + 1) * plateSpacing - 1.75 + nextWidth / 2;
          const stagger = Math.min(
            Math.max(moveProgress * 1.18 - assetIndex * 0.06, 0),
            1,
          );
          const width = THREE.MathUtils.lerp(currentWidth, nextWidth, stagger);

          group.position.set(
            THREE.MathUtils.lerp(fromX, toX, stagger),
            rowY[assetIndex] +
              Math.sin(stagger * Math.PI) * (1.1 + assetIndex * 0.1),
            0,
          );
          group.scale.x = width;
          group.rotation.z = Math.sin(stagger * Math.PI) * -0.06;
          material.opacity = transferVisibility * 0.96;
          edgeMaterial.opacity = transferVisibility * 0.52;
          labelMaterial.opacity = transferVisibility;
          labelMaterial.rotation = 0;
          group.children[1].scale.x = 1.24 / Math.max(width, 0.1);
        },
      );

      activeOutlineMaterial.opacity = 0.48 + Math.sin(time * 0.002) * 0.12;
      activeOutlineMaterial.color.setHex(
        stateProgress > STATE_WEIGHTS.length - 1.35 ? 0xe6b64a : 0x7ce1d5,
      );
      chainRoot.rotation.z =
        Math.sin(easedScroll * Math.PI) * -0.014 +
        Math.sin(time * 0.0003) * (reduceMotion ? 0 : 0.006);
      sceneRoot.rotation.y =
        -0.08 + Math.sin(easedScroll * Math.PI * 1.4) * 0.055;
      sceneRoot.position.x =
        viewportWidth < 700 ? 0 : Math.sin(easedScroll * Math.PI) * 0.16;

      camera.lookAt(0.9, 0.2, 0);
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
          const objectMaterials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          objectMaterials.forEach((material) => materials.add(material));
        } else if (object instanceof THREE.Sprite) {
          materials.add(object.material);
        }
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
      renderer.dispose();
    };
  }, []);

  if (webglFailed) {
    return (
      <div className="landingSceneFallback" aria-hidden="true">
        <span className="fallbackFrame" />
        <span className="fallbackAsset teal">TSLA</span>
        <span className="fallbackAsset blue">AMZN</span>
        <span className="fallbackAsset gold">AMD</span>
      </div>
    );
  }

  return <canvas className="landingCanvas" ref={canvasRef} aria-hidden="true" />;
}
