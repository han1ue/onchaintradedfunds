"use client";

import {
  ArrowRight,
  BookOpen,
  CheckCircle,
  ExternalLink,
  Layers,
  LockKeyhole,
  ShieldCheck,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { useEffect, useRef } from "react";
import * as THREE from "three";

type LandingPageProps = {
  onCreate: () => void;
  onEnter: () => void;
};

function RailScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090e14);
    scene.fog = new THREE.Fog(0x090e14, 18, 78);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 150);
    camera.position.set(6.8, 3.2, 17);

    const ambient = new THREE.HemisphereLight(0xc9f8ef, 0x101821, 1.35);
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(7, 10, 9);
    const rim = new THREE.PointLight(0x37b7aa, 28, 34, 2);
    rim.position.set(-5, 2, 5);
    scene.add(ambient, key, rim);

    const railMaterial = new THREE.MeshStandardMaterial({
      color: 0x35bcae,
      emissive: 0x0c302e,
      emissiveIntensity: 0.6,
      metalness: 0.82,
      roughness: 0.24,
    });
    const sleeperMaterial = new THREE.MeshStandardMaterial({
      color: 0x34404c,
      metalness: 0.72,
      roughness: 0.38,
    });
    const darkMetal = new THREE.MeshStandardMaterial({
      color: 0x17212b,
      metalness: 0.88,
      roughness: 0.24,
    });
    const lightMetal = new THREE.MeshStandardMaterial({
      color: 0xb8c6d4,
      metalness: 0.72,
      roughness: 0.25,
    });
    const goldMaterial = new THREE.MeshStandardMaterial({
      color: 0xe7b84d,
      emissive: 0x382507,
      emissiveIntensity: 0.35,
      metalness: 0.72,
      roughness: 0.3,
    });

    const railGeometry = new THREE.BoxGeometry(0.12, 0.09, 112);
    [-3, 0, 3].forEach((x) => {
      const rail = new THREE.Mesh(railGeometry, railMaterial);
      rail.position.set(x, -1.05, -38);
      scene.add(rail);
    });

    const sleeperGeometry = new THREE.BoxGeometry(6.4, 0.05, 0.13);
    const sleepers = new THREE.InstancedMesh(sleeperGeometry, sleeperMaterial, 37);
    const sleeperMatrix = new THREE.Matrix4();
    for (let index = 0; index < 37; index += 1) {
      sleeperMatrix.makeTranslation(0, -1.1, 15 - index * 3);
      sleepers.setMatrixAt(index, sleeperMatrix);
    }
    sleepers.instanceMatrix.needsUpdate = true;
    scene.add(sleepers);

    const core = new THREE.Group();
    core.position.set(0, 0.1, 4);
    const coreMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.55, 1), darkMetal);
    const coreWire = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.62, 1)),
      new THREE.LineBasicMaterial({ color: 0x55d5c8, transparent: true, opacity: 0.72 }),
    );
    const coreRing = new THREE.Mesh(new THREE.TorusGeometry(2.25, 0.045, 8, 96), railMaterial);
    const coreRingCross = new THREE.Mesh(new THREE.TorusGeometry(2.65, 0.028, 8, 96), lightMetal);
    coreRingCross.rotation.y = Math.PI / 2;
    core.add(coreMesh, coreWire, coreRing, coreRingCross);
    scene.add(core);

    const stations: THREE.Group[] = [];
    [-18, -42, -66].forEach((z, stationIndex) => {
      const station = new THREE.Group();
      station.position.z = z;

      const outerRing = new THREE.Mesh(
        new THREE.TorusGeometry(3.75, 0.065, 8, 96),
        stationIndex === 1 ? goldMaterial : railMaterial,
      );
      const innerRing = new THREE.Mesh(
        new THREE.TorusGeometry(2.95, 0.025, 8, 96),
        lightMetal,
      );
      innerRing.rotation.z = Math.PI / 3;
      station.add(outerRing, innerRing);

      for (let spoke = 0; spoke < 6; spoke += 1) {
        const spokeMesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 1.4, 0.08),
          stationIndex === 1 ? goldMaterial : sleeperMaterial,
        );
        spokeMesh.position.set(
          Math.cos((spoke / 6) * Math.PI * 2) * 3.35,
          Math.sin((spoke / 6) * Math.PI * 2) * 3.35,
          0,
        );
        spokeMesh.rotation.z = -(spoke / 6) * Math.PI * 2;
        station.add(spokeMesh);
      }

      stations.push(station);
      scene.add(station);
    });

    const packetGeometry = new THREE.BoxGeometry(0.52, 0.36, 0.9);
    const packetMaterials = [railMaterial, lightMetal, goldMaterial];
    const packets: THREE.Mesh[] = [];
    for (let index = 0; index < 15; index += 1) {
      const packet = new THREE.Mesh(packetGeometry, packetMaterials[index % packetMaterials.length]);
      packet.position.x = [-3, 0, 3][index % 3];
      packet.position.y = -0.72;
      packet.userData.offset = index * 7.2;
      packet.userData.speed = 2.5 + (index % 4) * 0.35;
      packets.push(packet);
      scene.add(packet);
    }

    let targetScroll = 0;
    let easedScroll = 0;
    let animationFrame = 0;
    let previousTime = performance.now();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function resize() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    function updateScroll() {
      const scrollable = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
      targetScroll = Math.min(window.scrollY / scrollable, 1);
    }

    function render(time: number) {
      const delta = Math.min((time - previousTime) / 1_000, 0.05);
      previousTime = time;
      easedScroll += (targetScroll - easedScroll) * (reduceMotion ? 1 : 0.055);

      const cameraZ = 17 - easedScroll * 88;
      camera.position.z = cameraZ;
      camera.position.x = 6.8 * (1 - easedScroll) + Math.sin(easedScroll * Math.PI * 3) * 1.25;
      camera.position.y = 3.2 - easedScroll * 1.4 + Math.sin(easedScroll * Math.PI * 2) * 0.5;
      camera.lookAt(0, -0.05, cameraZ - 11);

      core.rotation.x += delta * (reduceMotion ? 0 : 0.16);
      core.rotation.y += delta * (reduceMotion ? 0 : 0.26);
      coreRing.rotation.z -= delta * (reduceMotion ? 0 : 0.12);
      coreRingCross.rotation.x += delta * (reduceMotion ? 0 : 0.09);

      stations.forEach((station, index) => {
        station.rotation.z = time * 0.000035 * (index % 2 ? -1 : 1);
      });

      packets.forEach((packet) => {
        const travel = reduceMotion ? packet.userData.offset : time * 0.001 * packet.userData.speed + packet.userData.offset;
        packet.position.z = 16 - (travel % 104);
        packet.rotation.y += delta * 0.35;
      });

      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(render);
    }

    resize();
    updateScroll();
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", updateScroll, { passive: true });
    animationFrame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", updateScroll);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
    };
  }, []);

  return <canvas className="landingCanvas" ref={canvasRef} aria-hidden="true" />;
}

function LandingBrand() {
  return (
    <span className="landingBrand">
      <span><TrendingUp size={16} /></span>
      <span>
        <strong>Onchain Traded Funds</strong>
        <small>OTF protocol</small>
      </span>
    </span>
  );
}

export function LandingPage({ onCreate, onEnter }: LandingPageProps) {
  return (
    <div className="landingPage">
      <RailScene />

      <header className="landingNav">
        <LandingBrand />
        <nav aria-label="Landing navigation">
          <a href="#architecture">Architecture</a>
          <a href="#safety">Safety</a>
          <a href="https://github.com/han1ue/onchaintradedfunds#readme" target="_blank" rel="noreferrer">
            Docs
            <ExternalLink size={11} />
          </a>
        </nav>
        <button type="button" onClick={onEnter}>
          Enter app
          <ArrowRight size={14} />
        </button>
      </header>

      <main className="landingMain">
        <section className="landingHero">
          <div className="landingHeroCopy">
            <p className="landingKicker">Managed portfolios, enforced onchain</p>
            <h1>Onchain Traded Funds</h1>
            <p className="landingThesis">The fund is familiar.<br />The rails are new.</p>
            <p className="landingIntro">
              ERC-4626 portfolio vaults with manager execution constrained by immutable safety limits,
              fresh oracle prices, and atomic settlement.
            </p>
            <div className="landingActions">
              <button className="landingPrimary" type="button" onClick={onEnter}>
                Explore vaults
                <ArrowRight size={15} />
              </button>
              <button className="landingSecondary" type="button" onClick={onCreate}>
                Create a vault
              </button>
            </div>
            <div className="landingProof">
              <span><strong>7 days</strong><small>minimum cooldown</small></span>
              <span><strong>Atomic</strong><small>basket execution</small></span>
              <span><strong>Onchain</strong><small>rules and history</small></span>
            </div>
          </div>
          <a className="landingScrollCue" href="#architecture">
            <span />
            <span>
              <small>Next checkpoint</small>
              <strong>Portfolio architecture</strong>
            </span>
          </a>
        </section>

        <section className="landingStory landingStoryRight" id="architecture">
          <div className="landingStoryCopy">
            <span className="landingChapter">01 / Portfolio architecture</span>
            <Layers size={22} />
            <h2>One vault.<br />Many assets.</h2>
            <p>
              Each share represents a transparent basket of approved assets. Targets, balances, oracle
              prices, and drift stay inspectable from the same surface.
            </p>
            <div className="landingFactList">
              <span><CheckCircle size={13} /> ERC-4626 shares</span>
              <span><CheckCircle size={13} /> Approved asset registry</span>
              <span><CheckCircle size={13} /> Public target weights</span>
            </div>
          </div>
        </section>

        <section className="landingStory" id="safety">
          <div className="landingStoryCopy">
            <span className="landingChapter">02 / Manager boundaries</span>
            <ShieldCheck size={22} />
            <h2>Management,<br />without custody.</h2>
            <p>
              Managers can shape the portfolio, but they cannot withdraw its assets, call arbitrary
              contracts, or route trades through unapproved adapters.
            </p>
            <div className="landingFactList">
              <span><LockKeyhole size={13} /> No arbitrary manager calls</span>
              <span><CheckCircle size={13} /> Exact temporary approvals</span>
              <span><CheckCircle size={13} /> Approved adapters only</span>
            </div>
          </div>
        </section>

        <section className="landingStory landingStoryRight">
          <div className="landingStoryCopy">
            <span className="landingChapter">03 / Rebalance controls</span>
            <Zap size={22} />
            <h2>Rebalancing<br />with hard edges.</h2>
            <p>
              Turnover, NAV loss, allocation drift, oracle freshness, and asset weights are checked
              before a portfolio change can become final.
            </p>
            <div className="landingBigStat">
              <strong>7 days</strong>
              <span>Minimum delay between successful portfolio changes</span>
            </div>
          </div>
        </section>

        <section className="landingStory">
          <div className="landingStoryCopy">
            <span className="landingChapter">04 / Atomic settlement</span>
            <Wallet size={22} />
            <h2>Every leg,<br />or no trade.</h2>
            <p>
              The vault approves only the exact trade amounts, executes the whole basket atomically,
              clears temporary approvals, and then runs its final safety checks.
            </p>
            <div className="landingFactList">
              <span><CheckCircle size={13} /> Fresh onchain prices</span>
              <span><CheckCircle size={13} /> Final NAV validation</span>
              <span><CheckCircle size={13} /> Cooldown updates on success only</span>
            </div>
          </div>
        </section>

        <section className="landingFinal">
          <span className="landingChapter">A fund structure for open rails</span>
          <h2>Build the portfolio.<br />Let the contract hold the line.</h2>
          <p>Permissionless vaults for transparent, constrained portfolio management.</p>
          <div className="landingActions">
            <button className="landingPrimary" type="button" onClick={onEnter}>
              Enter the app
              <ArrowRight size={15} />
            </button>
            <a className="landingSecondary" href="https://github.com/han1ue/onchaintradedfunds#readme" target="_blank" rel="noreferrer">
              <BookOpen size={14} />
              Read the docs
            </a>
          </div>
          <footer>
            <LandingBrand />
            <span>Experimental, unaudited software · Robinhood Testnet</span>
          </footer>
        </section>
      </main>
    </div>
  );
}
