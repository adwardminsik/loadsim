import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { searchParts } from '../api.js';

const MM = 1 / 1000; // 화면 단위는 m

// [2026-10 추가] 화면 비율(가로:세로)이 바뀌어도 - 예: 노트북 자체 화면과 외부 모니터
// 연결 시 창 크기/비율이 달라지는 경우 - 카메라가 같은 구도로 다시 맞춰지도록, "보고 있는
// 지점(center)"과 "맞춰야 할 반경(radius)"만으로 카메라 위치를 계산하는 공통 함수.
// aspect는 호출 시점의 실제 화면 비율을 받아서, 리사이즈될 때마다 다시 계산할 수 있게 한다.
function computeFitCamera(camera, aspect, center, radius, dir, margin) {
  const fov = (camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
  const dist = (Math.max(radius, 0.4) / Math.sin(Math.min(fov, hFov) / 2)) * margin;
  return { pos: center.clone().addScaledVector(dir, dist), lookAt: center.clone() };
}

function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    }
  });
}

/* ──────────────────────────────────────────────────────────────────────
 * 부품 대분류(카테고리) 대표 이미지 + 색상 — 데모(preview.html)에서 쓰던 로직
 * ────────────────────────────────────────────────────────────────────── */
const CATEGORY_IMAGES = {
  BEARING: '/parts/category/BEARING.png',
  BOLT: '/parts/category/BOLT.png',
  BRACKET: '/parts/category/BRACKET.png',
  CLAMP: '/parts/category/CLAMP.png',
  COVER: '/parts/category/COVER.png',
  ELEMENT: '/parts/category/ELEMENT.png',
  FILTER: '/parts/category/FILTER.png',
  GASKET: '/parts/category/GASKET.png',
  HARNESS: '/parts/category/HARNESS.png',
  HOSE: '/parts/category/HOSE.png',
  MUFFLER: '/parts/category/MUFFLER.png',
  'O-RING': '/parts/category/O-RING.png',
  PIPE: '/parts/category/PIPE.png',
  PUMP: '/parts/category/PUMP.png',
  SCREW: '/parts/category/SCREW.png',
  SEALRING: '/parts/category/SEALRING.png',
  SENSOR: '/parts/category/SENSOR.png',
  STARTER: '/parts/category/STARTER.png',
  'TURBOCHARGER ASSY': '/parts/category/TURBOCHARGER_ASSY.png',
  VALVE: '/parts/category/VALVE.png',
};
// [2026-10 추가] 카테고리 대표사진이 없던 품번들에 대해 실제 CAD 렌더 이미지를 받아
// 배경(파란 그라디언트+격자선)을 누끼따서 품번별로 직접 연결한 사진. 카테고리 사진보다
// 우선순위가 높다(더 구체적인 실물 이미지이므로) - makePartMesh에서 PART_IMAGES를 먼저 찾고
// 없을 때만 CATEGORY_IMAGES로 폴백한다.
const PART_IMAGES = {
  '06.16044-0210': '/parts/part/06.16044-0210.png',
  '06.16731-2111': '/parts/part/06.16731-2111.png',
  '06.29020-0126': '/parts/part/06.29020-0126.png',
  '06.29020-0127': '/parts/part/06.29020-0127.png',
  '110911-00161A': '/parts/part/110911-00161A.png',
  '110911-00644': '/parts/part/110911-00644.png',
  '110928-00014C': '/parts/part/110928-00014C.png',
  '110980-00035E': '/parts/part/110980-00035E.png',
  '110980-00100C': '/parts/part/110980-00100C.png',
  '111104-00085': '/parts/part/111104-00085.png',
  '120816-00237': '/parts/part/120816-00237.png',
  '130206-00067': '/parts/part/130206-00067.png',
  '150101-00260': '/parts/part/150101-00260.png',
  '240401-00621': '/parts/part/240401-00621.png',
  '240401-00622': '/parts/part/240401-00622.png',
  '300618-00146': '/parts/part/300618-00146.png',
  '400603-00215': '/parts/part/400603-00215.png',
  '400606-00909': '/parts/part/400606-00909.png',
  '400825-00421': '/parts/part/400825-00421.png',
  '400903-00223': '/parts/part/400903-00223.png',
  '430208-00385': '/parts/part/430208-00385.png',
  '440211-00195': '/parts/part/440211-00195.png',
  '440211-00197': '/parts/part/440211-00197.png',
  '65.02501-0701A': '/parts/part/65.02501-0701A.png',
  '65.02502-0013': '/parts/part/65.02502-0013.png',
  '65.02502-0081': '/parts/part/65.02502-0081.png',
  '65.04103-0074': '/parts/part/65.04103-0074.png',
  '65.04104-0006': '/parts/part/65.04104-0006.png',
  '65.90302-0050': '/parts/part/65.90302-0050.png',
  '65.90810-0011': '/parts/part/65.90810-0011.png',
  '65.95800-7025': '/parts/part/65.95800-7025.png',
  '65.98130-0226': '/parts/part/65.98130-0226.png',
  'K1-E6303-33752': '/parts/part/K1-E6303-33752.png',
};
const CATEGORY_EXCEPTIONS = [
  [/^RING,O(;|,|$)/, 'O-RING'],
  [/^BELT,V(;|,|$)/, 'V-BELT'],
  [/^CHARGER ASSY,TURBO(;|,|$)/, 'TURBOCHARGER ASSY'],
];
function classifyCategory(rawName) {
  const name = (rawName || '').trim();
  for (const [re, label] of CATEGORY_EXCEPTIONS) if (re.test(name)) return label;
  let front = name.split(/[,;]/)[0].trim();
  if (front.toUpperCase().endsWith(' ASSY')) front = front.slice(0, -5).trim();
  return front;
}
function getCategoryImage(name) {
  return CATEGORY_IMAGES[classifyCategory(name)] || null;
}
// 품번 전용 사진(PART_IMAGES)이 있으면 그걸 우선 쓰고, 없으면 카테고리 대표사진으로 폴백.
function getPartImage(partNo, name) {
  return PART_IMAGES[partNo] || getCategoryImage(name);
}
function isScrewLikePart(name) {
  const cat = classifyCategory(name);
  return cat === 'BOLT' || cat === 'SCREW';
}
function partColor(partNo) {
  let h = 0;
  for (const c of String(partNo)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return new THREE.Color(`hsl(${h},80%,60%)`);
}

const _partTexLoader = new THREE.TextureLoader();
const _partTexCache = new Map();
function getPartTexture(path) {
  if (_partTexCache.has(path)) return _partTexCache.get(path);
  const tex = _partTexLoader.load(path);
  tex.colorSpace = THREE.SRGBColorSpace;
  _partTexCache.set(path, tex);
  return tex;
}
function withEdges(mesh, color) {
  const geo = mesh.geometry;
  if (!geo) return mesh;
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: color || 0x1a2633, transparent: true, opacity: 0.45 }),
  );
  mesh.add(edges);
  return mesh;
}

// 부품 하나를 사진(스프라이트) 또는 절차적 도형으로 만든다. info: { name, dims:[l,w,h] }
function makePartMesh(partNo, info) {
  const name = (info && info.name) || '';
  const dims = (info && info.dims && info.dims.every(Boolean) && info.dims) || [100, 100, 100];
  const img = getPartImage(partNo, name);
  if (img) {
    const tex = getPartTexture(img);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    const longest = Math.max(...dims, 1);
    const size = Math.max(0.0006 * longest, 0.03);
    sprite.scale.set(size, size, 1);
    return sprite;
  }
  const pColor = partColor(partNo);
  const mat = new THREE.MeshStandardMaterial({
    color: pColor,
    emissive: pColor,
    emissiveIntensity: 0.28,
    roughness: 0.5,
    metalness: 0.08,
  });
  const [rawL, rawW, rawH] = dims;
  const longest = Math.max(rawL, rawW, rawH, 1);
  const k = Math.min(0.00035 * longest, 0.13) / longest;
  const L = Math.max(rawL * k, 0.025);
  const W = Math.max(rawW * k, 0.025);
  const H = Math.max(rawH * k, 0.02);
  const mesh = withEdges(new THREE.Mesh(new THREE.BoxGeometry(L, H, W), mat));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function spawnDustPuff(world, pos, tweenFn) {
  const parts = [];
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
    );
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.7 + 0.2, Math.random() - 0.5)
      .normalize()
      .multiplyScalar(0.22 + Math.random() * 0.22);
    m.position.copy(pos);
    world.add(m);
    parts.push({ m, dir });
  }
  tweenFn(480, (t) => {
    parts.forEach((p) => {
      p.m.position.copy(pos).addScaledVector(p.dir, t);
      p.m.material.opacity = 0.85 * (1 - t);
    });
  }).then(() => parts.forEach((p) => world.remove(p.m)));
}

// 박스 상단에 여닫이 플랩(힌지) 2장을 붙인다. open: Math.PI/2(열림)→0(닫힘)
function addBoxFlaps(boxMesh, dims, material) {
  const flapLen = (dims.z / 2) * 0.97;
  const thick = Math.max(0.012, dims.y * 0.035);
  const geoA = new THREE.BoxGeometry(dims.x * 0.97, thick, flapLen);
  geoA.translate(0, 0, -flapLen / 2);
  const pivotA = new THREE.Group();
  pivotA.position.set(0, dims.y / 2, dims.z / 2);
  pivotA.rotation.x = Math.PI / 2;
  const flapA = new THREE.Mesh(geoA, material);
  pivotA.add(flapA);
  boxMesh.add(pivotA);

  const geoB = new THREE.BoxGeometry(dims.x * 0.97, thick, flapLen);
  geoB.translate(0, 0, flapLen / 2);
  const pivotB = new THREE.Group();
  pivotB.position.set(0, dims.y / 2, -dims.z / 2);
  pivotB.rotation.x = -Math.PI / 2;
  const flapB = new THREE.Mesh(geoB, material);
  pivotB.add(flapB);
  boxMesh.add(pivotB);
  return { pivotA, pivotB, openA: Math.PI / 2, openB: -Math.PI / 2 };
}

// 색상표(colorMap)의 박스 색을 입힌 나무상자 텍스처 — 기존 사이드패널 범례 색과 일치시킴
const _crateTexCache = new Map();
function getCrateTexture(id, hexColor) {
  const key = `${id}|${hexColor}`;
  if (_crateTexCache.has(key)) return _crateTexCache.get(key);
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = hexColor || '#8899aa';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.lineWidth = 3;
  for (let y = 18; y < 256; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 7;
  ctx.strokeRect(4, 4, 248, 248);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(0, 0, 256, 10);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.font = 'bold 30px Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 4;
  ctx.fillText(String(id), 128, 132);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  _crateTexCache.set(key, tex);
  return tex;
}

const _qtyBadgeCache = new Map();
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function makeQtyBadgeSprite(partNo, qty) {
  const key = `${partNo}|${qty}`;
  if (_qtyBadgeCache.has(key)) return _qtyBadgeCache.get(key).clone();
  const c = document.createElement('canvas');
  c.width = 680;
  c.height = 300;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.97)';
  roundRectPath(ctx, 8, 8, 664, 284, 36);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 68px Menlo, Consolas, monospace';
  ctx.fillText(String(partNo), 340, 96);
  ctx.font = 'bold 72px "Segoe UI", sans-serif';
  ctx.fillText(`${Number(qty).toLocaleString()}개`, 340, 208);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.renderOrder = 999;
  sprite.scale.set(0.68, (0.68 * 300) / 680, 1);
  _qtyBadgeCache.set(key, sprite);
  return sprite.clone();
}

/**
 * 컨테이너 1대의 적재 배치를 3D로 보여줍니다.
 * 백엔드 좌표계: x=컨테이너 길이, y=폭, z=높이(위쪽). Three.js는 y가 위쪽이라 (x, z, y)로 바꿔 그립니다.
 *
 * 데모(preview.html)에서 검증한 연출(부품이 쏟아져 나와 박스별로 포장된 뒤 컨테이너로 날아가는
 * 입장 애니메이션, 클릭 시 뚜껑 열고 내용물 사진/품번/수량 미리보기)을 그대로 재현한다.
 * 선택 상태는 부모(Results.jsx)가 selectedIndex/onSelect로 제어한다(이 컴포넌트는 내부에
 * 선택 상태를 따로 갖지 않음).
 */
export default function ContainerViewer({ container, placements, colorMap, selectedIndex, onSelect, onStage }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  const [webglError, setWebglError] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // ── 장면 초기화 (한 번) ──
  useEffect(() => {
    const el = mountRef.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setWebglError(true);
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf1f3f6);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.495;
    // 사용자가 직접 드래그/휠로 카메라를 움직이면, 그 다음부터는 리사이즈돼도
    // 억지로 구도를 되돌리지 않는다(사용자가 고른 시점을 존중).
    let userMoved = false;
    controls.addEventListener('start', () => {
      userMoved = true;
    });

    scene.add(new THREE.HemisphereLight(0xf3f7ff, 0x8a97a8, 0.9));
    const sun = new THREE.DirectionalLight(0xfff3e0, 1.6);
    sun.position.set(9, 13, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    const world = new THREE.Group();
    scene.add(world);

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // 화면/창 비율이 바뀌면(모니터 교체·연결 등) 같은 구도로 다시 맞춘다.
      // 사용자가 직접 카메라를 조작한 뒤에는 그 시점을 존중해 건드리지 않는다.
      const sc = sceneRef.current;
      if (sc && sc.ready && !userMoved && typeof sc.activeRefit === 'function') {
        const fresh = sc.activeRefit(w / h);
        camera.position.copy(fresh.pos);
        camera.lookAt(fresh.lookAt);
        controls.target.copy(fresh.lookAt);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down = null;
    const onDown = (e) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 5) return;
      const s = sceneRef.current;
      if (!s || !s.ready) return; // 입장 애니메이션 중에는 클릭 무시
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const meshes = s.meshes || [];
      const hit = raycaster.intersectObjects(meshes, false)[0];
      onSelectRef.current?.(hit ? hit.object.userData.index : null);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    sceneRef.current = { scene, camera, controls, world, meshes: [], renderer, token: 0, ready: false };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      disposeObject(world);
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  // ── 컨테이너/박스 구성: 부품이 쏟아져 나와 박스별로 포장된 뒤 컨테이너로 날아가는 입장 연출 ──
  useEffect(() => {
    const s = sceneRef.current;
    if (!s || !container || !placements) return;
    const myToken = ++s.token;
    s.ready = false;
    s.controls.enabled = false;

    [...s.world.children].forEach((c) => {
      s.world.remove(c);
      disposeObject(c);
    });
    s.meshes = [];
    s.previewGroup = null;

    function cancelledNow() {
      return s.token !== myToken || !sceneRef.current;
    }
    function easeInOutQuad(t) {
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }
    function tween(duration, onUpdate) {
      return new Promise((resolve) => {
        if (cancelledNow()) {
          onUpdate(1);
          return resolve();
        }
        const start0 = performance.now();
        const step = (now) => {
          if (cancelledNow()) {
            onUpdate(1);
            return resolve();
          }
          const t = Math.min(1, (now - start0) / duration);
          onUpdate(easeInOutQuad(t));
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
    }
    function wait(ms) {
      return new Promise((r) => {
        if (cancelledNow()) return r();
        setTimeout(r, ms);
      });
    }
    function staggeredTween(items, duration, stagger, onUpdate) {
      return Promise.all(items.map((item, i) => wait(i * stagger).then(() => tween(duration, (t) => onUpdate(item, t, i)))));
    }

    const { world, camera, controls, renderer } = s;

    function aspectOf() {
      const el = mountRef.current;
      return Math.max(0.3, (el?.clientWidth || 800) / (el?.clientHeight || 440));
    }
    function stagingGridCols(total) {
      return Math.max(1, Math.ceil(Math.sqrt(total)));
    }
    function slotSpacing(total) {
      return Math.min(1.5, 7 / Math.max(stagingGridCols(total), 1));
    }
    function stagingSlotFor(i, total, base) {
      const cols = stagingGridCols(total);
      const rows = Math.max(1, Math.ceil(total / cols));
      const col = i % cols;
      const row = Math.floor(i / cols);
      const sp = slotSpacing(total);
      const colOffset = (col - (cols - 1) / 2) * sp;
      const rowOffset = (row - (rows - 1) / 2) * sp;
      return base.clone().add(new THREE.Vector3(rowOffset, 0, colOffset));
    }
    function stagingRowCameraState(base, total) {
      const cols = stagingGridCols(total);
      const rows = Math.max(1, Math.ceil(total / cols));
      const sp = slotSpacing(total);
      const spanCol = Math.max(1, (cols - 1) * sp);
      const spanRow = Math.max(1, (rows - 1) * sp);
      const fov = (camera.fov * Math.PI) / 180;
      const hFov = 2 * Math.atan(Math.tan(fov / 2) * aspectOf());
      const halfSpan = Math.max(spanCol, spanRow) / 2 + 1.1;
      const dist = Math.max(2.2, (halfSpan / Math.tan(hFov / 2)) * 1.2);
      const dir = new THREE.Vector3(1.0, 0.7, 0.0).normalize();
      return {
        pos: base.clone().add(new THREE.Vector3(0, 0.6, 0)).addScaledVector(dir, dist),
        lookAt: base.clone().add(new THREE.Vector3(0, 0.6, 0)),
      };
    }
    function containerCameraState(L, W, H) {
      const center = new THREE.Vector3(L / 2, H / 2, W / 2);
      const radius = Math.sqrt(L * L + H * H + W * W) / 2;
      const fov = (camera.fov * Math.PI) / 180;
      const hFov = 2 * Math.atan(Math.tan(fov / 2) * aspectOf());
      const dist = (radius / Math.sin(Math.min(fov, hFov) / 2)) * 1.12;
      const dir = new THREE.Vector3(0.6, 0.45, 0.9).normalize();
      return { pos: center.clone().addScaledVector(dir, dist), lookAt: center };
    }
    function setCameraInstant(camState) {
      camera.position.copy(camState.pos);
      camera.lookAt(camState.lookAt);
      controls.target.copy(camState.lookAt);
    }
    async function tweenCameraTo(camState, duration) {
      const fromPos = camera.position.clone();
      const fromLook = controls.target.clone();
      await tween(duration, (e) => {
        camera.position.lerpVectors(fromPos, camState.pos, e);
        const lookAt = fromLook.clone().lerp(camState.lookAt, e);
        camera.lookAt(lookAt);
        controls.target.copy(lookAt);
      });
    }

    function placementWorldPos(p) {
      const [px, py, pz] = p.position;
      const [dx, dy, dz] = p.dims_mm;
      return new THREE.Vector3((px + dx / 2) * MM, (pz + dz / 2) * MM, (py + dy / 2) * MM);
    }

    async function run() {
      const L = container.length_mm * MM;
      const W = container.width_mm * MM;
      const H = container.height_mm * MM;

      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(L + 3, W + 2),
        new THREE.MeshStandardMaterial({ color: 0xdfe4ea, roughness: 0.95 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(L / 2, 0, W / 2);
      floor.receiveShadow = true;
      world.add(floor);
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(L, H, W)),
        new THREE.LineBasicMaterial({ color: 0x141e28, transparent: true, opacity: 0.55 }),
      );
      outline.position.set(L / 2, H / 2, W / 2);
      world.add(outline);

      // 1) 품명(desc)은 백엔드가 이미 내려준 값으로 즉시 채운다 — 카테고리 이미지 분류는 이것만으로 충분하다.
      //    실제 mm 치수는 /part-types에서 보충하면 더 정확하지만, 품번이 많을 때 네트워크 왕복을 전부
      //    기다리면 애니메이션 시작 자체가 늦어지므로(브라우저의 동시 연결 수 제한 때문에 품번이
      //    많을수록 더 심해짐) 기다리지 않고 기본 치수로 바로 시작하고, 정확한 치수는 백그라운드에서
      //    채워서 이후 단계(클릭 시 내용물 미리보기 등)에 반영한다.
      const partInfoMap = new Map();
      const distinct = new Set();
      placements.forEach((p) =>
        (p.parts || []).forEach((pt) => {
          distinct.add(pt.part_no);
          partInfoMap.set(pt.part_no, { name: pt.desc || pt.part_no, dims: [100, 100, 100] });
        }),
      );
      s.partInfoMap = partInfoMap; // 아래 백그라운드 조회가 같은 Map을 계속 채워나간다
      [...distinct].forEach(async (partNo) => {
        try {
          const res = await Promise.race([
            searchParts(partNo, { page: 1, size: 30 }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500)),
          ]);
          const exact = (res.items || []).find((it) => it.partNo === partNo) || (res.items || [])[0];
          if (exact && exact.dims && exact.dims.every(Boolean)) {
            const prev = partInfoMap.get(partNo);
            partInfoMap.set(partNo, { name: prev?.name || exact.name || partNo, dims: exact.dims });
          }
        } catch {
          /* 조회 실패 시 기본 치수 유지 — 애니메이션 진행에는 영향 없음 */
        }
      });
      if (cancelledNow()) return;

      // 2) 포장 구역(컨테이너 밖) 설정
      const staging = new THREE.Vector3(-1.8, 0, W / 2);
      const slots = placements.map((_, i) => stagingSlotFor(i, placements.length, staging));
      setCameraInstant(stagingRowCameraState(staging, placements.length));

      // 3) 부품이 한 점에서 포장 구역 전체로 뒤섞여 쏟아지는 연출
      const burstOrigin = new THREE.Vector3(staging.x, 0.9, staging.z);
      const spacing = slotSpacing(placements.length);
      const gridCols = stagingGridCols(placements.length);
      const gridRows = Math.max(1, Math.ceil(placements.length / gridCols));
      const spreadX = Math.max(1, (gridRows - 1) * spacing) / 2 + 0.7;
      const spreadZ = Math.max(1, (gridCols - 1) * spacing) / 2 + 0.7;
      // 부품/박스 수가 많을수록 쏟아지는 조각 수도 같이 늘어나서 연출 전체가 느려지므로,
      // 전체 조각 수가 많아지면 품번당 복제 상한을 확 낮춰서 조각 수 자체를 억제한다.
      let estimatedUnits = 0;
      placements.forEach((p) => {
        const parts = p.parts && p.parts.length ? p.parts : [{ qty: 1 }];
        parts.forEach((pt) => {
          estimatedUnits += Math.max(1, Math.min(Math.ceil(Math.sqrt(pt.qty || 1)), 9));
        });
      });
      const perPartCap = estimatedUnits > 400 ? 1 : estimatedUnits > 150 ? 3 : 9;
      const pile = [];
      placements.forEach((p, bi) => {
        const parts = p.parts && p.parts.length ? p.parts : [{ part_no: '?', qty: 1 }];
        const items = [];
        parts.forEach((pt) => {
          const count = Math.max(1, Math.min(Math.ceil(Math.sqrt(pt.qty || 1)), perPartCap));
          for (let k = 0; k < count; k++) items.push(pt.part_no);
        });
        items.forEach((partNo) => {
          const mesh = makePartMesh(partNo, partInfoMap.get(partNo));
          const baseScale = (mesh.scale.x || 1) * 2.3;
          mesh.position.copy(burstOrigin);
          mesh.scale.setScalar(0.001);
          mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
          world.add(mesh);
          const target = new THREE.Vector3(
            staging.x + (Math.random() - 0.5) * 2 * spreadX,
            0.07 + Math.random() * 0.5,
            staging.z + (Math.random() - 0.5) * 2 * spreadZ,
          );
          pile.push({ mesh, boxIndex: bi, target, baseScale });
        });
      });
      for (let i = pile.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pile[i], pile[j]] = [pile[j], pile[i]];
      }
      // 조각이 많아져도 전체 쏟아짐 연출의 총 시간은 일정 범위(~1초) 안으로 묶어둔다.
      const burstStagger = pile.length > 1 ? Math.min(13, 900 / (pile.length - 1)) : 13;
      await staggeredTween(pile, 650, burstStagger, (c, t) => {
        const e = 1 - Math.pow(1 - t, 3);
        c.mesh.position.lerpVectors(burstOrigin, c.target, e);
        c.mesh.scale.setScalar(c.baseScale * Math.min(1, e * 1.2));
        c.mesh.rotation.y += 0.3;
      });
      if (cancelledNow()) return;
      await wait(380);
      if (cancelledNow()) return;

      onStage?.({
        activeIdx: [0, 1, 2],
        caption: `박스 ${placements.length}개에 부품을 동시 적입 중입니다…`,
        hint: '박스별로 지정 수량을 적입한 뒤 포장을 완료합니다.',
        progress: 0,
      });

      // 4) 모든 박스가 동시에 ①소팅 ②적입 ③포장
      async function packBoxAtStaging(placement, pileCubes, stagingCenter) {
        const boxDims = new THREE.Vector3(
          Math.max(0.4, placement.dims_mm[0] * MM * 0.5),
          Math.max(0.3, placement.dims_mm[2] * MM * 0.5),
          Math.max(0.4, placement.dims_mm[1] * MM * 0.5),
        );
        const stagingBoxPos = new THREE.Vector3(stagingCenter.x, boxDims.y / 2 + 0.02, stagingCenter.z);
        const crateMat = new THREE.MeshStandardMaterial({
          map: getCrateTexture(placement.box_type_id, colorMap[placement.box_type_id]),
          roughness: 0.85,
          metalness: 0.04,
        });
        const boxMesh = new THREE.Mesh(new THREE.BoxGeometry(boxDims.x, boxDims.y, boxDims.z), crateMat);
        boxMesh.position.copy(stagingBoxPos);
        boxMesh.castShadow = true;
        boxMesh.receiveShadow = true;
        world.add(boxMesh);
        const flaps = addBoxFlaps(boxMesh, boxDims, crateMat);
        flaps.pivotA.rotation.x = flaps.openA;
        flaps.pivotB.rotation.x = flaps.openB;
        boxMesh.userData.flaps = flaps;
        boxMesh.userData.flapOpen = 1;

        const cubes = pileCubes.map((c) => ({ mesh: c.mesh, from: c.mesh.position.clone(), baseScale: c.baseScale || 1 }));
        const n = cubes.length;
        // 소팅(줄 세우기)만은 박스 개수와 무관하게 늘 천천히 — 데모 원안과 동일. 단, 박스 하나에
        // 담긴 조각 수가 아주 많아지면 그 총 소요 시간만은 일정 범위로 눌러준다.
        const sortSpeed = 1.9;
        const sortStagger = n > 1 ? Math.min(150 * sortSpeed, 700 / (n - 1)) : 150 * sortSpeed;
        const packStagger = n > 1 ? Math.min(48, 300 / (n - 1)) : 48;
        const lineUpCenter = stagingCenter.clone().add(new THREE.Vector3(0, boxDims.y + 0.4, 0));
        await staggeredTween(cubes, 760 * sortSpeed, sortStagger, (c, t, i) => {
          const e = 1 - Math.pow(1 - t, 3);
          const target = lineUpCenter.clone().add(new THREE.Vector3((i - (n - 1) / 2) * 0.17, 0, 0));
          c.mesh.position.lerpVectors(c.from, target, e);
          c.mesh.rotation.y = c.from.x * 3 + e * Math.PI * 0.9;
        });
        const fromBox = cubes.map((c) => c.mesh.position.clone());
        await staggeredTween(cubes, 280, packStagger, (c, t, i) => {
          const e = t * t;
          c.mesh.position.lerpVectors(fromBox[i], stagingBoxPos, e);
          c.mesh.scale.setScalar(c.baseScale * Math.max(0.03, 1 - e * 0.97));
          c.mesh.rotation.y += 0.4;
        });
        cubes.forEach((c) => world.remove(c.mesh));

        await tween(400, (t) => {
          flaps.pivotA.rotation.x = THREE.MathUtils.lerp(flaps.openA, 0, t);
          flaps.pivotB.rotation.x = THREE.MathUtils.lerp(flaps.openB, 0, t);
        });
        boxMesh.userData.flapOpen = 0;
        spawnDustPuff(world, stagingBoxPos.clone().add(new THREE.Vector3(0, boxDims.y / 2, 0)), tween);
        return { boxMesh, boxDims };
      }
      async function flyBoxToContainer(packedEntry, placement, idx, speed) {
        const { boxMesh, boxDims } = packedEntry;
        const dest = placementWorldPos(placement);
        const destDims = new THREE.Vector3(placement.dims_mm[0] * MM, placement.dims_mm[2] * MM, placement.dims_mm[1] * MM);
        const from = boxMesh.position.clone();
        const arcHeight = 0.7;
        const flightDuration = Math.max(360 * speed, 260);
        await Promise.all([
          tween(flightDuration, (e) => {
            boxMesh.position.lerpVectors(from, dest, e);
            boxMesh.position.y += Math.sin(e * Math.PI) * arcHeight;
            boxMesh.rotation.y = e * Math.PI * 0.08 * (idx % 2 ? 1 : -1);
            boxMesh.scale.set(
              1 + (destDims.x / boxDims.x - 1) * e,
              1 + (destDims.y / boxDims.y - 1) * e,
              1 + (destDims.z / boxDims.z - 1) * e,
            );
          }),
          tweenCameraTo(containerCameraState(L, W, H), flightDuration),
        ]);
        boxMesh.position.copy(dest);
        boxMesh.rotation.y = 0;
        boxMesh.scale.set(destDims.x / boxDims.x, destDims.y / boxDims.y, destDims.z / boxDims.z);
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(boxDims.x, boxDims.y, boxDims.z)),
          new THREE.LineBasicMaterial({ color: 0x1a2633, transparent: true, opacity: 0.5 }),
        );
        boxMesh.add(edges);
        boxMesh.userData.edges = edges;
        boxMesh.userData.dims = destDims.clone();
        boxMesh.userData.finalPos = dest.clone();
        spawnDustPuff(world, dest.clone().add(new THREE.Vector3(0, -destDims.y / 2 + 0.05, 0)), tween);
      }

      const packed = await Promise.all(
        placements.map((p, i) => packBoxAtStaging(p, pile.filter((c) => c.boxIndex === i), slots[i])),
      );
      if (cancelledNow()) return;

      onStage?.({ activeIdx: [3], caption: `컨테이너 적재 중 · 박스 0/${packed.length}`, progress: 0 });
      // 박스 출발 간격 — 박스가 아주 많아지면(=부품이 아주 많을 때) 전체 발사 시간이
      // 한없이 늘어나지 않도록 간격 자체도 같이 줄인다(데모 원안의 85ms가 기준 상한).
      const LAUNCH_GAP = packed.length > 1 ? Math.min(85, 2200 / (packed.length - 1)) : 85;
      const flights = [];
      let flownCount = 0;
      for (let i = 0; i < packed.length; i++) {
        if (cancelledNow()) break;
        // 박스 수(=부품이 많아질수록 늘어남)가 일정 수준을 넘으면 뒤로 갈수록 자동으로 더 빠르게
        const speed = i < 2 ? 0.9 : i < 6 ? 0.55 : i < 15 ? 0.4 : 0.3;
        onStage?.({ activeIdx: [3], caption: `컨테이너 적재 중 · 박스 ${i + 1}/${packed.length}`, progress: Math.round((flownCount / packed.length) * 100) });
        flights.push(
          flyBoxToContainer(packed[i], placements[i], i, speed).then(() => {
            flownCount++;
            onStage?.({
              activeIdx: [3],
              caption: `컨테이너 적재 중 · 박스 ${flownCount}/${packed.length}`,
              progress: Math.round((flownCount / packed.length) * 100),
            });
          }),
        );
        if (i < packed.length - 1) await wait(LAUNCH_GAP);
      }
      await Promise.all(flights);
      if (cancelledNow()) return;
      onStage?.({ activeIdx: [3], caption: '적재 완료', progress: 100 });
      await wait(400);
      if (cancelledNow()) return;

      // 5) 적재 완료 — 인터랙티브 모드로 전환
      packed.forEach((entry, i) => {
        const mesh = entry.boxMesh;
        mesh.userData.index = i;
        mesh.userData.parts = placements[i].parts || [];
        s.meshes.push(mesh);
      });
      s.partInfoMap = partInfoMap;

      // [2026-10 수정] 적재된 박스들의 bounding box만 기준으로 center를 잡으면, 컨테이너가
      // 박스로 꽉 안 찬 경우(적재율<100%) 박스 뭉치 쪽으로 카메라 중심이 쏠려서 컨테이너
      // 바닥/빈 공간이 화면 한쪽으로 치우쳐 보였다. 컨테이너 전체 바닥(L×W×H, 0~L/0~W/0~H)도
      // bounding box 계산에 같이 포함시켜서, 항상 "컨테이너 전체"가 화면 중앙에 오도록 한다.
      let minX = 0, minY = 0, minZ = 0, maxX = L, maxY = H, maxZ = W;
      placements.forEach((p) => {
        const [px, py, pz] = p.position;
        const [dx, dy, dz] = p.dims_mm;
        const wx = (px + dx / 2) * MM, wy = (pz + dz / 2) * MM, wz = (py + dy / 2) * MM;
        const hx = (dx / 2) * MM, hy = (dz / 2) * MM, hz = (dy / 2) * MM;
        minX = Math.min(minX, wx - hx); maxX = Math.max(maxX, wx + hx);
        minY = Math.min(minY, wy - hy); maxY = Math.max(maxY, wy + hy);
        minZ = Math.min(minZ, wz - hz); maxZ = Math.max(maxZ, wz + hz);
      });
      const center = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
      const radius = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2) / 2;
      const overviewDir = new THREE.Vector3(0.45, 0.55, 0.85).normalize();
      const refitOverview = (asp) => computeFitCamera(camera, asp ?? aspectOf(), center, radius, overviewDir, 1.75);
      const overviewShot = refitOverview();
      camera.position.copy(overviewShot.pos);
      controls.target.copy(overviewShot.lookAt);
      controls.update();
      // 화면 비율이 바뀌면(모니터 연결 등) resize 핸들러가 refit()을 다시 불러서
      // 같은 구도를 유지한다. center/radius/dir을 들고 있어 언제든 재계산 가능.
      s.overview = { pos: overviewShot.pos.clone(), target: overviewShot.lookAt.clone(), refit: refitOverview };
      s.activeRefit = refitOverview;
      controls.enabled = true;
      s.ready = true;
      s.tweenHelpers = { tween, staggeredTween, tweenCameraTo };
      onStage?.(null);

      // 처음 적재한 박스를 바로 선택된 것처럼 보여준다 (아직 선택된 게 없을 때만)
      if (placements.length && selectedIndex == null) onSelectRef.current?.(0);
    }

    run();
  }, [container, placements, colorMap, webglError]);

  // ── 선택 강조: 투시 처리 + 선택 박스 플랩 열기/내용물 미리보기 + 카메라 포커스 ──
  useEffect(() => {
    const s = sceneRef.current;
    if (!s || !s.ready || !s.meshes) return;
    const anySelected = selectedIndex != null;
    const helpers = s.tweenHelpers;
    if (!helpers) return;
    const { tween, staggeredTween, tweenCameraTo } = helpers;

    if (s.previewGroup) {
      // [2026-10 수정] previewGroup은 world가 아니라 선택된 박스 메쉬(selMesh)의
      // 자식으로 추가됐었는데(selMesh.add(group)), 여기서는 world에서 지우려고 해서
      // Three.js가 자식 목록에 없는 객체 제거를 조용히 무시 - 다른 박스를 선택해도
      // 이전 박스의 부품 미리보기(사진/뱃지/리더선)가 사라지지 않던 버그.
      // 실제 부모(previewGroup.parent, 즉 그 당시의 selMesh)에서 제거해야 한다.
      s.previewGroup.parent?.remove(s.previewGroup);
      disposeObject(s.previewGroup);
      s.previewGroup = null;
    }

    const selMesh = s.meshes.find((m) => m.userData.index === selectedIndex);

    s.meshes.forEach((m) => {
      const isSel = m.userData.index === selectedIndex;
      let opacity = 1;
      if (anySelected && !isSel) {
        opacity = 0.35;
        if (selMesh) {
          const dx = Math.abs(m.position.x - selMesh.position.x);
          const dz = Math.abs(m.position.z - selMesh.position.z);
          const overlapX = ((m.userData.dims.x + selMesh.userData.dims.x) / 2) * 0.85;
          const overlapZ = ((m.userData.dims.z + selMesh.userData.dims.z) / 2) * 0.85;
          const isAbove = m.position.y > selMesh.position.y + 0.01;
          if (isAbove && dx < overlapX && dz < overlapZ) opacity = 0.06;
        }
      }
      m.material.transparent = anySelected && !isSel;
      m.material.opacity = opacity;
      m.material.emissive?.set?.(isSel ? 0x003087 : 0x000000);
      if (m.userData.edges) {
        m.userData.edges.material.color.set(isSel ? 0x002554 : 0x1a2633);
        m.userData.edges.material.opacity = isSel ? 1 : opacity;
      }
      m.material.needsUpdate = true;

      const targetOpen = isSel ? 1 : 0;
      const startOpen = m.userData.flapOpen ?? 0;
      if (targetOpen !== startOpen && m.userData.flaps) {
        tween(isSel ? 380 : 260, (e) => {
          const open = startOpen + (targetOpen - startOpen) * e;
          m.userData.flaps.pivotA.rotation.x = THREE.MathUtils.lerp(0, m.userData.flaps.openA, open);
          m.userData.flaps.pivotB.rotation.x = THREE.MathUtils.lerp(0, m.userData.flaps.openB, open);
          m.userData.flapOpen = open;
        });
      }
    });

    // 선택한 박스 안의 부품들을 사진+품번+수량 배지로 리더선에 띄운다
    if (selMesh) {
      const dims = selMesh.userData.dims;
      const parts = selMesh.userData.parts || [];
      const group = new THREE.Group();
      const cols = Math.max(1, Math.ceil(Math.sqrt(parts.length)));
      const rowsTotal = Math.max(1, Math.ceil(parts.length / cols));
      const spreadAnchor = Math.min(dims.x, dims.z) * 0.5;
      const ICON_SIZE = 0.28;
      const LEADER_DIST = 0.85;
      parts.forEach((pt, idx) => {
        const col = idx % cols, row = Math.floor(idx / cols);
        const anchorX = cols > 1 ? (col / (cols - 1) - 0.5) * spreadAnchor : 0;
        const anchorZ = rowsTotal > 1 ? (row / (rowsTotal - 1) - 0.5) * spreadAnchor * 0.6 : 0;
        const anchor = new THREE.Vector3(anchorX, dims.y / 2, anchorZ);
        let outDir = new THREE.Vector3(anchorX, 0, anchorZ);
        if (outDir.lengthSq() < 1e-6) outDir.set(idx % 2 ? 1 : -1, 0, 0.35);
        outDir.normalize();
        const labelPos = anchor.clone().addScaledVector(outDir, LEADER_DIST).add(new THREE.Vector3(0, 0.6 + row * 0.03, 0));

        const info = (s.partInfoMap && s.partInfoMap.get(pt.part_no)) || { name: pt.desc || pt.part_no, dims: [100, 100, 100] };
        const pm = makePartMesh(pt.part_no, info);
        pm.traverse((o) => {
          if (o.material) {
            o.material.depthTest = false;
            o.material.transparent = true;
            if (o.isSprite && o.material.map) o.material.color = partColor(pt.part_no);
          }
        });
        pm.renderOrder = 999;
        pm.userData.targetScale = isScrewLikePart(info.name) ? ICON_SIZE * 1.7 : ICON_SIZE;
        pm.position.copy(anchor);
        pm.scale.setScalar(0.0001);
        group.add(pm);

        const badgePos = labelPos.clone().add(new THREE.Vector3(0, -ICON_SIZE * 0.95, 0));
        const badge = makeQtyBadgeSprite(pt.part_no, pt.qty);
        badge.userData.targetScaleX = badge.scale.x;
        badge.userData.targetScaleY = badge.scale.y;
        badge.position.copy(anchor);
        badge.scale.set(0.0001, 0.0001, 1);
        group.add(badge);

        const lineGeo = new THREE.BufferGeometry().setFromPoints([anchor, anchor.clone()]);
        const line = new THREE.Line(
          lineGeo,
          new THREE.LineBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.9, depthTest: false }),
        );
        line.renderOrder = 998;
        line.userData.isLeaderLine = true;
        line.userData.anchor = anchor;
        line.userData.labelPos = labelPos;
        group.add(line);

        staggeredTween([pm], 340, idx * 40, (c, t) => {
          const e = 1 - Math.pow(1 - t, 3);
          c.position.lerpVectors(anchor, labelPos, e);
          c.scale.setScalar(c.userData.targetScale * e);
        });
        staggeredTween([badge], 340, idx * 40, (c, t) => {
          const e = 1 - Math.pow(1 - t, 3);
          c.position.lerpVectors(anchor, badgePos, e);
          c.scale.set(c.userData.targetScaleX * e, c.userData.targetScaleY * e, 1);
        });
        staggeredTween([line], 340, idx * 40, (c, t) => {
          const e = 1 - Math.pow(1 - t, 3);
          const cur = anchor.clone().lerp(labelPos, e);
          const posAttr = c.geometry.attributes.position;
          posAttr.setXYZ(1, cur.x, cur.y, cur.z);
          posAttr.needsUpdate = true;
          c.material.opacity = 0.8 * e;
        });
      });
      selMesh.add(group);
      s.previewGroup = group;
      s.previewGroup.userData.parent = selMesh;
    }

    const { camera, controls, overview } = s;
    if (!overview) return;
    if (selMesh) {
      const dims = selMesh.userData.dims;
      const center = selMesh.userData.finalPos || selMesh.position;
      const boxRadius = dims.length() / 2;
      const radius = boxRadius + 1.1;
      const dir = new THREE.Vector3(0.5, 0.48, 0.75).normalize();
      const el = mountRef.current;
      const aspectNow = Math.max(0.3, (el?.clientWidth || 800) / (el?.clientHeight || 440));
      // [2026-10 조정] 클로즈업이 너무 가깝다는 피드백으로 margin 0.9 → 1.2 (카메라를 더 뒤로)
      const refitFocus = (asp) => computeFitCamera(camera, asp ?? aspectNow, center, radius, dir, 1.2);
      // 선택 중에 화면 비율이 바뀌어도(모니터 연결 등) 같은 구도를 유지하도록 등록.
      s.activeRefit = refitFocus;
      tweenCameraTo(refitFocus(aspectNow), 480);
    } else {
      // 선택 해제 시 전체보기로 복귀 - 그 사이 화면 비율이 바뀌었을 수 있으니 다시 계산.
      const refitOverview = overview.refit || (() => ({ pos: overview.pos, lookAt: overview.target }));
      s.activeRefit = refitOverview;
      tweenCameraTo(refitOverview(), 480);
    }
  }, [selectedIndex, placements, container, colorMap]);

  if (webglError) {
    return (
      <div className="viewer viewer-fallback">
        이 브라우저에서는 3D 화면을 표시할 수 없습니다. 아래 표로 적재 내역을 확인해 주세요.
      </div>
    );
  }
  return <div className="viewer" ref={mountRef} />;
}
