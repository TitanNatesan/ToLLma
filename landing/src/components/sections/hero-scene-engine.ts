// ============================================================
// Hero 3D scene engine (three.js). Loaded lazily by hero-scene.tsx
// only when the hero is near the viewport, motion is allowed and
// WebGL is available. Kept framework-free so the main bundle does
// not carry three.js.
// ============================================================

import * as THREE from "three";

export type HeroNodeMeta = {
  id: string;
  label: string;
  position: [number, number, number];
  color?: string;
};

export type HeroSceneOptions = {
  host: HTMLElement;
  labels: Record<string, HTMLElement | null>;
  clients: HeroNodeMeta[];
  providers: HeroNodeMeta[];
  /** White (dark-surface) variant of the ToLLma mark, transparent bg. */
  markWhiteUrl: string;
  /** Ink (light-surface) variant of the ToLLma mark, transparent bg. */
  markInkUrl: string;
  /** Software rasterizer: lean buffer + fps, identical composition. */
  software: boolean;
  onFail: () => void;
};

export type HeroSceneApi = {
  setHovered: (id: string | null) => void;
  dispose: () => void;
};

const BRAND = 0x2563eb;
const TEAL = 0x06b6d4;
const TEXTURE_SIZE = 512;

function makeRadialTexture(inner: string, outer: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(
      TEXTURE_SIZE / 2,
      TEXTURE_SIZE / 2,
      0,
      TEXTURE_SIZE / 2,
      TEXTURE_SIZE / 2,
      TEXTURE_SIZE / 2
    );
    g.addColorStop(0, inner);
    g.addColorStop(0.55, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeDotTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.28, "rgba(255,255,255,.95)");
    g.addColorStop(0.6, "rgba(255,255,255,.25)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Face plate: the real ToLLma mark (white ghost offset for depth +
// crisp ink on top) with a navy wordmark below. Images load async; the
// wordmark paints immediately so the face is never blank.
function createFacePlate(markWhiteUrl: string, markInkUrl: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const ink = new Image();
  const white = new Image();
  let loaded = 0;
  const draw = () => {
    if (!ctx) return;
    ctx.clearRect(0, 0, 1024, 512);
    // Extruded ghost: white mark offset down-right at low alpha.
    if (loaded > 0 || white.complete) {
      try {
        ctx.globalAlpha = 0.5;
        ctx.drawImage(white, 512 - 170 + 18, 14 + 22, 340, 340);
        ctx.globalAlpha = 1;
      } catch {
        /* image not ready yet */
      }
    }
    // Crisp ink mark on top.
    if (loaded > 0 || ink.complete) {
      try {
        ctx.drawImage(ink, 512 - 170, 14, 340, 340);
      } catch {
        /* image not ready yet */
      }
    }
    // Navy wordmark under the mark.
    ctx.textAlign = "center";
    ctx.fillStyle = "#0b1b34";
    ctx.font = "700 96px Inter, ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("ToLLma", 512, 458);
    tex.needsUpdate = true;
  };

  draw();
  const onLoad = () => {
    loaded += 1;
    draw();
  };
  ink.onload = onLoad;
  white.onload = onLoad;
  ink.src = markInkUrl;
  white.src = markWhiteUrl;

  return tex;
}

function makeEnvironmentTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#f8fbff");
    g.addColorStop(0.42, "#dbeafe");
    g.addColorStop(0.68, "#93c5fd");
    g.addColorStop(1, "#1e3a8a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 256);

    const sun = ctx.createRadialGradient(370, 58, 0, 370, 58, 150);
    sun.addColorStop(0, "rgba(255,255,255,1)");
    sun.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, 512, 256);

    const cyan = ctx.createRadialGradient(110, 190, 0, 110, 190, 170);
    cyan.addColorStop(0, "rgba(6,182,212,.72)");
    cyan.addColorStop(1, "rgba(6,182,212,0)");
    ctx.fillStyle = cyan;
    ctx.fillRect(0, 0, 512, 256);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeFloorTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, 512, 512);
    ctx.fillStyle = "rgba(147, 197, 253, 0.95)";
    for (let x = 16; x < 512; x += 32) {
      for (let y = 16; y < 512; y += 32) {
        ctx.beginPath();
        ctx.arc(x, y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const fade = ctx.createRadialGradient(256, 256, 30, 256, 256, 256);
    fade.addColorStop(0, "rgba(0,0,0,1)");
    fade.addColorStop(0.55, "rgba(0,0,0,0.7)");
    fade.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, 512, 512);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  const list = Array.isArray(material) ? material : [material];
  for (const m of list) {
    const map = (m as THREE.MeshStandardMaterial).map;
    if (map) map.dispose();
    m.dispose();
  }
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

export function initHeroScene({
  host,
  labels,
  clients,
  providers,
  markWhiteUrl,
  markInkUrl,
  software,
  onFail,
}: HeroSceneOptions): HeroSceneApi | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      // MSAA resolve is brutal in software rasterizers; the lean tier
      // renders unaliased at a smaller buffer instead.
      antialias: !software,
      alpha: true,
      powerPreference: "high-performance",
    });
  } catch {
    onFail();
    return null;
  }

  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);
  // Lean tier: half-res buffer. Labels stay crisp (they are HTML).
  renderer.setPixelRatio(software ? 0.5 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.setAttribute("role", "img");
  canvas.setAttribute(
    "aria-label",
    "Three-dimensional ToLLma gateway: app, agent and CLI requests flow into a glass gateway and out to OpenAI, Anthropic, Gemini, Vertex AI, AWS Bedrock and custom providers."
  );
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 100);
  camera.position.set(0, 0.55, 9.8);
  camera.lookAt(0.35, 0, 0);

  const root = new THREE.Group();
  scene.add(root);

  const clock = new THREE.Clock();
  const pointer = { x: 0, y: 0 };
  const pointerNdc = new THREE.Vector2(0, 0);
  const raycaster = new THREE.Raycaster();
  const tmpVec = new THREE.Vector3();
  const disposed = { value: false };
  let hovered: string | null = null;
  let labelHover: string | null = null;
  let visible = true;
  let raf = 0;

  // ----- environment + lights -----
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envSource = makeEnvironmentTexture();
  const envRT = pmrem.fromEquirectangular(envSource);
  scene.environment = envRT.texture;
  pmrem.dispose();

  scene.add(new THREE.AmbientLight(0xffffff, 1.05));
  const key = new THREE.DirectionalLight(0xffffff, 2.7);
  key.position.set(4, 6, 8);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x93c5fd, 1.35);
  fill.position.set(-6, 2, 4);
  scene.add(fill);
  const brandLight = new THREE.PointLight(BRAND, 28, 20);
  brandLight.position.set(-3, 2, 3);
  scene.add(brandLight);
  const tealLight = new THREE.PointLight(TEAL, 16, 16);
  tealLight.position.set(3, -2, 2);
  scene.add(tealLight);

  // ----- soft glows / floor -----
  const glowTex = makeRadialTexture("rgba(37,99,235,0.55)", "rgba(37,99,235,0)");
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  glow.scale.set(6.6, 6.2, 1);
  glow.position.set(0.45, 0.2, -1.6);
  root.add(glow);

  const floorGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  floorGlow.scale.set(6.4, 2.2, 1);
  floorGlow.position.set(0.4, -2.2, -1.2);
  root.add(floorGlow);

  const floorTex = makeFloorTexture();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 18),
    new THREE.MeshBasicMaterial({
      map: floorTex,
      transparent: true,
      opacity: 0.46,
      depthWrite: false,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0.4, -2.3, -1);
  root.add(floor);

  // ----- gateway -----
  const gateway = new THREE.Group();
  gateway.position.set(0.45, 0.08, 0);
  root.add(gateway);

  const hexGeo = new THREE.CylinderGeometry(1.55, 1.55, 1.3, 6, 1, false);
  // Stand the prism on its edge: the hexagonal cap faces the viewer, so
  // the silhouette reads as a hexagon rather than a side wall.
  hexGeo.rotateX(Math.PI / 2);
  hexGeo.rotateZ(Math.PI / 6);
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0x60a5fa),
    metalness: 0.08,
    roughness: 0.05,
    transmission: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.6,
    emissive: new THREE.Color(0x1d4ed8),
    emissiveIntensity: 0.22,
    transparent: true,
    opacity: 0.9,
    attenuationDistance: 1.5,
  });
  const glass = new THREE.Mesh(hexGeo, glassMat);
  gateway.add(glass);

  const rimMat = new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(0x2563eb) },
      uColorB: { value: new THREE.Color(0x22d3ee) },
    },
    vertexShader: `
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      void main() {
        float fresnel = pow(1.0 - abs(dot(vNormalView, vViewDir)), 2.2);
        vec3 color = mix(uColorA, uColorB, smoothstep(0.05, 0.95, fresnel));
        gl_FragColor = vec4(color, fresnel * 0.9);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
  const rim = new THREE.Mesh(hexGeo, rimMat);
  rim.scale.setScalar(1.035);
  gateway.add(rim);

  const faceGlowTex = makeRadialTexture("rgba(34, 211, 238, 0.55)", "rgba(37, 99, 235, 0)");
  const faceGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 2.2),
    new THREE.MeshBasicMaterial({
      map: faceGlowTex,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  faceGlow.position.set(0, 0, 0.64);
  gateway.add(faceGlow);

  const edgeGeo = new THREE.EdgesGeometry(hexGeo);
  const edgeMat = new THREE.LineBasicMaterial({
    color: 0xdbeafe,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  });
  gateway.add(new THREE.LineSegments(edgeGeo, edgeMat));

  const faceTex = createFacePlate(markWhiteUrl, markInkUrl);
  const faceMat = new THREE.MeshBasicMaterial({
    map: faceTex,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const faceGeo = new THREE.PlaneGeometry(2.0, 1.0);
  const face = new THREE.Mesh(faceGeo, faceMat);
  face.position.set(0, 0, 0.67);
  gateway.add(face);

  const innerGeo = new THREE.CylinderGeometry(1.0, 1.0, 1.02, 6, 1, false);
  innerGeo.rotateX(Math.PI / 2);
  innerGeo.rotateZ(Math.PI / 6);
  const innerCore = new THREE.Mesh(
    innerGeo,
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  gateway.add(innerCore);

  const coreRingMat = new THREE.MeshBasicMaterial({
    color: 0x67e8f9,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const coreRingGeo = new THREE.TorusGeometry(0.82, 0.012, 8, 72);
  const coreRing = new THREE.Mesh(coreRingGeo, coreRingMat);
  coreRing.position.z = 0.6;
  gateway.add(coreRing);

  const outerRingMat = new THREE.MeshBasicMaterial({
    color: 0x60a5fa,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const outerRingGeo = new THREE.TorusGeometry(1.95, 0.009, 8, 128);
  const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
  outerRing.rotation.x = Math.PI / 2;
  outerRing.position.y = -0.35;
  gateway.add(outerRing);

  const sideRing = new THREE.Mesh(outerRingGeo, outerRingMat.clone());
  sideRing.rotation.set(Math.PI / 2, 0, 0.28);
  sideRing.position.y = 0.2;
  (sideRing.material as THREE.MeshBasicMaterial).opacity = 0.16;
  gateway.add(sideRing);

  // ----- client cards -----
  const cardGeo = new THREE.BoxGeometry(0.94, 0.34, 0.055);
  const cardMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.26,
    metalness: 0.02,
    clearcoat: 0.85,
    clearcoatRoughness: 0.12,
  });
  const cardEdgeGeo = new THREE.EdgesGeometry(cardGeo);
  const cardEdgeMat = new THREE.LineBasicMaterial({
    color: 0xbfdbfe,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  });
  const clientAnchors = new Map<string, THREE.Object3D>();

  for (const client of clients) {
    const group = new THREE.Group();
    group.position.fromArray(client.position);
    group.rotation.y = 0.16;
    const card = new THREE.Mesh(cardGeo, cardMat);
    group.add(card);
    group.add(new THREE.LineSegments(cardEdgeGeo, cardEdgeMat));

    const icon = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.16, 0.03),
      new THREE.MeshBasicMaterial({ color: 0x2563eb })
    );
    icon.position.set(-0.36, 0, 0.05);
    group.add(icon);

    const anchor = new THREE.Object3D();
    anchor.position.set(0.12, 0, 0.06);
    group.add(anchor);
    clientAnchors.set(client.id, anchor);

    root.add(group);
  }

  // ----- provider nodes -----
  const sphereGeo = new THREE.SphereGeometry(0.19, 32, 32);
  const hitGeo = new THREE.SphereGeometry(0.34, 12, 12);
  const hitMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const outboundBeams = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>();
  const providerNodes = new Map<
    string,
    {
      mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhysicalMaterial>;
      halo: THREE.Sprite;
      anchor: THREE.Object3D;
      color: THREE.Color;
      scale: number;
    }
  >();
  const hitTargets: THREE.Mesh[] = [];

  for (const provider of providers) {
    const color = new THREE.Color(provider.color ?? "#2563eb");
    const mat = new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.16,
      metalness: 0.12,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.2,
    });
    const mesh = new THREE.Mesh(sphereGeo, mat);
    mesh.position.fromArray(provider.position);
    mesh.userData.providerId = provider.id;
    root.add(mesh);

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    halo.scale.set(0.9, 0.9, 1);
    halo.position.copy(mesh.position);
    root.add(halo);

    const hit = new THREE.Mesh(hitGeo, hitMat);
    hit.position.copy(mesh.position);
    hit.userData.providerId = provider.id;
    root.add(hit);
    hitTargets.push(hit);

    const anchor = new THREE.Object3D();
    anchor.position.set(0, 0.3, 0);
    mesh.add(anchor);

    providerNodes.set(provider.id, { mesh, halo, anchor, color, scale: 1 });
  }

  // ----- beams + particles -----
  const inboundCurves: THREE.CatmullRomCurve3[] = clients.map((client) => {
    const start = new THREE.Vector3(client.position[0] + 0.5, client.position[1], client.position[2]);
    const end = new THREE.Vector3(-0.6, 0.08, 0.2);
    return new THREE.CatmullRomCurve3([
      start,
      new THREE.Vector3(start.x + 0.7, start.y * 0.72, start.z + 0.45),
      new THREE.Vector3(-1.55, 0.08, 0.55),
      end,
    ]);
  });

  const outboundCurves: { curve: THREE.CatmullRomCurve3; id: string }[] = providers.map((provider) => {
    const start = new THREE.Vector3(1.5, 0.08, 0.15);
    const end = new THREE.Vector3(...provider.position);
    return {
      id: provider.id,
      curve: new THREE.CatmullRomCurve3([
        start,
        new THREE.Vector3((start.x + end.x) / 2, (start.y + end.y) / 2 + 0.16, 0.6),
        end,
      ]),
    };
  });

  const addBeam = (curve: THREE.CatmullRomCurve3, color: number) => {
    const geo = new THREE.TubeGeometry(curve, 48, 0.011, 4, false);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    root.add(mesh);
    return mesh;
  };

  for (const curve of inboundCurves) addBeam(curve, 0x60a5fa);
  for (const { id, curve } of outboundCurves) outboundBeams.set(id, addBeam(curve, 0x22d3ee));

  const dotTex = makeDotTexture();
  const particleCurves: { curve: THREE.CatmullRomCurve3; color: THREE.Color }[] = [
    ...inboundCurves.map((curve) => ({ curve, color: new THREE.Color(0x93c5fd) })),
    ...outboundCurves.map(({ curve }) => ({ curve, color: new THREE.Color(0x67e8f9) })),
  ];
  const perCurve = 6;
  const particleCount = particleCurves.length * perCurve;
  const particlePositions = new Float32Array(particleCount * 3);
  const particleColors = new Float32Array(particleCount * 3);
  const particleMeta: { curve: THREE.CatmullRomCurve3; offset: number; speed: number }[] = [];
  let pi = 0;
  particleCurves.forEach(({ curve, color }) => {
    for (let i = 0; i < perCurve; i++) {
      particleMeta.push({ curve, offset: (i + 0.35) / perCurve, speed: 0.09 + (i % 3) * 0.02 });
      particleColors[pi * 3] = color.r;
      particleColors[pi * 3 + 1] = color.g;
      particleColors[pi * 3 + 2] = color.b;
      pi++;
    }
  });
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
  particleGeo.setAttribute("color", new THREE.BufferAttribute(particleColors, 3));
  const particleMat = new THREE.PointsMaterial({
    size: 0.17,
    map: dotTex,
    transparent: true,
    vertexColors: true,
    depthWrite: false,
    sizeAttenuation: true,
    alphaTest: 0.01,
  });
  const particles = new THREE.Points(particleGeo, particleMat);
  root.add(particles);

  // ----- label projection -----
  // The host rect is cached (refreshed on resize/scroll) so the per-frame
  // projection is pure math with zero layout reads.
  let hostW = Math.max(1, host.clientWidth);
  let hostH = Math.max(1, host.clientHeight);
  const refreshHostRect = () => {
    hostW = Math.max(1, host.clientWidth);
    hostH = Math.max(1, host.clientHeight);
  };
  const labelCache = new Map<string, string>();
  const updateLabels = () => {
    const w = hostW;
    const h = hostH;

    const project = (id: string, anchor: THREE.Object3D) => {
      const el = labels[id];
      if (!el) return;
      anchor.getWorldPosition(tmpVec);
      tmpVec.project(camera);
      const x = (tmpVec.x * 0.5 + 0.5) * w;
      const y = (-tmpVec.y * 0.5 + 0.5) * h;
      const inFront = tmpVec.z < 1;
      const cx = Math.max(58, Math.min(w - 58, x));
      const cy = Math.max(22, Math.min(h - 18, y));
      // Skip DOM writes when nothing changed (avoids style recalc).
      const key = `${inFront ? 1 : 0}|${cx.toFixed(1)}|${cy.toFixed(1)}`;
      if (labelCache.get(id) === key) return;
      labelCache.set(id, key);
      el.style.opacity = inFront ? "1" : "0";
      el.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0) translate(-50%, -50%)`;
    };

    clientAnchors.forEach((anchor, id) => project(id, anchor));
    providerNodes.forEach((node, id) => {
      project(id, node.anchor);
      const el = labels[id];
      if (el) el.classList.toggle("is-hot", hovered === id);
    });
  };

  // ----- resize / fit -----
  const resize = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const aspect = camera.aspect;
    const baseZ = 9.8;
    const fit = Math.max(1, 1.08 / aspect);
    camera.position.z = baseZ * fit;
    camera.updateProjectionMatrix();
    updateLabels();
  };

  // ----- pointer tilt + hover -----
  const onPointerMove = (event: PointerEvent) => {
    const rect = host.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    pointer.y = -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
    pointerNdc.set(pointer.x, pointer.y);

    const target = event.target as HTMLElement | null;
    const overLabel = target?.closest?.("[data-node-label]");
    if (cursorFine && !overLabel) {
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(hitTargets, false);
      hovered = hits[0]?.object.userData.providerId ?? null;
      host.dataset.hovered = hovered ?? "";
    }
  };
  const onPointerLeave = () => {
    pointer.x = 0;
    pointer.y = 0;
    pointerNdc.set(0, 0);
    hovered = labelHover;
  };
  const cursorFine = window.matchMedia("(pointer: fine)").matches;
  const surface = host.parentElement ?? host;
  if (cursorFine) {
    surface.addEventListener("pointermove", onPointerMove);
    surface.addEventListener("pointerleave", onPointerLeave);
  }

  // ----- visibility -----
  const io = new IntersectionObserver(
    (entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) clock.getDelta();
    },
    { threshold: 0 }
  );
  io.observe(host);
  const onVisibility = () => {
    if (!document.hidden) clock.getDelta();
  };
  document.addEventListener("visibilitychange", onVisibility);

  const ro = new ResizeObserver(() => {
    refreshHostRect();
    resize();
  });
  ro.observe(host);
  const onScrollResize = () => refreshHostRect();
  window.addEventListener("scroll", onScrollResize, { passive: true });
  window.addEventListener("resize", onScrollResize, { passive: true });
  resize();

  const onContextLost = (event: Event) => {
    event.preventDefault();
    canvas.style.display = "none";
    stop();
    onFail();
  };
  canvas.addEventListener("webglcontextlost", onContextLost, false);

  // ----- render loop -----
  const providerList = [...providerNodes.entries()];
  const start = performance.now();

  let lastFrame = 0;
  let emaFrame = 0;
  let downgraded = false;
  const render = () => {
    if (disposed.value) return;
    raf = requestAnimationFrame(render);
    if (!visible || document.hidden) return;

    // Cap the frame rate (30fps full, 20fps lean). dt stays clock-based
    // so motion speed is unaffected. One-way adaptive downgrade: if frames
    // stay slow, drop to the lean buffer so weak GPUs stop janking.
    const frameBudget = software ? 50 : 33;
    const now = performance.now();
    const gap = now - lastFrame;
    if (gap < frameBudget) return;
    lastFrame = now;

    if (!software && now - start > 4000 && emaFrame > 90 && !downgraded) {
      downgraded = true;
      renderer.setPixelRatio(0.5);
    }
    emaFrame = emaFrame === 0 ? gap : emaFrame * 0.95 + gap * 0.05;

    const dt = Math.min(clock.getDelta(), 0.05);
    const t = (performance.now() - start) / 1000;
    const intro = easeOutCubic(Math.min(1, t / 0.9));

    // pointer tilt with damping (whole scene)
    const targetX = pointer.y * 0.055;
    const targetY = pointer.x * 0.09;
    root.rotation.x += (targetX - root.rotation.x) * Math.min(1, dt * 4.2);
    root.rotation.y += (targetY - root.rotation.y) * Math.min(1, dt * 4.2);
    host.dataset.tiltX = root.rotation.x.toFixed(4);
    host.dataset.tiltY = root.rotation.y.toFixed(4);

    // gateway motion: slow oscillation keeps the face readable, plus float
    gateway.rotation.x = -0.06 + Math.sin(t * 0.4) * 0.02;
    gateway.rotation.y = 0.42 + Math.sin(t * 0.18) * 0.16;
    gateway.position.y = 0.08 + Math.sin(t * 0.8) * 0.055;
    gateway.scale.setScalar(0.9 + 0.1 * intro);
    coreRing.rotation.z = t * 0.25;
    outerRing.rotation.z = -t * 0.12;
    sideRing.rotation.z = 0.28 + Math.sin(t * 0.3) * 0.12;

    // label + node hover response
    for (const [id, node] of providerList) {
      const hot = hovered === id;
      node.scale += ((hot ? 1.32 : 1) - node.scale) * Math.min(1, dt * 8);
      node.mesh.scale.setScalar(node.scale * intro);
      const haloMat = node.halo.material as THREE.SpriteMaterial;
      haloMat.opacity += ((hot ? 0.68 : 0.28) - haloMat.opacity) * Math.min(1, dt * 8);
      node.halo.scale.setScalar((hot ? 1.2 : 0.9) * intro + 0.0001);
      const beam = outboundBeams.get(id);
      if (beam) {
        beam.material.opacity += ((hot ? 0.95 : 0.5) - beam.material.opacity) * Math.min(1, dt * 8);
        beam.material.color.lerp(node.color, Math.min(1, dt * 5));
      }
    }
    glow.material.opacity = 0.48 + Math.sin(t * 0.7) * 0.06;
    host.dataset.hovered = hovered ?? "";

    // particles
    for (let i = 0; i < particleMeta.length; i++) {
      const meta = particleMeta[i];
      const tt = (meta.offset + t * meta.speed) % 1;
      const p = meta.curve.getPointAt(tt);
      particlePositions[i * 3] = p.x;
      particlePositions[i * 3 + 1] = p.y;
      particlePositions[i * 3 + 2] = p.z;
    }
    (particleGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    particleMat.opacity = 0.95 * intro;

    updateLabels();
    renderer.render(scene, camera);
  };

  render();

  function setHovered(id: string | null) {
    labelHover = id;
    hovered = id;
    host.dataset.hovered = id ?? "";
  }

  function stop() {
    if (disposed.value) return;
    disposed.value = true;
    cancelAnimationFrame(raf);
    io.disconnect();
    ro.disconnect();
    window.removeEventListener("scroll", onScrollResize);
    window.removeEventListener("resize", onScrollResize);
    document.removeEventListener("visibilitychange", onVisibility);
    if (cursorFine) {
      surface.removeEventListener("pointermove", onPointerMove);
      surface.removeEventListener("pointerleave", onPointerLeave);
    }
    canvas.removeEventListener("webglcontextlost", onContextLost, false);
  }

  function dispose() {
    stop();
    if (canvas.parentElement === host) host.removeChild(canvas);
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) disposeMaterial(mesh.material);
    });
    envRT.dispose();
    envSource.dispose();
    faceTex.dispose();
    faceGlowTex.dispose();
    floorTex.dispose();
    glowTex.dispose();
    dotTex.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }

  return { setHovered, dispose };
}
